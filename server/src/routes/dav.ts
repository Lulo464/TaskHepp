import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';
import { foldLine, icalDate, icalText, icalUtc } from '../lib/ical.js';
import { parseEvent, type ParsedStart } from '../lib/icalParse.js';
import { createTicket, setStatus } from '../services/tickets.js';

// — CalDAV —
// A small CalDAV server: one calendar per area with the user's open tickets that have a due date. Calendar apps
// (iPhone, DAVx⁵ on Android, Thunderbird) read and write it: moving an event changes the due date, renaming the title,
// a new event becomes a ticket, deleting an event marks the ticket done.

const NS = {
  d: 'DAV:',
  c: 'urn:ietf:params:xml:ns:caldav',
  cs: 'http://calendarserver.org/ns/',
  ical: 'http://apple.com/ns/ical/',
} as const;
type Prefix = keyof typeof NS;

/** Which namespace each property we know lives in. */
const PROP_NS: Record<string, Prefix> = {
  resourcetype: 'd', displayname: 'd', 'current-user-principal': 'd', 'principal-URL': 'd', owner: 'd', getetag: 'd',
  getcontenttype: 'd', 'supported-report-set': 'd', 'current-user-privilege-set': 'd', 'principal-collection-set': 'd',
  'calendar-home-set': 'c', 'calendar-user-address-set': 'c', 'supported-calendar-component-set': 'c', 'calendar-data': 'c',
  'calendar-description': 'c', getctag: 'cs', 'calendar-color': 'ical', 'calendar-order': 'ical',
};
const DEFAULT_PROPS = ['resourcetype', 'displayname', 'getetag', 'getcontenttype', 'getctag'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const etagOf = (body: string) => `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
const AREA_COLORS = ['#7C5CFFFF', '#2BB673FF', '#F0A477FF', '#3D9BE9FF', '#E05D8CFF', '#D4B04BFF'];

interface Requested { names: { name: string; ns: string }[]; all: boolean }

/** The properties a PROPFIND/REPORT asks for, with their namespaces; none or <allprop/> = our defaults. */
function requestedProps(xml: string): Requested {
  const nsMap: Record<string, string> = {};
  for (const m of xml.matchAll(/xmlns(?::([\w-]+))?\s*=\s*["']([^"']+)["']/g)) nsMap[m[1] ?? ''] = m[2];
  const prop = xml.match(/<(?:[\w-]+:)?prop(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?prop>/);
  if (!prop || /<(?:[\w-]+:)?allprop\b/.test(xml)) return { names: DEFAULT_PROPS.map(n => ({ name: n, ns: NS[PROP_NS[n]] })), all: true };
  const names: { name: string; ns: string }[] = [];
  for (const m of prop[1].matchAll(/<(?:([\w-]+):)?([\w-]+)(?:\s[^>]*)?\/?>/g)) {
    names.push({ name: m[2], ns: nsMap[m[1] ?? ''] ?? NS.d });
  }
  return { names, all: false };
}

/** One <response>: known properties with 200, the rest with 404. */
function response(href: string, props: Record<string, string>, requested: Requested) {
  const ok: string[] = [];
  const missing: string[] = [];
  for (const { name, ns } of requested.names) {
    const known = PROP_NS[name];
    if (known && NS[known] === ns && name in props) ok.push(`<${known}:${name}>${props[name]}</${known}:${name}>`);
    else if (!requested.all) missing.push(`<x:${name} xmlns:x="${esc(ns)}"/>`);
  }
  return `<d:response><d:href>${esc(href)}</d:href>` +
    (ok.length ? `<d:propstat><d:prop>${ok.join('')}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` : '') +
    (missing.length ? `<d:propstat><d:prop>${missing.join('')}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>` : '') +
    '</d:response>';
}

const multistatus = (responses: string[]) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="${NS.c}" xmlns:cs="${NS.cs}" xmlns:ical="${NS.ical}">${responses.join('')}</d:multistatus>`;

interface DavUser { id: number; email: string; name: string; role: 'admin' | 'member' | 'read'; hidden: number[] }
interface DavTicket { id: number; title: string; description: string; areaId: number; due: string; dueTime: string | null; start: Date | null; updatedAt: Date; href: string | null; uid: string | null }

export function davRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const host = new URL(config.PUBLIC_URL).host;
  const base = '/dav';
  for (const method of ['PROPFIND', 'REPORT', 'PROPPATCH', 'MKCALENDAR', 'MKCOL']) {
    if (!app.supportedMethods.includes(method)) app.addHttpMethod(method, { hasBody: true });
  }

  /** HTTP Basic with the e-mail address and the calendar password from Mehr → Kalender-Abo. */
  const authenticate = async (req: FastifyRequest): Promise<DavUser | null> => {
    const m = (req.headers.authorization ?? '').match(/^Basic\s+(.+)$/i);
    if (!m) return null;
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    const [login, password] = [decoded.slice(0, colon).trim(), decoded.slice(colon + 1)];
    const { rows: [u] } = await db.query<DavUser & { hash: string | null }>(
      `SELECT id, email, name, role, hidden_areas AS hidden, dav_password_hash AS hash FROM users WHERE lower(email) = lower($1)`, [login],
    );
    if (!u?.hash || !password || !safeEqual(sha256(password), u.hash)) return null;
    return u;
  };
  const challenge = (reply: FastifyReply) =>
    reply.code(401).header('WWW-Authenticate', 'Basic realm="Tasklog", charset="UTF-8"').header('Content-Type', 'text/plain; charset=utf-8').send('Anmeldung nötig: E-Mail-Adresse und Kalender-Passwort aus Tasklog (Mehr → Kalender-Abo).');

  const areasOf = async (u: DavUser) => (await db.query<{ id: number; name: string; position: number }>(
    'SELECT id, name, position FROM areas WHERE NOT (id = ANY($1::int[])) ORDER BY position, id', [u.hidden],
  )).rows;

  const TICKET_COLUMNS = `t.id, t.title, t.description, t.area_id AS "areaId", t.due_date::text AS due, to_char(t.due_time, 'HH24:MI') AS "dueTime",
    CASE WHEN t.due_time IS NOT NULL THEN (t.due_date + t.due_time) AT TIME ZONE $TZ END AS start,
    t.updated_at AS "updatedAt", t.dav_href AS href, t.dav_uid AS uid`;
  const ticketsIn = async (areaId: number) => (await db.query<DavTicket>(
    `SELECT ${TICKET_COLUMNS.replace('$TZ', '$2')} FROM tickets t
      WHERE t.area_id = $1 AND t.status <> 'done' AND t.due_date IS NOT NULL ORDER BY t.due_date, t.id`,
    [areaId, config.TZ],
  )).rows;
  const ticketByHref = async (areaId: number, file: string) => (await db.query<DavTicket>(
    `SELECT ${TICKET_COLUMNS.replace('$TZ', '$3')} FROM tickets t
      WHERE t.area_id = $1 AND t.status <> 'done' AND t.due_date IS NOT NULL
        AND (t.dav_href = $2 OR (t.dav_href IS NULL AND t.id::text || '.ics' = $2)) LIMIT 1`,
    [areaId, file, config.TZ],
  )).rows[0] ?? null;
  const fileOf = (t: DavTicket) => t.href ?? `${t.id}.ics`;
  const uidOf = (t: DavTicket) => t.uid ?? `ticket-${t.id}@${host}`;

  /** The ticket as a calendar object. Times go out in UTC so every app reads them the same. */
  const icsOf = (t: DavTicket) => {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tasklog//CalDAV//DE', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${uidOf(t)}`, `DTSTAMP:${icalUtc(t.updatedAt)}`, `LAST-MODIFIED:${icalUtc(t.updatedAt)}`];
    if (t.start) {
      lines.push(`DTSTART:${icalUtc(t.start)}`, `DTEND:${icalUtc(new Date(t.start.getTime() + 30 * 60_000))}`);
    } else {
      const [y, m, d] = t.due.split('-').map(Number);
      lines.push(`DTSTART;VALUE=DATE:${icalDate(t.due)}`, `DTEND;VALUE=DATE:${icalDate(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10))}`, 'TRANSP:TRANSPARENT');
    }
    lines.push(`SUMMARY:${icalText(t.title)}`);
    if (t.description) lines.push(`DESCRIPTION:${icalText(t.description)}`);
    lines.push(`URL:${new URL(`/#/ticket/${t.id}`, config.PUBLIC_URL).toString()}`, 'END:VEVENT', 'END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  };

  /** A start from the calendar app as Tasklog's local date and time. */
  const localStart = async (start: ParsedStart): Promise<{ due: string; dueTime: string | null }> => {
    if (!start.time) return { due: start.date, dueTime: null };
    const stamp = `${start.date} ${start.time}`;
    const convert = async (sql: string, params: unknown[]) => {
      const { rows: [r] } = await db.query<{ due: string; time: string }>(`SELECT to_char(x, 'YYYY-MM-DD') AS due, to_char(x, 'HH24:MI') AS time FROM (SELECT ${sql} AS x) s`, params);
      return { due: r.due, dueTime: r.time };
    };
    if (start.zone === 'utc') return convert('($1::timestamp AT TIME ZONE \'UTC\') AT TIME ZONE $2', [stamp, config.TZ]);
    if (typeof start.zone === 'object') {
      // Zone names Postgres does not know (e.g. Outlook's "W. Europe Standard Time") count as local time.
      return convert('($1::timestamp AT TIME ZONE $2) AT TIME ZONE $3', [stamp, start.zone.tzid, config.TZ]).catch(() => ({ due: start.date, dueTime: start.time }));
    }
    return { due: start.date, dueTime: start.time };
  };

  const calendarProps = (u: DavUser, area: { id: number; name: string; position: number }, ctag: string): Record<string, string> => ({
    resourcetype: '<d:collection/><c:calendar/>',
    displayname: esc(`${area.name} (Tasklog)`),
    'calendar-description': esc(`Tickets mit Fälligkeit im Bereich ${area.name}`),
    'supported-calendar-component-set': '<c:comp name="VEVENT"/>',
    'supported-report-set': '<d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report>',
    'current-user-privilege-set': u.role === 'read' ? '<d:privilege><d:read/></d:privilege>' : '<d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege>',
    owner: `<d:href>${base}/principals/${u.id}/</d:href>`,
    getctag: esc(ctag),
    'calendar-color': AREA_COLORS[area.position % AREA_COLORS.length] ?? AREA_COLORS[0],
    'calendar-order': String(area.position + 1),
  });
  const principalProps = (u: DavUser): Record<string, string> => ({
    resourcetype: '<d:principal/>',
    displayname: esc(u.name),
    'current-user-principal': `<d:href>${base}/principals/${u.id}/</d:href>`,
    'principal-URL': `<d:href>${base}/principals/${u.id}/</d:href>`,
    'principal-collection-set': `<d:href>${base}/principals/</d:href>`,
    'calendar-home-set': `<d:href>${base}/calendars/${u.id}/</d:href>`,
    'calendar-user-address-set': `<d:href>mailto:${esc(u.email)}</d:href>`,
  });
  const objectProps = (body: string, withData: boolean): Record<string, string> => ({
    getetag: esc(etagOf(body)),
    getcontenttype: 'text/calendar; charset=utf-8; component=vevent',
    resourcetype: '',
    ...(withData ? { 'calendar-data': esc(body) } : {}),
  });

  const sendXml = (reply: FastifyReply, body: string) => reply.code(207).header('Content-Type', 'application/xml; charset=utf-8').send(body);

  async function handle(req: FastifyRequest, reply: FastifyReply) {
    const method = req.method.toUpperCase();
    reply.header('DAV', '1, 3, calendar-access');
    if (method === 'OPTIONS') return reply.code(200).header('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT').send();
    const u = await authenticate(req);
    if (!u) return challenge(reply);

    const path = decodeURIComponent((req.url.split('?')[0] ?? '').replace(/\/+$/, '/'));
    const body = typeof req.body === 'string' ? req.body : '';
    const depth = String(req.headers.depth ?? '0');
    const parts = path.slice(base.length).split('/').filter(Boolean);
    const props = requestedProps(body);

    // /dav/ and /dav/principals/<id>/: who is signed in and where their calendars are.
    if (parts.length === 0 || parts[0] === 'principals') {
      if (parts[1] && Number(parts[1]) !== u.id) return reply.code(403).send();
      if (method !== 'PROPFIND') return reply.code(method === 'GET' ? 200 : 405).send(method === 'GET' ? 'Tasklog CalDAV' : undefined);
      return sendXml(reply, multistatus([response(path.endsWith('/') ? path : `${path}/`, principalProps(u), props)]));
    }
    if (parts[0] !== 'calendars' || Number(parts[1]) !== u.id) return reply.code(404).send();
    const home = `${base}/calendars/${u.id}/`;
    const areas = await areasOf(u);

    // The calendar home: one calendar per area.
    if (parts.length === 2) {
      if (method !== 'PROPFIND') return reply.code(405).send();
      const responses = [response(home, { resourcetype: '<d:collection/>', displayname: 'Tasklog', ...principalProps(u), owner: `<d:href>${base}/principals/${u.id}/</d:href>` }, props)];
      if (depth !== '0') {
        for (const a of areas) {
          const tickets = await ticketsIn(a.id);
          responses.push(response(`${home}${a.id}/`, calendarProps(u, a, etagOf(tickets.map(t => etagOf(icsOf(t))).join())), props));
        }
      }
      return sendXml(reply, multistatus(responses));
    }

    const area = areas.find(a => String(a.id) === parts[2]);
    if (!area) return reply.code(404).send();
    const calendar = `${home}${area.id}/`;

    // The calendar itself.
    if (parts.length === 3) {
      const tickets = await ticketsIn(area.id);
      const objects = tickets.map(t => ({ href: `${calendar}${encodeURIComponent(fileOf(t))}`, body: icsOf(t) }));
      if (method === 'PROPFIND') {
        const responses = [response(calendar, calendarProps(u, area, etagOf(objects.map(o => etagOf(o.body)).join())), props)];
        if (depth !== '0') for (const o of objects) responses.push(response(o.href, objectProps(o.body, false), props));
        return sendXml(reply, multistatus(responses));
      }
      if (method === 'REPORT') {
        const wanted = /calendar-multiget/.test(body)
          ? new Set([...body.matchAll(/<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/g)].map(m => decodeURIComponent(m[1].trim())))
          : null;
        const withData = props.names.some(n => n.name === 'calendar-data');
        const responses = objects
          .filter(o => !wanted || wanted.has(decodeURIComponent(o.href)) || wanted.has(o.href))
          .map(o => response(o.href, objectProps(o.body, withData), props));
        // Asked-for objects that are gone (done, deleted): 404 so the app drops them.
        if (wanted) {
          const known = new Set(objects.map(o => decodeURIComponent(o.href)));
          for (const h of wanted) if (!known.has(h)) responses.push(`<d:response><d:href>${esc(h)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`);
        }
        return sendXml(reply, multistatus(responses));
      }
      if (method === 'PROPPATCH') {
        // Colour and order set in the app are accepted but not kept; every device shows Tasklog's.
        const names = requestedProps(body).names;
        return sendXml(reply, multistatus([`<d:response><d:href>${esc(calendar)}</d:href><d:propstat><d:prop>${names.map(n => `<x:${n.name} xmlns:x="${esc(n.ns)}"/>`).join('')}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`]));
      }
      if (method === 'GET') return reply.code(200).header('Content-Type', 'text/plain; charset=utf-8').send(`Tasklog-Kalender ${area.name}`);
      return reply.code(405).send();
    }

    // An event.
    const file = parts.slice(3).join('/');
    if (parts.length !== 4 || !/^[\w.@+=-]{1,200}$/.test(file)) return reply.code(404).send();
    const ticket = await ticketByHref(area.id, file);

    if (method === 'GET' || method === 'HEAD') {
      if (!ticket) return reply.code(404).send();
      const ics = icsOf(ticket);
      return reply.code(200).header('Content-Type', 'text/calendar; charset=utf-8').header('ETag', etagOf(ics)).send(method === 'HEAD' ? undefined : ics);
    }
    if (method === 'PROPFIND') {
      if (!ticket) return reply.code(404).send();
      return sendXml(reply, multistatus([response(path, objectProps(icsOf(ticket), props.names.some(n => n.name === 'calendar-data')), props)]));
    }
    if (u.role === 'read') return reply.code(403).send('Nur lesen');

    if (method === 'DELETE') {
      if (!ticket) return reply.code(404).send();
      if (req.headers['if-match'] && req.headers['if-match'] !== etagOf(icsOf(ticket))) return reply.code(412).send();
      // Deleting the event finishes the ticket; a repeating one comes back as the next date.
      await setStatus(db, [ticket.id], 'done');
      ctx.publisher.schedule();
      await ctx.log.add('in', `Kalender (${u.name}): „${ticket.title}“ erledigt`, 'done');
      return reply.code(204).send();
    }

    if (method === 'PUT') {
      const event = parseEvent(body);
      if (!event || event.component !== 'VEVENT') return reply.code(415).send('Nur Termine (VEVENT)');
      if (!event.start) return reply.code(400).send('Termin ohne Beginn');
      const when = await localStart(event.start);
      const title = (event.summary || '(ohne Titel)').slice(0, 200);
      const description = event.description.slice(0, 4000);
      // The same event moved here from another area's calendar: same UID.
      const moved = !ticket && event.uid ? (await db.query<{ id: number }>(
        `SELECT id FROM tickets WHERE status <> 'done' AND (dav_uid = $1 OR ('ticket-' || id || '@' || $2) = $1) LIMIT 1`, [event.uid, host],
      )).rows[0] : undefined;
      const existing = ticket?.id ?? moved?.id;
      if (req.headers['if-none-match'] === '*' && ticket) return reply.code(412).send();
      if (req.headers['if-match'] && (!ticket || req.headers['if-match'] !== etagOf(icsOf(ticket)))) return reply.code(412).send();
      if (existing) {
        await db.query(
          `UPDATE tickets SET title = $2, description = $3, due_date = $4, due_time = $5, area_id = $6, dav_href = $7,
                  dav_uid = COALESCE(dav_uid, $8), due_notified_at = CASE WHEN due_date IS DISTINCT FROM $4 OR due_time IS DISTINCT FROM $5::time THEN NULL ELSE due_notified_at END,
                  updated_at = now()
            WHERE id = $1`,
          [existing, title, description, when.due, when.dueTime, area.id, ticket?.href ?? file, event.uid],
        );
        // An event coming in under another name than ours keeps that name from now on.
        if (ticket && !ticket.href && file !== `${ticket.id}.ics`) await db.query('UPDATE tickets SET dav_href = $2 WHERE id = $1', [ticket.id, file]);
        ctx.publisher.schedule();
        return reply.code(204).send();
      }
      const id = await createTicket(db, { title, description, areaId: area.id, due: when.due, dueTime: when.dueTime, assigneeId: u.id, source: 'app' });
      await db.query('UPDATE tickets SET dav_href = $2, dav_uid = $3 WHERE id = $1', [id, file, event.uid]);
      ctx.publisher.schedule();
      await ctx.log.add('in', `Kalender (${u.name}): neues Ticket „${title}“`, 'done');
      return reply.code(201).send();
    }
    return reply.code(405).send();
  }

  app.register(async dav => {
    for (const type of ['application/xml', 'text/xml', 'text/calendar']) {
      dav.addContentTypeParser(type, { parseAs: 'string' }, (_req, text, done) => done(null, text));
    }
    // Some apps send XML without a content type.
    dav.addContentTypeParser('*', { parseAs: 'string' }, (_req, text, done) => done(null, text));
    const methods = ['GET', 'PUT', 'DELETE', 'OPTIONS', 'PROPFIND', 'REPORT', 'PROPPATCH', 'MKCALENDAR', 'MKCOL'];
    dav.route({ method: methods, url: base, handler: handle });
    dav.route({ method: methods, url: `${base}/*`, handler: handle });
    // Apps look here first (RFC 6764).
    dav.route({ method: [...methods], url: '/.well-known/caldav', handler: (_req, reply) => reply.redirect(`${base}/`, 301) });
    // Some ask the server root who is signed in (GET / stays the app).
    dav.route({ method: ['PROPFIND'], url: '/', handler: handle });
  });

  // — the calendar password, under Mehr → Kalender-Abo —
  const ownUser = (req: FastifyRequest) => {
    const uid = userId(req);
    if (uid === null) throw new HttpError(400, 'Nur für angemeldete Benutzer');
    return uid;
  };
  app.get('/api/me/caldav', async req => {
    const { rows: [u] } = await db.query<{ email: string; at: Date | null }>('SELECT email, dav_password_at AS at FROM users WHERE id = $1', [ownUser(req)]);
    return { url: new URL(`${base}/`, config.PUBLIC_URL).toString(), server: host, username: u.email, hasPassword: Boolean(u.at), createdAt: u.at };
  });
  /** A new password, shown this once; the old one stops working. */
  app.post('/api/me/caldav/password', { config: { access: 'read' } }, async req => {
    const password = randomToken(18);
    await db.query('UPDATE users SET dav_password_hash = $2, dav_password_at = now() WHERE id = $1', [ownUser(req), sha256(password)]);
    return { password };
  });
  app.delete('/api/me/caldav/password', { config: { access: 'read' } }, async (req, reply) => {
    await db.query('UPDATE users SET dav_password_hash = NULL, dav_password_at = NULL WHERE id = $1', [ownUser(req)]);
    return reply.code(204).send();
  });
}
