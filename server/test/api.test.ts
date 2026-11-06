import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '../src/lib/crypto.js';
import { checkAutoClose } from '../src/services/autoClose.js';
import { jobs, sendPersonalLists } from '../src/services/jobs.js';
import { checkPresence } from '../src/services/presence.js';
import { sweepUploads } from '../src/routes/attachments.js';
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

  it('serves each user a calendar feed behind a secret link', async () => {
    const { url } = (await call('GET', '/api/me/calendar-feed', member)).json();
    expect((await call('GET', '/api/me/calendar-feed', member)).json().url).toBe(url); // stable until renewed
    const path = new URL(url).pathname;
    const me = (await call('GET', '/api/me', member)).json();
    const mine = (await call('POST', '/api/tickets', member, { title: 'Feed: meins', areaId: 1, due: '2030-03-04', dueTime: '09:15' })).json();
    await call('POST', '/api/tickets', member, { title: 'Feed: andere', areaId: 2, due: '2030-03-05', assigneeId: null });
    await call('POST', '/api/tickets', member, { title: 'Feed: ohne Datum', areaId: 1 });

    const feed = await call('GET', path); // no login needed
    expect(feed.statusCode).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.body).toContain(`UID:ticket-${mine.id}@`);
    expect(feed.body).toContain('SUMMARY:Feed: meins');
    expect(feed.body).toContain('DTSTART;TZID=Europe/Berlin:20300304T091500');
    expect(feed.body).toContain('DTSTART;VALUE=DATE:20300305');
    expect(feed.body).not.toContain('Feed: ohne Datum');

    expect((await call('GET', `${path}?mine=true`)).body).not.toContain('Feed: andere');
    expect((await call('GET', `${path}?area=2`)).body).not.toContain('Feed: meins');
    expect(me.id).toEqual(mine.assigneeId);

    const renewed = (await call('POST', '/api/me/calendar-feed/rotate', member)).json().url;
    expect(renewed).not.toBe(url);
    expect((await call('GET', path)).statusCode).toBe(404);
    expect((await call('GET', '/api/calendar/kurz.ics')).statusCode).toBe(400);
  });

  it('creates the next ticket of a series when one is done', async () => {
    const recurrence = { every: 1, unit: 'week', weekdays: [1] };
    const first = (await call('POST', '/api/tickets', member, { title: 'Müll rausstellen', areaId: 2, due: '2030-01-07', dueTime: '07:00', recurrence })).json();
    expect(first.recurrence).toEqual(recurrence);

    const done = (await call('PATCH', `/api/tickets/${first.id}`, member, { status: 'done' })).json();
    expect(done.followupId).toEqual(expect.any(Number));
    const next = (await call('GET', `/api/tickets/${done.followupId}`, member)).json();
    expect(next).toMatchObject({ title: 'Müll rausstellen', status: 'open', due: '2030-01-14', dueTime: '07:00', areaId: 2, recurrence });

    // Reopening and finishing again must not start a second series.
    await call('PATCH', `/api/tickets/${first.id}`, member, { status: 'open' });
    await call('PATCH', `/api/tickets/${first.id}`, member, { status: 'done' });
    const series = (await call('GET', '/api/tickets', member)).json().filter((x: { title: string }) => x.title === 'Müll rausstellen');
    expect(series).toHaveLength(2);

    // Without recurrence nothing follows; a bad recurrence is rejected.
    const once = (await call('POST', '/api/tickets', member, { title: 'Einmalig', areaId: 1 })).json();
    expect((await call('PATCH', `/api/tickets/${once.id}`, member, { status: 'done' })).json().followupId).toBeNull();
    expect((await call('PATCH', `/api/tickets/${next.id}`, member, { recurrence: { every: 0, unit: 'week' } })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/tickets/${next.id}`, member, { recurrence: null })).json().recurrence).toBeNull();
  });

  it('moves a ticket to another area and project', async () => {
    const areas = (await call('GET', '/api/areas', member)).json() as { id: number; projects: { id: number }[] }[];
    const [a, b] = areas;
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Umziehen', areaId: a.id, projectId: a.projects[0].id })).json();
    expect(ticket.projectId).toBe(a.projects[0].id);

    const moved = (await call('PATCH', `/api/tickets/${ticket.id}`, member, { areaId: b.id })).json();
    expect(moved).toMatchObject({ areaId: b.id, projectId: null }); // the old project does not fit
    expect((await call('PATCH', `/api/tickets/${ticket.id}`, member, { projectId: b.projects[0].id })).json().projectId).toBe(b.projects[0].id);
    expect((await call('PATCH', `/api/tickets/${ticket.id}`, member, { areaId: a.id, projectId: a.projects[0].id })).json()).toMatchObject({ areaId: a.id, projectId: a.projects[0].id });

    expect((await call('PATCH', `/api/tickets/${ticket.id}`, member, { projectId: b.projects[0].id })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/tickets/${ticket.id}`, member, { areaId: 999999 })).statusCode).toBe(400);
    expect((await call('POST', '/api/tickets', member, { title: 'x', areaId: a.id, projectId: b.projects[0].id })).statusCode).toBe(400);
  });

  it('keeps a checklist in a ticket and passes it on in a series', async () => {
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Einkauf', areaId: 1, due: '2030-02-04', recurrence: { every: 1, unit: 'week' } })).json();
    const url = `/api/tickets/${ticket.id}/checklist`;
    const added = await call('POST', url, member, { text: '- Milch\n* Brot\n\n1. Eier' });
    expect(added.statusCode).toBe(201);
    expect(added.json().map((i: { text: string }) => i.text)).toEqual(['Milch', 'Brot', 'Eier']);
    const [milch, brot, eier] = added.json() as { id: number }[];
    await call('PATCH', `/api/checklist/${brot.id}`, member, { done: true });
    expect((await call('GET', `/api/tickets/${ticket.id}`, member)).json()).toMatchObject({ checkTotal: 3, checkDone: 1 });

    const reordered = (await call('PUT', `${url}/order`, member, { ids: [eier.id, milch.id, brot.id] })).json();
    expect(reordered.map((i: { text: string }) => i.text)).toEqual(['Eier', 'Milch', 'Brot']);
    expect((await call('PATCH', `/api/checklist/${milch.id}`, member, { text: 'Hafermilch' })).json().text).toBe('Hafermilch');
    expect((await call('DELETE', `/api/checklist/${eier.id}`, member)).statusCode).toBe(204);
    expect((await call('POST', url, member, { text: '  ' })).statusCode).toBe(400);
    expect((await call('POST', url, reader, { text: 'x' })).statusCode).toBe(403);

    const done = (await call('PATCH', `/api/tickets/${ticket.id}`, member, { status: 'done' })).json();
    const next = (await call('GET', `/api/tickets/${done.followupId}/checklist`, member)).json();
    expect(next.map((i: { text: string; done: boolean }) => [i.text, i.done])).toEqual([['Hafermilch', false], ['Brot', false]]);
  });

  it('stores photos on a ticket and serves them only to signed-in users', async () => {
    // 1×1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Mit Foto', areaId: 1 })).json();
    const upload = (cookie: string, body: Buffer, type: string) => t.app.inject({
      method: 'POST', url: `/api/tickets/${ticket.id}/attachments?name=${encodeURIComponent('Zähler.png')}`, payload: body, headers: { cookie, 'content-type': type },
    });

    const res = await upload(member, png, 'image/png');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ fileName: 'Zähler.png', mime: 'image/png', size: png.length });
    const photo = res.json();
    expect((await call('GET', `/api/tickets/${ticket.id}`, member)).json().photos).toBe(1);

    const got = await call('GET', `/api/attachments/${photo.id}`, reader);
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.rawPayload.equals(png)).toBe(true);
    expect((await call('GET', `/api/attachments/${photo.id}`)).statusCode).toBe(401);

    expect((await upload(member, Buffer.from('<html>nope</html>'), 'image/png')).statusCode).toBe(400); // not really a PNG
    expect((await upload(member, Buffer.from('%PDF-1.7'), 'application/pdf')).statusCode).toBe(415);
    expect((await upload(reader, png, 'image/png')).statusCode).toBe(403);

    const other = await t.login('member');
    expect((await call('DELETE', `/api/attachments/${photo.id}`, other)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/attachments/${photo.id}`, member)).statusCode).toBe(204);
    expect((await call('GET', `/api/attachments/${photo.id}`, member)).statusCode).toBe(404);
  });

  it('sweeps away photo files of deleted tickets, but not fresh uploads', async () => {
    const dir = t.ctx.config.UPLOAD_DIR;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'verwaist.jpg'), 'x');
    await writeFile(path.join(dir, 'gerade-hochgeladen.jpg'), 'x');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(path.join(dir, 'verwaist.jpg'), old, old);
    expect(await sweepUploads(t.ctx)).toBe(1);
    expect(await readdir(dir)).toContain('gerade-hochgeladen.jpg');
    expect(await readdir(dir)).not.toContain('verwaist.jpg');
  });

  it('assigns tickets to someone else', async () => {
    const reader = await t.login('read');
    const people = (await call('GET', '/api/people', member)).json() as { id: number; name: string }[];
    const me = (await call('GET', '/api/me', member)).json();
    const readerMe = (await call('GET', '/api/me', reader)).json();
    expect(people.map(p => p.id)).toContain(me.id);
    expect(people.map(p => p.id)).not.toContain(readerMe.id); // readers cannot work on tickets
    expect(Object.keys(people[0]).sort()).toEqual(['id', 'name']);
    expect((await call('GET', '/api/users', member)).statusCode).toBe(403);

    const other = people.find(p => p.id !== me.id)!;
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Für jemand anderen', areaId: 1 })).json();
    expect(ticket.assigneeId).toBe(me.id);
    const moved = await call('PATCH', `/api/tickets/${ticket.id}`, member, { assigneeId: other.id });
    expect(moved.json()).toMatchObject({ assigneeId: other.id, assignee: other.name });
    expect((await call('PATCH', `/api/tickets/${ticket.id}`, member, { assigneeId: null })).json().assignee).toBeNull();
    expect((await call('PATCH', `/api/tickets/${ticket.id}`, member, { assigneeId: readerMe.id })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/tickets/${ticket.id}`, member, { assigneeId: 999999 })).statusCode).toBe(400);
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

  it('sends each user their own notifications on the devices they chose', async () => {
    await call('PATCH', '/api/settings', admin, { quietFrom: '00:00', quietTo: '00:00' }); // no quiet hours during the test
    const anna = member;
    const ben = await t.login('member');
    const benMe = (await call('GET', '/api/me', ben)).json();
    const sentTo = (service: string) => ha.calls.filter(c => c.path === `/api/services/notify/${service}`).map(c => c.body as { title: string; message: string; data: { url?: string } });

    const prefs = (await call('GET', '/api/me/notifications', anna)).json();
    expect(prefs).toMatchObject({ targets: [], haConfigured: true, personalActive: false });
    expect(prefs.devices[0]).toEqual({ id: 'mobile_app_pixel', name: 'Pixel' });
    expect(Object.values(prefs.kinds).every(Boolean)).toBe(true);

    expect((await call('PUT', '/api/me/notifications', anna, { targets: ['mobile_app_handy'], kinds: { dailyDigest: false } })).json())
      .toMatchObject({ targets: ['mobile_app_handy'], kinds: { dailyDigest: false, dueSoon: true } });
    await call('PUT', '/api/me/notifications', ben, { targets: ['mobile_app_tablet'], kinds: {} });
    expect((await call('PUT', '/api/me/notifications', ben, { targets: ['notify.falsch'], kinds: {} })).statusCode).toBe(400);

    expect((await call('POST', '/api/me/notifications/test', anna)).statusCode).toBe(200);
    expect(sentTo('mobile_app_handy').at(-1)?.title).toBe('Test von Tasklog');

    // Anna gives Ben a ticket: only Ben hears about it, with a link into the app.
    const ticket = (await call('POST', '/api/tickets', anna, { title: 'Kinderwagen reparieren', areaId: 2, assigneeId: benMe.id })).json();
    expect(sentTo('mobile_app_tablet').at(-1)).toMatchObject({ title: 'Neu für dich', message: expect.stringContaining('Kinderwagen reparieren') });
    expect(sentTo('mobile_app_tablet').at(-1)?.data.url).toContain(`/#/ticket/${ticket.id}`);
    const pixelBefore = sentTo('mobile_app_handy').length;
    await call('POST', '/api/tickets', anna, { title: 'Eigenes', areaId: 2 }); // to herself: no message

    // Due in half an hour, assigned to Ben: the reminder goes to Ben only.
    await t.db.query(`UPDATE tickets SET due_date = (localtimestamp + interval '30 minutes')::date, due_time = (localtimestamp + interval '30 minutes')::time WHERE id = $1`, [ticket.id]);
    await jobs.dueSoon(t.ctx, new Date());
    expect(sentTo('mobile_app_tablet').at(-1)?.message).toBe('Kinderwagen reparieren');
    expect(sentTo('mobile_app_handy')).toHaveLength(pixelBefore);

    // Morning list: Ben gets his, Anna switched hers off.
    expect(await sendPersonalLists(t.ctx, 'dailyDigest', 't.due_date <= current_date', n => `Heute: ${n}`)).toBe(true);
    expect(sentTo('mobile_app_tablet').at(-1)?.message).toContain('Kinderwagen reparieren');
    expect(sentTo('mobile_app_handy')).toHaveLength(pixelBefore);

    for (const who of [anna, ben]) await call('PUT', '/api/me/notifications', who, { targets: [], kinds: {} });
    await call('PATCH', '/api/settings', admin, { quietFrom: '22:00', quietTo: '07:00' });
    await t.db.query('DELETE FROM tickets WHERE id = $1', [ticket.id]);
  });

  it('closes a ticket when a Home Assistant entity changes to a state', async () => {
    ha.states.set('sensor.waschmaschine', { state: 'idle', attributes: { friendly_name: 'Waschmaschine' } });
    const entities = (await call('GET', '/api/ha/entities', member)).json();
    expect(entities).toContainEqual({ id: 'sensor.waschmaschine', name: 'Waschmaschine', state: 'idle' });
    expect((await call('GET', '/api/ha/entities', reader)).statusCode).toBe(403);

    const autoClose = { entity: 'sensor.waschmaschine', state: 'Idle' };
    const ticket = (await call('POST', '/api/tickets', member, { title: 'Wäsche aufhängen', areaId: 2, due: '2030-05-06', recurrence: { every: 1, unit: 'week' }, autoClose })).json();
    expect(ticket.autoClose).toEqual(autoClose);
    const status = async () => (await call('GET', `/api/tickets/${ticket.id}`, member)).json().status;

    await checkAutoClose(t.ctx); // already idle when created: only remembered
    expect(await status()).toBe('open');
    ha.states.set('sensor.waschmaschine', { state: 'running', attributes: {} });
    await checkAutoClose(t.ctx);
    expect(await status()).toBe('open');
    ha.states.set('sensor.waschmaschine', { state: 'idle', attributes: {} });
    expect(await checkAutoClose(t.ctx)).toBe(1); // finished: closed, the comparison ignores case
    const done = (await call('GET', `/api/tickets/${ticket.id}`, member)).json();
    expect(done.status).toBe('done');
    expect((await call('GET', `/api/tickets/${done.followupId}`, member)).json().autoClose).toEqual(autoClose); // the series keeps it

    expect((await call('PATCH', `/api/tickets/${done.followupId}`, member, { autoClose: { entity: 'Waschmaschine', state: 'idle' } })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/tickets/${done.followupId}`, member, { autoClose: null })).json().autoClose).toBeNull();
    ha.states.delete('sensor.waschmaschine');
    await t.db.query("DELETE FROM tickets WHERE title = 'Wäsche aufhängen'");
  });

  it('tells a user what is due when they arrive home', async () => {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0); // outside the default quiet hours
    const today = noon.toLocaleDateString('sv-SE');
    ha.states.set('person.lukas', { state: 'not_home', attributes: { friendly_name: 'Lukas' } });
    ha.states.set('zone.home', { state: '1', attributes: { friendly_name: 'Zuhause' } });
    ha.states.set('zone.arbeit', { state: '0', attributes: { friendly_name: 'Arbeit' } });

    const options = (await call('GET', '/api/me/presence/options', member)).json();
    expect(options.persons).toEqual([{ id: 'person.lukas', name: 'Lukas', state: 'not_home' }]);
    expect(options.zones).toEqual(expect.arrayContaining([{ value: 'home', name: 'Zuhause' }, { value: 'Arbeit', name: 'Arbeit' }]));
    expect(options.notify).toEqual(['mobile_app_pixel', 'notify']);

    const me = (await call('GET', '/api/me', member)).json();
    const other = (await call('GET', '/api/people', member)).json().find((p: { id: number }) => p.id !== me.id);
    await call('POST', '/api/tickets', member, { title: 'Daheim: Pflanzen gießen', areaId: 2, due: today, assigneeId: null });
    await call('POST', '/api/tickets', member, { title: 'Daheim: für jemand anderen', areaId: 2, due: today, assigneeId: other.id });
    await call('POST', '/api/tickets', member, { title: 'Daheim: Arbeit', areaId: 1, due: today });
    const rule = await call('POST', '/api/me/presence', member, { personEntity: 'person.lukas', zone: 'home', areaId: 2, notifyService: 'mobile_app_pixel', includeUndated: false, enabled: true });
    expect(rule.statusCode).toBe(201);
    const sent = () => ha.calls.filter(c => c.path === '/api/services/notify/mobile_app_pixel');

    await checkPresence(t.ctx, noon); // first look: only remembers "not_home"
    ha.states.set('person.lukas', { state: 'home', attributes: {} });
    await checkPresence(t.ctx, noon);
    expect(sent()).toHaveLength(1);
    const msg = sent()[0].body as { title: string; message: string; data: { url: string } };
    expect(msg.title).toMatch(/^Willkommen zuhause – \d+ Sache/);
    expect(msg.message).toContain('Pflanzen gießen');
    expect(msg.message).not.toContain('für jemand anderen');
    expect(msg.message).not.toContain('Daheim: Arbeit');
    expect(msg.data.url).toMatch(/^http/);

    await checkPresence(t.ctx, noon); // still home: nothing new
    ha.states.set('person.lukas', { state: 'not_home', attributes: {} });
    await checkPresence(t.ctx, noon);
    ha.states.set('person.lukas', { state: 'home', attributes: {} });
    await checkPresence(t.ctx, noon); // back within 30 minutes: GPS jitter, no second message
    expect(sent()).toHaveLength(1);

    const id = rule.json().id;
    expect((await call('POST', `/api/me/presence/${id}/test`, member)).json().tickets).toBeGreaterThan(0);
    expect(sent()).toHaveLength(2);
    expect((await call('PATCH', `/api/me/presence/${id}`, admin, { enabled: false })).statusCode).toBe(404); // someone else's rule
    expect((await call('POST', '/api/me/presence', member, { personEntity: 'licht.flur', zone: 'home', areaId: null, notifyService: 'x', includeUndated: false, enabled: true })).statusCode).toBe(400);
    expect((await call('DELETE', `/api/me/presence/${id}`, member)).statusCode).toBe(204);
    expect((await call('GET', '/api/me/presence', member)).json()).toEqual([]);
    for (const e of ['person.lukas', 'zone.home', 'zone.arbeit']) ha.states.delete(e);
    for (const x of (await call('GET', '/api/tickets', member)).json()) if (x.title.startsWith('Daheim:')) await call('DELETE', `/api/tickets/${x.id}`, member);
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
  it('generates the dashboard card for the Tasklog integration', async () => {
    const yaml = (await call('GET', '/api/config/dashboard.yaml', admin)).body;
    expect(yaml).toContain('type: vertical-stack');
    expect(yaml).toContain('entity: todo.tasklog_zuhause');
    expect(yaml).toContain('entity: todo.tasklog_arbeit');
  });

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
    expect(time.today).toEqual({ total: 30, totalSeconds: 1800, byArea: [{ name: 'Zuhause', icon: 'house', minutes: 30, seconds: 1800 }] });
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
    // Only this ticket may be due soon (late in the evening "tomorrow 00:00" from the test above would be, too).
    await t.db.query("UPDATE tickets SET status = 'done'");
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

describe('privacy', () => {
  // Earlier tests restore a backup, which ends all sessions: sign in afresh.
  let boss: string;
  beforeAll(async () => { boss = await t.login('admin'); });

  it('serves imprint and privacy notice publicly and offers a template', async () => {
    expect((await call('GET', '/api/legal')).json()).toEqual({ imprint: '', privacy: '' });
    const template = (await call('GET', '/api/legal/template', boss)).json();
    expect(template.imprint).toContain('§ 5 DDG');
    expect(template.privacy).toContain('http://tasklog.test');
    expect(template.privacy).toContain('§ 25 Abs. 2 TDDDG');
    await call('PATCH', '/api/settings', boss, { legal: { imprint: 'Impressum: Familie Test', privacy: template.privacy } });
    expect((await call('GET', '/api/legal')).json().imprint).toBe('Impressum: Familie Test');
    expect((await call('GET', '/api/legal/template', await t.login('member'))).statusCode).toBe(403);
  });

  it('lets people download their data and delete their account', async () => {
    const anna = await t.login('member');
    const annaId = (await call('GET', '/api/me', anna)).json().id;
    const ticket = (await call('POST', '/api/tickets', anna, { title: 'Annas Ticket', areaId: 1 })).json();
    await call('POST', `/api/tickets/${ticket.id}/notes`, anna, { body: 'Annas Notiz' });
    await call('POST', `/api/tickets/${ticket.id}/time`, anna, { minutes: 15 });

    const res = await call('GET', '/api/me/export', anna);
    expect(res.headers['content-disposition']).toContain('attachment; filename="tasklog-meine-daten-');
    const data = res.json();
    expect(data.account).toMatchObject({ id: annaId, email: expect.stringContaining('@example.com') });
    expect(data.assignedTickets.map((x: { title: string }) => x.title)).toContain('Annas Ticket');
    expect(data.notes[0].body).toBe('Annas Notiz');
    expect(data.timeEntries).toHaveLength(1);
    expect(data.sessions.length).toBeGreaterThan(0);

    expect((await call('DELETE', '/api/me', anna)).statusCode).toBe(204);
    expect((await call('GET', '/api/me', anna)).statusCode).toBe(401); // signed out
    const after = (await call('GET', `/api/tickets/${ticket.id}`, boss)).json();
    expect(after.assigneeId).toBeNull(); // the ticket stays for the others, without her name
    expect((await call('GET', `/api/tickets/${ticket.id}/notes`, boss)).json()[0]).toMatchObject({ body: 'Annas Notiz', user: null });
  });

  it('keeps the last admin and lets admins delete others', async () => {
    const ben = await t.login('member');
    const benId = (await call('GET', '/api/me', ben)).json().id;
    expect((await call('DELETE', `/api/users/${benId}`, ben)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/users/${benId}`, boss)).statusCode).toBe(204);

    // Only one admin left: that one cannot delete the account.
    const lone = await t.login('admin');
    const loneId = (await call('GET', '/api/me', lone)).json().id;
    const others = (await t.db.query<{ id: number }>("UPDATE users SET role = 'member' WHERE role = 'admin' AND id <> $1 RETURNING id", [loneId])).rows.map(r => r.id);
    expect((await call('DELETE', '/api/me', lone)).statusCode).toBe(409);
    expect((await call('GET', '/api/me', lone)).json().id).toBe(loneId);
    await t.db.query("UPDATE users SET role = 'admin' WHERE id = ANY($1::int[])", [others]);
  });

  it('deletes expired sessions, old log entries and, if set, long-done tickets', async () => {
    const { applyRetention } = await import('../src/services/privacy.js');
    const old = (await call('POST', '/api/tickets', boss, { title: 'Längst erledigt', areaId: 1 })).json();
    await t.db.query("UPDATE tickets SET status = 'done', done_at = now() - interval '400 days' WHERE id = $1", [old.id]);
    await t.db.query("INSERT INTO event_log (at, direction, message, status) VALUES (now() - interval '200 days', 'out', 'uralt', 'sent')");
    await t.db.query("UPDATE sessions SET expires_at = now() - interval '1 day' WHERE id = (SELECT id FROM sessions ORDER BY created_at LIMIT 1)");

    let r = await applyRetention(t.ctx); // defaults: log 90 days, tickets kept
    expect(r.sessions).toBe(1);
    expect(r.log).toBeGreaterThanOrEqual(1);
    expect(r.tickets).toBe(0);
    await call('PATCH', '/api/settings', boss, { retention: { doneTicketsDays: 365 } });
    r = await applyRetention(t.ctx);
    expect(r.tickets).toBeGreaterThanOrEqual(1);
    expect((await call('GET', `/api/tickets/${old.id}`, boss)).statusCode).toBe(404);
    expect((await call('PATCH', '/api/settings', boss, { retention: { logDays: -1 } })).statusCode).toBe(400);
  });
});

describe('nfc tags', () => {
  let anna: string;
  beforeAll(async () => { anna = await t.login('member'); });
  const scan = async (code: string, who = anna) => (await call('POST', `/api/tags/scan/${code}`, who)).json();

  it('closes a ticket and follows a repeating series', async () => {
    const ticket = (await call('POST', '/api/tickets', anna, { title: 'Müll raus', areaId: 2, due: '2030-01-07', recurrence: { every: 1, unit: 'week' } })).json();
    const tag = (await call('POST', '/api/tags', anna, { name: 'Mülltonne', action: 'done', ticketId: ticket.id })).json();
    expect(tag.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const first = await scan(tag.code);
    expect(first).toMatchObject({ tag: 'Mülltonne', action: 'done', result: 'done', ticketId: ticket.id });
    expect(first.followupId).toBeGreaterThan(ticket.id);
    // the next scan works on the next ticket of the series
    const second = await scan(tag.code);
    expect(second).toMatchObject({ result: 'done', ticketId: first.followupId });
    const list = (await call('GET', '/api/tags', anna)).json().find((x: { id: number }) => x.id === tag.id);
    expect(list).toMatchObject({ scans: 2, ticketId: second.followupId, ticketStatus: "open", lastScanBy: expect.any(String) });
  });

  it('starts and stops the timer for whoever scans', async () => {
    const ticket = (await call('POST', '/api/tickets', anna, { title: 'Wäsche', areaId: 2 })).json();
    const tag = (await call('POST', '/api/tags', anna, { name: 'Waschmaschine', action: 'timer', ticketId: ticket.id })).json();
    expect(await scan(tag.code)).toMatchObject({ action: 'timer', result: 'started' });
    expect((await call('GET', '/api/timer', anna)).json().map((x: { ticketId: number }) => x.ticketId)).toContain(ticket.id);
    expect(await scan(tag.code)).toMatchObject({ result: 'stopped' });
    expect((await call('GET', '/api/timer', anna)).json().map((x: { ticketId: number }) => x.ticketId)).not.toContain(ticket.id);
  });

  it('creates a ticket once until it is done', async () => {
    const tag = (await call('POST', '/api/tags', anna, { name: 'Kaffeemaschine', action: 'create', title: 'Entkalken', areaId: 2, prio: 'high' })).json();
    const made = await scan(tag.code);
    expect(made).toMatchObject({ action: 'create', result: 'created', title: 'Entkalken' });
    const ticket = (await call('GET', `/api/tickets/${made.ticketId}`, anna)).json();
    expect(ticket).toMatchObject({ prio: 'high', area: 'Zuhause', status: 'open', source: 'app' });
    expect(ticket.due).not.toBeNull();
    expect(await scan(tag.code)).toMatchObject({ result: 'exists', ticketId: made.ticketId });
    await call('PATCH', `/api/tickets/${made.ticketId}`, anna, { status: 'done' });
    expect((await scan(tag.code)).ticketId).not.toBe(made.ticketId);
  });

  it('checks input and access', async () => {
    expect((await call('POST', '/api/tags', anna, { name: 'x', action: 'done' })).statusCode).toBe(400);
    expect((await call('POST', '/api/tags', anna, { name: 'x', action: 'create' })).statusCode).toBe(400);
    expect((await call('POST', '/api/tags/scan/unbekannt', anna)).statusCode).toBe(404);
    const ticket = (await call('POST', '/api/tickets', anna, { title: 'Lesen', areaId: 1 })).json();
    const tag = (await call('POST', '/api/tags', anna, { name: 'Leser', action: 'done', ticketId: ticket.id })).json();
    const reader2 = await t.login('read');
    expect((await call('POST', `/api/tags/scan/${tag.code}`, reader2)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/tags/${tag.id}`, anna)).statusCode).toBe(204);
    expect((await call('POST', `/api/tags/scan/${tag.code}`, anna)).statusCode).toBe(404);
  });

  it('takes scans from Home Assistant and learns unknown tags', async () => {
    const boss = await t.login('admin');
    const { token } = (await call('POST', '/api/tokens', boss, { name: 'HA', scope: 'tickets:write' })).json();
    const bearer = { authorization: `Bearer ${token}` };
    const ha = (body: unknown) => call('POST', '/api/tags/ha', undefined, body, bearer);

    expect((await ha({ tagId: 'ha-1234' })).json()).toEqual({ result: 'unknown' });
    expect((await call('GET', '/api/tags/ha/last', anna)).json()).toMatchObject({ tagId: 'ha-1234' });

    const ticket = (await call('POST', '/api/tickets', anna, { title: 'Spülmaschine ausräumen', areaId: 2, assigneeId: null })).json();
    const tag = (await call('POST', '/api/tags', anna, { name: 'Spüler', action: 'done', ticketId: ticket.id, haTagId: 'ha-1234' })).json();
    expect((await call('GET', '/api/tags/ha/last', anna)).json()).toEqual({ tagId: null });
    expect((await ha({ tagId: 'ha-1234' })).json()).toMatchObject({ result: 'done', ticketId: ticket.id });
    expect((await call('GET', `/api/tickets/${ticket.id}`, anna)).json().status).toBe('done');
    // one Home Assistant tag belongs to one Tasklog tag
    expect((await call('PATCH', `/api/tags/${tag.id}`, anna, { haTagId: 'ha-1234' })).statusCode).toBe(200);
    const other = (await call('POST', '/api/tags', anna, { name: 'Zweiter', action: 'done', ticketId: ticket.id, haTagId: 'ha-1234' }));
    expect(other.statusCode).toBe(409);
  });
});

describe('changes sent later by the offline app', () => {
  it('starts, stops and adds time at the moment it happened', async () => {
    const who = await t.login('member');
    const ticket = (await call('POST', '/api/tickets', who, { title: 'Offline-Zeit', areaId: 1 })).json();
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    expect((await call('POST', `/api/tickets/${ticket.id}/timer`, who, { at: ago(50) })).statusCode).toBe(200);
    const [running] = (await call('GET', '/api/timer', who)).json();
    expect(Math.round((Date.now() - Date.parse(running.startedAt)) / 60_000)).toBe(50);
    await call('POST', '/api/timer/stop', who, { ticketId: ticket.id, at: ago(20) });
    await call('POST', `/api/tickets/${ticket.id}/time`, who, { minutes: 10, at: ago(5) });
    const after = (await call('GET', `/api/tickets/${ticket.id}`, who)).json();
    expect(after.minutes).toBeGreaterThanOrEqual(40); // 30 tracked (or rounded up) + 10 added
    expect(after.minutes).toBeLessThanOrEqual(55);
    expect((await call('POST', `/api/tickets/${ticket.id}/timer`, who, { at: ago(8 * 24 * 60) })).statusCode).toBe(400);
  });
});

describe('time rounding', () => {
  it('rounds to any number of minutes or keeps seconds', async () => {
    const boss = await t.login('admin');
    const who = await t.login('member');
    const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    const track = async (seconds: number) => {
      const ticket = (await call('POST', '/api/tickets', who, { title: `Raster ${seconds}`, areaId: 1 })).json();
      await call('POST', `/api/tickets/${ticket.id}/timer`, who, { at: ago(seconds) });
      await call('POST', '/api/timer/stop', who, { ticketId: ticket.id });
      return (await call('GET', `/api/tickets/${ticket.id}`, who)).json();
    };
    expect((await call('PATCH', '/api/settings', boss, { rounding: 6 })).statusCode).toBe(200);
    expect((await track(7 * 60)).minutes).toBe(12); // 7 min → next 6-minute step
    await call('PATCH', '/api/settings', boss, { rounding: 0 });
    const exact = await track(95);
    expect(exact.seconds).toBeGreaterThanOrEqual(95);
    expect(exact.seconds).toBeLessThan(98);
    expect((await call('GET', '/api/system', who)).json().exactTime).toBe(true);
    const csv = (await call('GET', '/api/reports/time?format=csv', boss)).body;
    expect(csv.split('\r\n')[0]).toContain('Dauer;Sekunden;Stunden');
    expect((await call('PATCH', '/api/settings', boss, { rounding: 481 })).statusCode).toBe(400);
    await call('PATCH', '/api/settings', boss, { rounding: 15 });
  });
});

describe('home assistant to-do lists linked to areas', () => {
  it('keeps an area and a list in step, both ways', async () => {
    const { syncHaTodos } = await import('../src/services/haTodo.js');
    const boss = await t.login('admin');
    const ha = await fakeHomeAssistant();
    await call('PATCH', '/api/settings', boss, { ha: { url: ha.url, token: 'ha-token' } });
    const area = (await call('POST', '/api/areas', boss, { name: 'Einkauf', icon: 'shopping-cart' })).json();
    ha.todos.set('todo.einkaufsliste', [
      { uid: 'a', summary: 'Milch', status: 'needs_action' },
      { uid: 'b', summary: 'Alt, schon erledigt', status: 'completed' },
      { uid: 'c', summary: 'Brot', status: 'needs_action', due: '2030-06-01' },
    ]);
    // 127: create, delete, update, move, due date, due time, description — like a local to-do list.
    ha.states.set('todo.einkaufsliste', { state: '2', attributes: { friendly_name: 'Einkaufsliste', supported_features: 127 } });
    ha.states.set('todo.tasklog_zuhause', { state: '3', attributes: {} });
    const mine = (await call('POST', '/api/tickets', boss, { title: 'Eier', areaId: area.id, due: '2030-06-02', dueTime: '18:00' })).json();

    const offer = (await call('GET', '/api/ha/todo-links', boss)).json();
    expect(offer.lists.map((l: { id: string }) => l.id)).toEqual(['todo.einkaufsliste']); // not the integration's own lists
    expect((await call('PUT', `/api/areas/${area.id}/ha-todo`, boss, { entity: 'todo.tasklog_zuhause' })).statusCode).toBe(400);
    expect((await call('PUT', `/api/areas/${area.id}/ha-todo`, boss, { entity: 'todo.einkaufsliste' })).statusCode).toBe(200);

    // Open items came over, ticked-off ones did not; the ticket went to the list with its date and time.
    const inArea = async () => (await call('GET', `/api/tickets?areaId=${area.id}`, boss)).json() as { id: number; title: string; status: string; due: string | null; source: string }[];
    const tickets = await inArea();
    expect(tickets.map(x => x.title).sort()).toEqual(['Brot', 'Eier', 'Milch']);
    expect(tickets.find(x => x.title === 'Brot')).toMatchObject({ due: '2030-06-01', source: 'ha' });
    const list = () => ha.todos.get('todo.einkaufsliste')!;
    expect(list().find(i => i.summary === 'Eier')).toMatchObject({ due: '2030-06-02 18:00:00', status: 'needs_action' });
    const status = (await call('GET', '/api/ha/todo-links', boss)).json().areas.find((a: { id: number }) => a.id === area.id);
    expect(status).toMatchObject({ entity: 'todo.einkaufsliste', linked: 3, error: null });
    expect(status.syncedAt).not.toBeNull();

    // Ticked off and renamed in Home Assistant.
    list().find(i => i.summary === 'Milch')!.status = 'completed';
    list().find(i => i.summary === 'Brot')!.summary = 'Vollkornbrot';
    await syncHaTodos(t.ctx);
    let now = await inArea();
    expect(now.find(x => x.title === 'Milch')?.status).toBe('done');
    expect(now.some(x => x.title === 'Vollkornbrot')).toBe(true);

    // Done and renamed in Tasklog.
    await call('PATCH', `/api/tickets/${mine.id}`, boss, { status: 'done', title: 'Eier (10)' });
    await syncHaTodos(t.ctx);
    expect(list().find(i => i.uid === list().find(x => x.summary === 'Eier (10)')?.uid)).toMatchObject({ status: 'completed' });

    // Removed in HA closes the ticket; deleted in Tasklog removes the item.
    const brot = now.find(x => x.title === 'Vollkornbrot')!;
    ha.todos.set('todo.einkaufsliste', list().filter(i => i.summary !== 'Vollkornbrot'));
    await syncHaTodos(t.ctx);
    expect((await call('GET', `/api/tickets/${brot.id}`, boss)).json().status).toBe('done');
    const milk = now.find(x => x.title === 'Milch')!;
    await call('DELETE', `/api/tickets/${milk.id}`, boss);
    await syncHaTodos(t.ctx);
    expect(list().some(i => i.summary === 'Milch')).toBe(false);

    // Due date and description: set in HA, changed in Tasklog, cleared in HA.
    const eggs = list().find(i => i.summary === 'Eier (10)')!;
    eggs.status = 'needs_action';
    await syncHaTodos(t.ctx);
    const cheese: { uid: string; summary: string; status: 'needs_action'; due?: string; description?: string } = { uid: 'k', summary: 'Käse', status: 'needs_action' };
    list().push(cheese);
    await syncHaTodos(t.ctx);
    const cheeseTicket = (await inArea()).find(x => x.title === 'Käse')!;
    Object.assign(cheese, { due: '2030-07-01T09:30:00+02:00', description: 'Gouda' });
    await syncHaTodos(t.ctx);
    expect((await call('GET', `/api/tickets/${cheeseTicket.id}`, boss)).json()).toMatchObject({ due: '2030-07-01', dueTime: '09:30', description: 'Gouda' });
    await call('PATCH', `/api/tickets/${cheeseTicket.id}`, boss, { due: '2030-07-03', dueTime: null, description: 'Emmentaler' });
    await syncHaTodos(t.ctx);
    expect(cheese).toMatchObject({ due: '2030-07-03', description: 'Emmentaler' });
    delete cheese.due;
    await syncHaTodos(t.ctx);
    expect((await call('GET', `/api/tickets/${cheeseTicket.id}`, boss)).json().due).toBeNull();

    // Links from before this knew no dates: what HA has wins once.
    await t.db.query("UPDATE ha_todo_links SET due = NULL, description = NULL WHERE uid = 'k'");
    cheese.due = '2030-08-08';
    await syncHaTodos(t.ctx);
    expect((await call('GET', `/api/tickets/${cheeseTicket.id}`, boss)).json().due).toBe('2030-08-08');

    // Running it again changes nothing.
    const before = JSON.stringify(list());
    const calls = ha.calls.length;
    await syncHaTodos(t.ctx);
    expect(JSON.stringify(list())).toBe(before);
    expect(ha.calls.filter((c, i) => i >= calls && c.method === 'POST' && !c.path.includes('get_items'))).toHaveLength(0);

    // A shopping list without dates takes the title alone; one list belongs to one area.
    const shop = (await call('POST', '/api/areas', boss, { name: 'Laden', icon: 'storefront' })).json();
    ha.todos.set('todo.shopping_list', []);
    await call('POST', '/api/tickets', boss, { title: 'Kaffee', areaId: shop.id, due: '2030-01-01' });
    await call('PUT', `/api/areas/${shop.id}/ha-todo`, boss, { entity: 'todo.shopping_list' });
    expect(ha.todos.get('todo.shopping_list')).toEqual([expect.objectContaining({ summary: 'Kaffee', status: 'needs_action' })]);
    expect((await call('PUT', `/api/areas/${shop.id}/ha-todo`, boss, { entity: 'todo.einkaufsliste' })).statusCode).toBe(409);

    // A list that is gone shows its error at the area.
    ha.todos.delete('todo.shopping_list');
    await syncHaTodos(t.ctx);
    const broken = (await call('GET', '/api/ha/todo-links', boss)).json().areas.find((a: { id: number }) => a.id === shop.id);
    expect(broken.error).toContain('todo.shopping_list');
    await call('PUT', `/api/areas/${shop.id}/ha-todo`, boss, { entity: null });
    await call('PUT', `/api/areas/${area.id}/ha-todo`, boss, { entity: null });
    expect((await t.db.query('SELECT count(*)::int AS n FROM ha_todo_links')).rows[0].n).toBe(0);
    await ha.close();
  });
});
