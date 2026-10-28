import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '../src/lib/crypto.js';
import { fakeHomeAssistant, setup, type FakeHa, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
let member: string;
let reader: string;

beforeAll(async () => {
  t = await setup();
  admin = await t.login('admin');
  member = await t.login('member');
  reader = await t.login('read');
});
afterAll(() => t.close());

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method, url, payload: payload as object, headers: { ...(cookie ? { cookie } : {}), ...headers } });

describe('access control', () => {
  it('rejects anonymous API calls but serves health', async () => {
    expect((await call('GET', '/api/tickets')).statusCode).toBe(401);
    expect((await call('GET', '/api/health')).statusCode).toBe(200);
  });

  it('lets readers read but not change', async () => {
    expect((await call('GET', '/api/tickets', reader)).statusCode).toBe(200);
    expect((await call('POST', '/api/tickets', reader, { title: 'x', areaId: 1 })).statusCode).toBe(403);
  });

  it('lets members work on tickets but not on configuration', async () => {
    expect((await call('POST', '/api/tickets', member, { title: 'Vom Mitglied', areaId: 1 })).statusCode).toBe(201);
    expect((await call('PATCH', '/api/settings', member, { channel: 'email' })).statusCode).toBe(403);
    expect((await call('GET', '/api/tokens', member)).statusCode).toBe(403);
  });

  it('dev login creates a session cookie', async () => {
    const res = await call('GET', '/auth/login');
    expect(res.statusCode).toBe(302);
    const cookie = String(res.headers['set-cookie']).split(';')[0];
    const me = await call('GET', '/api/me', cookie);
    expect(me.json()).toMatchObject({ kind: 'user', role: 'admin', email: 'admin@example.com' });
    await call('POST', '/api/logout', cookie, {});
    expect((await call('GET', '/api/me', cookie)).statusCode).toBe(401);
  });

  it('API tokens are limited by scope and shown only once', async () => {
    const res = await call('POST', '/api/tokens', admin, { name: 'Lesen', scope: 'read' });
    const { token, prefix } = res.json();
    expect(token.startsWith(prefix)).toBe(true);
    expect(JSON.stringify((await call('GET', '/api/tokens', admin)).json())).not.toContain(token);
    const bearer = { authorization: `Bearer ${token}` };
    expect((await call('GET', '/api/tickets', undefined, undefined, bearer)).statusCode).toBe(200);
    expect((await call('POST', '/api/tickets', undefined, { title: 'x', areaId: 1 }, bearer)).statusCode).toBe(403);
  });

  it('admins cannot demote themselves', async () => {
    const me = (await call('GET', '/api/me', admin)).json();
    expect((await call('PATCH', `/api/users/${me.id}`, admin, { role: 'read' })).statusCode).toBe(409);
  });
});

describe('tickets and time', () => {
  it('creates, filters, cycles status and bulk-completes', async () => {
    const created = (await call('POST', '/api/tickets', member, { title: 'Zaun streichen', areaId: 2, prio: 'high', due: '2030-01-01' })).json();
    expect(created).toMatchObject({ title: 'Zaun streichen', area: 'Zuhause', prio: 'high', status: 'open', minutes: 0 });

    const found = (await call('GET', '/api/tickets?q=zaun', member)).json();
    expect(found.map((x: { id: number }) => x.id)).toEqual([created.id]);

    const done = (await call('PATCH', `/api/tickets/${created.id}`, member, { status: 'done' })).json();
    expect(done.doneAt).not.toBeNull();

    const open = (await call('GET', '/api/tickets?open=true', member)).json();
    const res = await call('POST', '/api/tickets/bulk', member, { ids: open.map((x: { id: number }) => x.id), action: 'setStatus', status: 'done' });
    expect(res.json().affected).toBe(open.length);
    expect((await call('GET', '/api/overview', member)).json().openTickets).toBe(0);
  });

  it('rounds a stopped timer up to the configured step', async () => {
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Timer-Test', areaId: 1 })).json();
    await call('PATCH', '/api/settings', admin, { rounding: 15 });
    expect((await call('POST', `/api/tickets/${ticket.id}/timer`, member, {})).json()).toMatchObject({ running: true, status: 'inProgress' });
    await call('POST', '/api/timer/stop', member, {});
    expect((await call('GET', `/api/tickets/${ticket.id}`, member)).json()).toMatchObject({ running: false, minutes: 15 });

    await call('POST', `/api/tickets/${ticket.id}/time`, member, { minutes: 30 });
    expect((await call('GET', `/api/tickets/${ticket.id}`, member)).json().minutes).toBe(45);
  });

  it('reports time per group and as CSV', async () => {
    const report = (await call('GET', '/api/reports/time?groupBy=area&range=month', member)).json();
    expect(report.total).toBe(report.rows.reduce((s: number, r: { minutes: number }) => s + r.minutes, 0));
    const csv = await call('GET', '/api/reports/time?groupBy=project&format=csv', member);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Projekt;Minuten;Stunden');
  });
});

describe('Home Assistant webhook', () => {
  let token: string;
  let hookUrl: string;

  beforeAll(async () => {
    token = (await call('POST', '/api/tokens', admin, { name: 'HA', scope: 'tickets:write' })).json().token;
    hookUrl = new URL((await call('GET', '/api/ha', admin)).json().webhookUrl).pathname;
  });

  const hook = (body: unknown, headers: Record<string, string> = {}) =>
    t.app.inject({ method: 'POST', url: hookUrl, payload: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers } });

  it('creates one ticket per rule until it is closed again', async () => {
    const rule = (await call('POST', '/api/rules', admin, {
      name: 'Wasser im Keller', entity: 'binary_sensor.keller', cond: 'on', join: 'and', cond2: '', window: '00:00–23:59',
      title: 'Keller prüfen', areaId: 2, prio: 'high', onEnd: 'close', dedupe: true, enabled: true,
    })).json();
    expect(rule.translatable).toBe(true);

    const first = await hook({ rule: rule.id, event: 'start' });
    expect(first.statusCode).toBe(201);
    expect((await hook({ rule: rule.id, event: 'start' })).json().result).toBe('duplicate');

    const ticket = (await call('GET', `/api/tickets/${first.json().ticketId}`, admin)).json();
    expect(ticket).toMatchObject({ title: 'Keller prüfen', source: 'ha', prio: 'high', status: 'open' });

    expect((await hook({ rule: rule.id, event: 'end' })).json()).toEqual({ result: 'closed', closed: 1 });
    expect((await call('GET', `/api/tickets/${ticket.id}`, admin)).json().status).toBe('done');
    expect((await hook({ rule: rule.id })).statusCode).toBe(201);
  });

  it('ignores disabled rules and logs it', async () => {
    const rules = (await call('GET', '/api/rules', admin)).json();
    const disabled = rules.find((r: { enabled: boolean }) => !r.enabled);
    expect((await hook({ rule: disabled.id })).json().result).toBe('disabled');
    const logs = (await call('GET', '/api/logs?filter=in&limit=1', admin)).json();
    expect(logs[0]).toMatchObject({ status: 'ignored' });
  });

  it('rejects bad tokens and logs a retryable entry', async () => {
    const res = await hook({ title: 'Nicht erlaubt' }, { authorization: 'Bearer falsch' });
    expect(res.statusCode).toBe(401);
    const [entry] = (await call('GET', '/api/logs?filter=errors&limit=1', admin)).json();
    expect(entry).toMatchObject({ status: 'rejected', retryable: true });

    expect((await call('POST', `/api/logs/${entry.id}/retry`, admin, {})).json()).toEqual({ ok: true, status: 'done' });
    expect((await call('GET', '/api/tickets?q=Nicht erlaubt', admin)).json()).toHaveLength(1);
  });

  it('enforces the HMAC signature when switched on', async () => {
    await call('PATCH', '/api/settings', admin, { enforceSignature: true });
    const secret = (await call('GET', '/api/settings/webhook-secret', admin)).json().secret;
    const body = { title: 'Signiert', area: 'Arbeit' };
    expect((await hook(body)).statusCode).toBe(401);
    const sig = 'sha256=' + hmacSha256(secret, JSON.stringify(body));
    expect((await hook(body, { 'x-tasklog-signature': sig })).statusCode).toBe(201);
    await call('PATCH', '/api/settings', admin, { enforceSignature: false });
  });

  it('validates the body', async () => {
    expect((await hook({ event: 'start' })).statusCode).toBe(400);
  });
});

describe('Tasklog → Home Assistant', () => {
  let ha: FakeHa;
  beforeAll(async () => {
    ha = await fakeHomeAssistant();
    await call('PATCH', '/api/settings', admin, { ha: { url: ha.url, token: 'ha-token' } });
  });
  afterAll(() => ha.close());

  it('tests the connection without exposing the token', async () => {
    expect((await call('POST', '/api/ha/test', admin, {})).json()).toMatchObject({ ok: true, version: '2026.10.1' });
    expect(JSON.stringify((await call('GET', '/api/settings', admin)).json())).not.toContain('ha-token');
  });

  it('publishes enabled entities and logs only changes', async () => {
    await call('PATCH', '/api/entities/binary_sensor.tasklog_overdue', admin, { enabled: false });
    await call('POST', '/api/ha/publish', admin, {});
    expect([...ha.states.keys()].sort()).toEqual([
      'binary_sensor.tasklog_timer_running', 'sensor.tasklog_next_due', 'sensor.tasklog_open_tickets', 'sensor.tasklog_today_time',
    ]);
    const open = (await call('GET', '/api/overview', admin)).json().openTickets;
    expect(ha.states.get('sensor.tasklog_open_tickets')?.state).toBe(String(open));

    const before = (await call('GET', '/api/logs?filter=out', admin)).json().length;
    await call('POST', '/api/ha/publish', admin, {});
    expect((await call('GET', '/api/logs?filter=out', admin)).json().length).toBe(before);
  });

  it('logs a failure once and can retry it', async () => {
    await call('POST', '/api/tickets', member, { title: 'Neu, damit sich etwas ändert', areaId: 1 });
    ha.fail = true;
    await call('POST', '/api/ha/publish', admin, {});
    await call('POST', '/api/ha/publish', admin, {});
    const errors = (await call('GET', '/api/logs?filter=errors', admin)).json().filter((e: { direction: string; message: string }) => e.direction === 'out' && e.message.includes('500'));
    expect(errors.length).toBe(4); // one per entity, not one per run
    ha.fail = false;
    expect((await call('POST', `/api/logs/${errors[0].id}/retry`, admin, {})).json()).toEqual({ ok: true, status: 'sent' });
  });

  it('serves monitor data with the public link token only', async () => {
    const { monitorUrl } = (await call('GET', '/api/system', admin)).json();
    const token = new URL(monitorUrl).searchParams.get('t');
    expect((await call('GET', '/api/monitor/public?t=wrong')).statusCode).toBe(403);
    const data = (await call('GET', `/api/monitor/public?t=${token}`)).json();
    expect(data).toHaveProperty('next');
    expect(data.interval).toBe(30);
    expect(data.area).toBeNull();
  });

  it('filters the monitor by area', async () => {
    const today = new Date().toLocaleDateString('sv-SE');
    await call('POST', '/api/tickets', admin, { title: 'Monitor Arbeit', areaId: 1, due: today });
    await call('POST', '/api/tickets', admin, { title: 'Monitor Zuhause', areaId: 2, due: today });
    const token = new URL((await call('GET', '/api/system', admin)).json().monitorUrl).searchParams.get('t');
    const titles = (d: { next: { title: string }[]; later: { title: string }[] }) => [...d.next, ...d.later].map(x => x.title);

    const all = (await call('GET', `/api/monitor/public?t=${token}`)).json();
    expect(titles(all)).toEqual(expect.arrayContaining(['Monitor Arbeit', 'Monitor Zuhause']));
    const home = (await call('GET', `/api/monitor/public?t=${token}&area=2`)).json();
    expect(home.area).toBeTruthy();
    expect(titles(home)).toContain('Monitor Zuhause');
    expect(titles(home)).not.toContain('Monitor Arbeit');
    expect(home.openTickets).toBeLessThan(all.openTickets);
    expect((await call('GET', `/api/monitor/public?t=${token}&area=999`)).statusCode).toBe(404);
    expect((await call('GET', '/api/monitor?area=1', admin)).json().area).toBeTruthy();
  });
});

describe('configuration and backup', () => {
  it('generates both YAML files', async () => {
    const ha = await call('GET', '/api/config/homeassistant.yaml', admin);
    expect(ha.body).toContain('rest_command:');
    expect(ha.body).toContain('/api/hooks/ha/');
    const tl = await call('GET', '/api/config/tasklog.yaml', admin);
    expect(tl.body).toContain('publish:');
  });

  it('restores an exported backup', async () => {
    const dump = (await call('GET', '/api/backup', admin)).json();
    const tickets = (await call('GET', '/api/tickets', admin)).json().length;
    await call('POST', '/api/tickets', admin, { title: 'Nach dem Backup', areaId: 1 });

    const res = await call('PUT', '/api/backup', admin, dump);
    expect(res.statusCode).toBe(200);
    // Sessions are cleared by a restore; the seeded admin still exists, sign in again.
    const cookie = await t.login('admin');
    expect((await call('GET', '/api/tickets', cookie)).json().length).toBe(tickets);
    expect((await call('POST', '/api/tickets', cookie, { title: 'Neue ID', areaId: 1 })).statusCode).toBe(201);
  });
});

describe('app endpoints', () => {
  // Earlier tests restore a backup, which ends all sessions: sign in afresh.
  let member: string;
  beforeAll(async () => { member = await t.login('member'); });

  it('lets members attach notes and delete their own', async () => {
    const other = await t.login('member');
    const boss = await t.login('admin');
    const reader = await t.login('read');
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Mit Notizen', areaId: 1 })).json();
    const url = `/api/tickets/${ticket.id}/notes`;

    const note = await call('POST', url, member, { body: '  Ersatzteil bestellt, kommt Freitag.  ' });
    expect(note.statusCode).toBe(201);
    expect(note.json()).toMatchObject({ body: 'Ersatzteil bestellt, kommt Freitag.', user: expect.any(String) });
    await call('POST', url, other, { body: 'Zweite Notiz' });
    expect((await call('POST', url, member, { body: '   ' })).statusCode).toBe(400);
    expect((await call('POST', url, reader, { body: 'x' })).statusCode).toBe(403);
    expect((await call('POST', '/api/tickets/999999/notes', member, { body: 'x' })).statusCode).toBe(404);
    expect((await call('GET', url, reader)).json().map((n: { body: string }) => n.body)).toEqual(['Ersatzteil bestellt, kommt Freitag.', 'Zweite Notiz']);

    expect((await call('DELETE', `/api/notes/${note.json().id}`, other)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/notes/${note.json().id}`, member)).statusCode).toBe(204);
    const second = (await call('GET', url, reader)).json()[0];
    expect((await call('DELETE', `/api/notes/${second.id}`, boss)).statusCode).toBe(204);
    expect((await call('GET', url, reader)).json()).toEqual([]);
  });

  it('keeps each user\'s own area order and hidden areas', async () => {
    const reader = await t.login('read');
    expect((await call('GET', '/api/me/areas', reader)).json()).toEqual({ order: [], hidden: [] });
    const saved = await call('PUT', '/api/me/areas', reader, { order: [2, 1, 2], hidden: [1] });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ order: [2, 1], hidden: [1] });
    expect((await call('GET', '/api/me/areas', reader)).json()).toEqual({ order: [2, 1], hidden: [1] });
    expect((await call('GET', '/api/me/areas', member)).json()).toEqual({ order: [], hidden: [] });
    expect((await call('PUT', '/api/me/areas', reader, { order: ['x'], hidden: [] })).statusCode).toBe(400);
  });

  it('stores a description and makes the creator the assignee', async () => {
    const me = (await call('GET', '/api/me', member)).json();
    const res = await call('POST', '/api/tickets', member, { title: 'Mit Beschreibung', description: 'Flur, Küche', areaId: 1 });
    expect(res.json()).toMatchObject({ description: 'Flur, Küche', assigneeId: me.id });
  });

  it('returns a ticket history', async () => {
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Verlauf', areaId: 1 })).json();
    await call('POST', `/api/tickets/${ticket.id}/time`, member, { minutes: 20 });
    const history = (await call('GET', `/api/tickets/${ticket.id}/history`, member)).json();
    expect(history.map((h: { kind: string }) => h.kind)).toEqual(['created', 'timeAdded']);
    expect(history[1].minutes).toBe(20);
    await call('POST', `/api/tickets/${ticket.id}/timer`, member, {});
    await call('POST', '/api/timer/stop', member, {});
    const after = (await call('GET', `/api/tickets/${ticket.id}/history`, member)).json();
    expect(after.map((h: { kind: string }) => h.kind)).toEqual(['created', 'timeAdded', 'timerStarted', 'timerStopped']);
  });

  it('sums the own time for today and the week', async () => {
    const cookie = await t.login('member');
    const ticket = (await call('POST', '/api/tickets', cookie, { title: 'Meine Zeit', areaId: 2 })).json();
    await call('POST', `/api/tickets/${ticket.id}/time`, cookie, { minutes: 30 });
    const time = (await call('GET', '/api/me/time', cookie)).json();
    expect(time.today).toEqual({ total: 30, byArea: [{ name: 'Zuhause', icon: 'house', minutes: 30 }] });
    expect(time.week.days).toHaveLength(7);
    expect(time.week.total).toBe(30);
    expect(time.top[0]).toMatchObject({ title: 'Meine Zeit', minutes: 30 });
  });

  it('tells the login screen how sign-in works, without a session', async () => {
    expect((await call('GET', '/api/auth/info')).json()).toEqual({ mode: 'dev', issuer: null });
  });

  it('keeps the HA connection details for admins', async () => {
    expect((await call('GET', '/api/ha', member)).statusCode).toBe(403);
  });
});

describe('due time', () => {
  let member: string;
  let admin2: string;
  beforeAll(async () => {
    member = await t.login('member');
    admin2 = await t.login('admin');
  });

  it('stores an optional time and validates it', async () => {
    const res = await call('POST', '/api/tickets', member, { title: 'Mit Uhrzeit', areaId: 1, due: '2030-05-01', dueTime: '19:00' });
    expect(res.json()).toMatchObject({ due: '2030-05-01', dueTime: '19:00' });
    expect((await call('PATCH', `/api/tickets/${res.json().id}`, member, { dueTime: null })).json().dueTime).toBeNull();
    expect((await call('POST', '/api/tickets', member, { title: 'Falsch', areaId: 1, dueTime: '25:00' })).statusCode).toBe(400);
  });

  it('counts a ticket as overdue once its time today has passed', async () => {
    await t.db.query("UPDATE tickets SET status = 'done'");
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Heute früh', areaId: 1 })).json();
    await t.db.query("UPDATE tickets SET due_date = current_date, due_time = '00:00' WHERE id = $1", [ticket.id]);
    const preview = (await call('GET', '/api/entities/preview', admin2)).json();
    expect(preview['binary_sensor.tasklog_overdue'].state).toBe('on');
    await t.db.query("UPDATE tickets SET due_date = current_date + 1 WHERE id = $1", [ticket.id]);
    expect((await call('GET', '/api/entities/preview', admin2)).json()['binary_sensor.tasklog_overdue'].state).toBe('off');
  });

  it('reminds once, an hour before the due time', async () => {
    const { jobs } = await import('../src/services/jobs.js');
    const { fakeHomeAssistant } = await import('./helpers.js');
    const ha = await fakeHomeAssistant();
    await call('PATCH', '/api/settings', admin2, { ha: { url: ha.url, token: 'ha-token' }, channel: 'haNotify', quietFrom: '00:00', quietTo: '00:00', notifications: { dueSoon: true } });
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Bald fällig', areaId: 1 })).json();
    await t.db.query(
      "UPDATE tickets SET due_date = (localtimestamp + interval '30 minutes')::date, due_time = (localtimestamp + interval '30 minutes')::time WHERE id = $1",
      [ticket.id],
    );
    await jobs.dueSoon(t.ctx, new Date());
    await jobs.dueSoon(t.ctx, new Date());
    const notes = ha.calls.filter(c => c.path === '/api/services/notify/notify');
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toMatchObject({ message: 'Bald fällig' });
    await ha.close();
  });
});
