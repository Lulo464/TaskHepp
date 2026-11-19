import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEvent } from '../src/lib/icalParse.js';
import { setup, type TestApp } from './helpers.js';

let t: TestApp;
let anna: string;
let annaId: number;
let auth: string;

beforeAll(async () => {
  t = await setup();
  anna = await t.login('member');
  const call = (method: string, url: string) => t.app.inject({ method: method as 'GET', url, headers: { cookie: anna } });
  const me = (await call('GET', '/api/me')).json();
  annaId = me.id;
  const { password } = (await call('POST', '/api/me/caldav/password')).json();
  auth = `Basic ${Buffer.from(`${me.email}:${password}`).toString('base64')}`;
});
afterAll(() => t.close());

const dav = (method: string, url: string, body?: string, headers: Record<string, string> = {}) =>
  t.app.inject({ method: method as 'GET', url, payload: body, headers: { authorization: auth, 'content-type': 'application/xml', ...headers } });
const api = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => t.app.inject({ method, url, payload: payload as object, headers: { cookie: anna } });

const PROPFIND_CALENDARS = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop><d:resourcetype/><d:displayname/><cs:getctag/><c:supported-calendar-component-set/><d:sync-token/></d:prop></d:propfind>`;
const event = (uid: string, start: string, summary: string, extra = '') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20300101T000000Z\r\n${start}\r\nSUMMARY:${summary}\r\n${extra}BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:nicht diese\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('caldav', () => {
  it('needs the calendar password', async () => {
    const res = await t.app.inject({ method: 'PROPFIND' as 'GET', url: '/dav/' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
    const wrong = await t.app.inject({ method: 'PROPFIND' as 'GET', url: '/dav/', headers: { authorization: `Basic ${Buffer.from('admin@example.com:falsch').toString('base64')}` } });
    expect(wrong.statusCode).toBe(401);
    expect((await t.app.inject({ method: 'OPTIONS', url: '/dav/' })).headers.dav).toContain('calendar-access');
    const wk = await t.app.inject({ method: 'PROPFIND' as 'GET', url: '/.well-known/caldav' });
    expect(wk.statusCode).toBe(301);
    expect(wk.headers.location).toBe('/dav/');
  });

  it('leads apps from the principal to one calendar per area', async () => {
    const root = await dav('PROPFIND', '/dav/', '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>');
    expect(root.statusCode).toBe(207);
    expect(root.body).toContain(`<d:current-user-principal><d:href>/dav/principals/${annaId}/</d:href>`);
    const principal = await dav('PROPFIND', `/dav/principals/${annaId}/`, '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/><c:calendar-user-address-set/></d:prop></d:propfind>');
    expect(principal.body).toContain(`<c:calendar-home-set><d:href>/dav/calendars/${annaId}/</d:href>`);
    const home = await dav('PROPFIND', `/dav/calendars/${annaId}/`, PROPFIND_CALENDARS, { depth: '1' });
    expect(home.statusCode).toBe(207);
    expect(home.body).toContain(`<d:href>/dav/calendars/${annaId}/2/</d:href>`);
    expect(home.body).toContain('<d:displayname>Zuhause (Tasklog)</d:displayname>');
    expect(home.body).toContain('<c:calendar/>');
    expect(home.body).toContain('<c:comp name="VEVENT"/>');
    // Asked for but unknown: listed as 404, as the protocol wants.
    expect(home.body).toMatch(/<x:sync-token xmlns:x="DAV:"\/><\/d:prop><d:status>HTTP\/1.1 404/);
    expect((await dav('PROPFIND', `/dav/principals/${annaId + 999}/`, '')).statusCode).toBe(403);
  });

  it('lists tickets with a due date as events and serves them', async () => {
    const ticket = (await api('POST', '/api/tickets', { title: 'Zahnarzt; mit Oma', areaId: 2, due: '2030-03-04', dueTime: '09:30', description: 'Karte mitnehmen' })).json();
    await api('POST', '/api/tickets', { title: 'Ohne Datum', areaId: 2 });
    const list = await dav('PROPFIND', `/dav/calendars/${annaId}/2/`, '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>', { depth: '1' });
    expect(list.body).toContain(`/dav/calendars/${annaId}/2/${ticket.id}.ics`);
    expect(list.body).not.toContain('Ohne Datum');
    const get = await dav('GET', `/dav/calendars/${annaId}/2/${ticket.id}.ics`);
    expect(get.statusCode).toBe(200);
    expect(get.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
    // 09:30 in Berlin in March is 08:30 UTC; text is escaped.
    expect(get.body).toContain('DTSTART:20300304T083000Z');
    expect(get.body).toContain('SUMMARY:Zahnarzt\\; mit Oma');
    expect(get.body).toContain('DESCRIPTION:Karte mitnehmen');
    const multiget = await dav('REPORT', `/dav/calendars/${annaId}/2/`,
      `<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><d:href>/dav/calendars/${annaId}/2/${ticket.id}.ics</d:href><d:href>/dav/calendars/${annaId}/2/weg.ics</d:href></c:calendar-multiget>`);
    expect(multiget.statusCode).toBe(207);
    expect(multiget.body).toContain('<c:calendar-data>BEGIN:VCALENDAR');
    expect(multiget.body).toMatch(/weg\.ics<\/d:href><d:status>HTTP\/1.1 404/);
  });

  it('turns a new event into a ticket, and changes in the calendar into changes of the ticket', async () => {
    const url = `/dav/calendars/${annaId}/2/ABC-123.ics`;
    const created = await dav('PUT', url, event('abc-123@iphone', 'DTSTART;TZID=Europe/Berlin:20300710T143000\r\nDTEND;TZID=Europe/Berlin:20300710T153000', 'Reifen wechseln', 'DESCRIPTION:Termin\\, bitte pünktlich\r\n'), { 'content-type': 'text/calendar', 'if-none-match': '*' });
    expect(created.statusCode).toBe(201);
    const [ticket] = (await api('GET', '/api/tickets?q=Reifen wechseln')).json();
    expect(ticket).toMatchObject({ area: 'Zuhause', due: '2030-07-10', dueTime: '14:30', description: 'Termin, bitte pünktlich', assigneeId: annaId });
    // The app finds it again under its own name, with its own UID.
    const back = await dav('GET', url);
    expect(back.statusCode).toBe(200);
    expect(back.body).toContain('UID:abc-123@iphone');

    // Moved to another day (all day now) and renamed.
    expect((await dav('PUT', url, event('abc-123@iphone', 'DTSTART;VALUE=DATE:20300712', 'Winterreifen wechseln'), { 'content-type': 'text/calendar', 'if-match': back.headers.etag as string })).statusCode).toBe(204);
    expect((await api('GET', `/api/tickets/${ticket.id}`)).json()).toMatchObject({ title: 'Winterreifen wechseln', due: '2030-07-12', dueTime: null });
    // A stale ETag is refused.
    expect((await dav('PUT', url, event('abc-123@iphone', 'DTSTART;VALUE=DATE:20300713', 'x'), { 'content-type': 'text/calendar', 'if-match': back.headers.etag as string })).statusCode).toBe(412);

    // UTC times are converted to local time.
    await dav('PUT', `/dav/calendars/${annaId}/2/utc.ics`, event('utc@x', 'DTSTART:20301215T170000Z', 'Weihnachtsfeier'), { 'content-type': 'text/calendar' });
    expect((await api('GET', '/api/tickets?q=Weihnachtsfeier')).json()[0]).toMatchObject({ due: '2030-12-15', dueTime: '18:00' });

    // Moved to the calendar of another area: same UID, the ticket changes area instead of doubling.
    expect((await dav('PUT', `/dav/calendars/${annaId}/1/ABC-123.ics`, event('abc-123@iphone', 'DTSTART;VALUE=DATE:20300712', 'Winterreifen wechseln'), { 'content-type': 'text/calendar' })).statusCode).toBe(204);
    expect((await api('GET', `/api/tickets/${ticket.id}`)).json().area).toBe('Arbeit');
    expect((await dav('DELETE', url)).statusCode).toBe(404); // the app then deletes the old copy: already gone there
    expect((await api('GET', '/api/tickets?q=Winterreifen')).json()).toHaveLength(1);

    // Deleting the event finishes the ticket.
    expect((await dav('DELETE', `/dav/calendars/${annaId}/1/ABC-123.ics`)).statusCode).toBe(204);
    expect((await api('GET', `/api/tickets/${ticket.id}`)).json().status).toBe('done');
    expect((await dav('GET', `/dav/calendars/${annaId}/1/ABC-123.ics`)).statusCode).toBe(404);
  });

  it('changes made in Tasklog show up as new ETags and a new ctag', async () => {
    const ticket = (await api('POST', '/api/tickets', { title: 'Ctag-Test', areaId: 1, due: '2030-05-05' })).json();
    const ctag = async () => (await dav('PROPFIND', `/dav/calendars/${annaId}/1/`, PROPFIND_CALENDARS)).body.match(/<cs:getctag>([^<]+)</)?.[1];
    const etag = async () => (await dav('GET', `/dav/calendars/${annaId}/1/${ticket.id}.ics`)).headers.etag;
    const [c1, e1] = [await ctag(), await etag()];
    await new Promise(r => setTimeout(r, 1100));
    await api('PATCH', `/api/tickets/${ticket.id}`, { title: 'Ctag-Test geändert' });
    expect(await ctag()).not.toBe(c1);
    expect(await etag()).not.toBe(e1);
  });

  it('lets readers look but not write, and keeps people to their own calendars', async () => {
    const reader = await t.login('read');
    const readerMe = (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: reader } })).json();
    const { password } = (await t.app.inject({ method: 'POST', url: '/api/me/caldav/password', headers: { cookie: reader } })).json();
    const readerAuth = `Basic ${Buffer.from(`${readerMe.email}:${password}`).toString('base64')}`;
    const put = await t.app.inject({ method: 'PUT', url: `/dav/calendars/${readerMe.id}/2/x.ics`, payload: event('x@y', 'DTSTART;VALUE=DATE:20300101', 'Nein'), headers: { authorization: readerAuth, 'content-type': 'text/calendar' } });
    expect(put.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'PROPFIND' as 'GET', url: `/dav/calendars/${annaId}/`, headers: { authorization: readerAuth } })).statusCode).toBe(404);
    // Revoking the password locks the calendar app out.
    await t.app.inject({ method: 'DELETE', url: '/api/me/caldav/password', headers: { cookie: reader } });
    expect((await t.app.inject({ method: 'PROPFIND' as 'GET', url: '/dav/', headers: { authorization: readerAuth } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/me/caldav', headers: { cookie: reader } })).json()).toMatchObject({ hasPassword: false, username: readerMe.email });
  });
});

describe('reading events', () => {
  it('reads the event, not its alarm, and unfolds long lines', () => {
    const e = parseEvent(event('u1', 'DTSTART;TZID="Europe/Berlin":20300101T080000', 'Langer Titel der über\r\n  zwei Zeilen geht', 'DESCRIPTION:a\\nb\r\n'));
    expect(e).toMatchObject({ component: 'VEVENT', uid: 'u1', summary: 'Langer Titel der über zwei Zeilen geht', description: 'a\nb', start: { date: '2030-01-01', time: '08:00', zone: { tzid: 'Europe/Berlin' } } });
    expect(parseEvent('BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nEND:VTODO\r\nEND:VCALENDAR')?.component).toBe('VTODO');
    expect(parseEvent('kaputt')).toBeNull();
  });
});
