import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { ImapFlow } from 'imapflow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestApp } from './helpers.js';

const require = createRequire(import.meta.url);
const hoodiecrow = require('hoodiecrow-imap') as (opts: object) => { listen: (port: number, host: string, cb: () => void) => void; close: (cb?: () => void) => void; server?: { address: () => AddressInfo }; address?: () => AddressInfo };

// Encoded like real mail: RFC 2047 subject, base64 UTF-8 body.
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const raw = (from: string, subject: string, body: string, id: string) =>
  `From: ${from}\r\nSubject: =?UTF-8?B?${b64(subject)}?=\r\nMessage-ID: <${id}@test>\r\nDate: Wed, 28 Oct 2026 08:00:00 +0100\r\n` +
  `MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body.replace(/\n/g, '\r\n'))}`;

let t: TestApp;
let admin: string;
let imap: ReturnType<typeof hoodiecrow>;
let port: number;

beforeAll(async () => {
  t = await setup();
  admin = await t.login('admin');
  imap = hoodiecrow({
    plugins: ['MOVE', 'UIDPLUS'],
    storage: {
      INBOX: {
        messages: [
          { raw: raw('Anna <anna@example.com>', 'Einkauf', 'Hallo,\n- Milch kaufen\n- Brot holen\n- Müll rausbringen\n\nDanke', 'm1'), flags: [] },
          { raw: raw('Shop <newsletter@shop.de>', 'Angebote der Woche', 'Rabatt!', 'm2'), flags: [] },
          { raw: raw('Werkstatt <info@werkstatt.de>', 'Termin bestätigt', 'Ihr Termin am 05.11.2026 um 14:30 ist bestätigt.', 'm3'), flags: [] },
          { raw: raw('Alt <alt@example.com>', 'Schon gelesen', 'alt', 'm4'), flags: ['\\Seen'] },
        ],
      },
      '': { separator: '/', folders: { Archiv: {} } },
    },
  });
  await new Promise<void>(r => imap.listen(0, '127.0.0.1', r));
  port = (imap.server ?? (imap as unknown as { address: () => AddressInfo })).address().port;
});

afterAll(async () => {
  await new Promise<void>(r => imap.close(() => r()));
  await t.close();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object, headers: { cookie: admin } });

const account = () => ({
  name: 'Familie', host: '127.0.0.1', port, tls: 'none', username: 'testuser', password: 'testpass', mailbox: 'INBOX',
  pollMinutes: 5, onlyUnseen: true, afterImport: 'seen', moveTo: '', enabled: true,
});

const rule = (over: object) => ({
  name: 'R', enabled: true, fromContains: '', subjectContains: '', bodyContains: '', subjectPattern: '', action: 'ticket', split: 'none',
  splitPattern: '', titleTemplate: '{subject}', descriptionTemplate: '{body}', areaId: 2, prio: 'normal', dueMode: 'none', dueDays: 0,
  dueTime: null, continueAfter: false, ...over,
});

async function inboxState() {
  const c = new ImapFlow({ host: '127.0.0.1', port, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock('INBOX');
  const out: { subject: string; seen: boolean }[] = [];
  try {
    if (c.mailbox && c.mailbox.exists) {
      for await (const m of c.fetch('1:*', { envelope: true, flags: true })) out.push({ subject: m.envelope?.subject ?? '', seen: m.flags?.has('\\Seen') ?? false });
    }
  } finally {
    lock.release();
  }
  const archiv = await c.status('Archiv', { messages: true });
  await c.logout();
  return { inbox: out, archived: (archiv && archiv.messages) || 0 };
}

describe('mail import', () => {
  let id: number;
  let catchAll: number;

  it('creates a mailbox with a catch-all rule and never returns the password', async () => {
    const res = await call('POST', '/api/mail/accounts', account());
    expect(res.statusCode).toBe(201);
    id = res.json().id;
    expect(res.json()).toMatchObject({ hasPassword: true, enabled: true });
    expect(JSON.stringify(res.json())).not.toContain('testpass');
    const rules = (await call('GET', `/api/mail/accounts/${id}/rules`)).json();
    expect(rules).toHaveLength(1);
    catchAll = rules[0].id;
  });

  it('tests the connection and lists folders', async () => {
    const res = (await call('POST', `/api/mail/accounts/${id}/test`)).json();
    expect(res).toMatchObject({ ok: true, mailboxExists: true, messages: 4, unseen: 3 });
    expect(res.folders).toEqual(expect.arrayContaining(['INBOX', 'Archiv']));
  });

  it('reports a wrong password readably', async () => {
    const bad = (await call('POST', '/api/mail/accounts', { ...account(), name: 'Falsch', password: 'nope' })).json();
    const res = await call('POST', `/api/mail/accounts/${bad.id}/poll`);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('Anmeldung fehlgeschlagen');
    expect((await call('GET', '/api/mail/accounts')).json().find((a: { id: number }) => a.id === bad.id).lastError).toBeTruthy();
    await call('DELETE', `/api/mail/accounts/${bad.id}`);
  });

  it('previews what the mails would become without touching them', async () => {
    await call('POST', `/api/mail/accounts/${id}/rules`, rule({ name: 'Newsletter weg', fromContains: 'newsletter', action: 'ignore' }));
    await call('POST', `/api/mail/accounts/${id}/rules`, rule({ name: 'Einkaufsliste', subjectContains: 'einkauf', split: 'bullets', titleTemplate: '{item}', descriptionTemplate: 'Von {fromName}' }));
    await call('POST', `/api/mail/accounts/${id}/rules`, rule({ name: 'Termine', subjectContains: 'termin', titleTemplate: 'Termin: {fromName}', dueMode: 'detect' }));
    const all = (await call('GET', `/api/mail/accounts/${id}/rules`)).json() as { id: number }[];
    // catch-all last
    await call('PUT', `/api/mail/accounts/${id}/rules/order`, [...all.filter(r => r.id !== catchAll).map(r => r.id), catchAll]);

    const preview = (await call('GET', `/api/mail/accounts/${id}/preview`)).json();
    expect(preview.map((p: { subject: string }) => p.subject)).toEqual(['Schon gelesen', 'Termin bestätigt', 'Angebote der Woche', 'Einkauf']);
    const einkauf = preview.find((p: { subject: string }) => p.subject === 'Einkauf');
    expect(einkauf.plan.tickets.map((x: { title: string }) => x.title)).toEqual(['Milch kaufen', 'Brot holen', 'Müll rausbringen']);
    expect(preview.find((p: { subject: string }) => p.subject === 'Angebote der Woche').plan.result).toBe('ignored');
    expect((await inboxState()).inbox.filter(m => m.seen)).toHaveLength(1); // untouched
    expect((await call('GET', '/api/tickets?source=mail')).json()).toHaveLength(0);
  });

  it('imports unread mails once, several tickets per mail, and marks them read', async () => {
    const res = (await call('POST', `/api/mail/accounts/${id}/poll`)).json();
    expect(res).toEqual({ messages: 3, tickets: 4 });

    const tickets = (await call('GET', '/api/tickets?source=mail')).json() as { title: string; due: string | null; dueTime: string | null; area: string; description: string }[];
    expect(tickets.map(x => x.title).sort()).toEqual(['Brot holen', 'Milch kaufen', 'Müll rausbringen', 'Termin: Werkstatt']);
    expect(tickets.find(x => x.title === 'Termin: Werkstatt')).toMatchObject({ due: '2026-11-05', dueTime: '14:30', area: 'Zuhause' });
    expect(tickets.find(x => x.title === 'Milch kaufen')!.description).toBe('Von Anna');

    const state = await inboxState();
    expect(state.inbox.every(m => m.seen)).toBe(true);

    expect((await call('POST', `/api/mail/accounts/${id}/poll`)).json()).toEqual({ messages: 0, tickets: 0 });
    const log = (await call('GET', `/api/mail/accounts/${id}/imports`)).json();
    expect(log.map((l: { result: string }) => l.result).sort()).toEqual(['created', 'created', 'ignored']);
    expect(log.find((l: { subject: string }) => l.subject === 'Einkauf')).toMatchObject({ rules: ['Einkaufsliste'], ticketIds: expect.any(Array) });
  });

  it('leaves unmatched mails unread but does not look at them again', async () => {
    await call('PATCH', `/api/mail/rules/${catchAll}`, { enabled: false });
    await appendMail(raw('Unbekannt <x@y.de>', 'Irgendwas', 'Text', 'm5'));
    expect((await call('POST', `/api/mail/accounts/${id}/poll`)).json()).toEqual({ messages: 1, tickets: 0 });
    expect((await inboxState()).inbox.find(m => m.subject === 'Irgendwas')!.seen).toBe(false);
    expect((await call('POST', `/api/mail/accounts/${id}/poll`)).json()).toEqual({ messages: 0, tickets: 0 });
    await call('PATCH', `/api/mail/rules/${catchAll}`, { enabled: true });
  });

  it('can move imported mails to another folder', async () => {
    await call('PATCH', `/api/mail/accounts/${id}`, { afterImport: 'move', moveTo: 'Archiv' });
    await appendMail(raw('Chef <chef@firma.de>', 'Bitte Angebot schreiben', 'Bis Freitag', 'm6'));
    expect((await call('POST', `/api/mail/accounts/${id}/poll`)).json()).toEqual({ messages: 1, tickets: 1 });
    const state = await inboxState();
    expect(state.inbox.some(m => m.subject === 'Bitte Angebot schreiben')).toBe(false);
    expect(state.archived).toBe(1);
    const [ticket] = (await call('GET', '/api/tickets?q=Angebot schreiben')).json();
    expect(ticket.source).toBe('mail');
    expect((await call('GET', `/api/tickets/${ticket.id}/history`)).json()[0].kind).toBe('createdByMail');
  });

  it('runs the rules on a typed sample', async () => {
    const plan = (await call('POST', `/api/mail/accounts/${id}/try`, { from: 'Anna <anna@example.com>', subject: 'Einkauf Samstag', body: '- Eier\n- Käse' })).json();
    expect(plan).toMatchObject({ result: 'created', tickets: [{ title: 'Eier' }, { title: 'Käse' }] });
  });

  it('rejects invalid patterns', async () => {
    const res = await call('POST', `/api/mail/accounts/${id}/rules`, rule({ subjectPattern: '(' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Ungültiges Muster');
  });
});

async function appendMail(source: string) {
  const c = new ImapFlow({ host: '127.0.0.1', port, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false });
  await c.connect();
  await c.append('INBOX', source, []);
  await c.logout();
}
