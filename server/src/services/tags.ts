import { randomBytes } from 'node:crypto';
import type { AppContext } from '../context.js';
import { withTransaction, type Queryable } from '../db.js';
import { createTicket, setStatus } from './tickets.js';
import { startTimer, stopEntries } from './time.js';

export type TagAction = 'done' | 'timer' | 'create';

export interface Tag {
  id: number;
  code: string;
  name: string;
  action: TagAction;
  ticketId: number | null;
  ticket: string | null;
  ticketStatus: string | null;
  title: string | null;
  areaId: number | null;
  area: string | null;
  prio: 'normal' | 'high';
  haTagId: string | null;
  scans: number;
  lastScanAt: string | null;
  lastScanBy: string | null;
}

export const TAG_SELECT = `
  SELECT g.id, g.code, g.name, g.action, g.ticket_id AS "ticketId", t.title AS ticket, t.status AS "ticketStatus",
         g.title, g.area_id AS "areaId", a.name AS area, g.prio, g.ha_tag_id AS "haTagId",
         g.scans, g.last_scan_at AS "lastScanAt", g.last_scan_by AS "lastScanBy"
    FROM tags g LEFT JOIN tickets t ON t.id = g.ticket_id LEFT JOIN areas a ON a.id = g.area_id`;

/** Short and URL-safe, so the URL fits on the smallest tags (NTAG213: 144 bytes). */
export const newTagCode = () => randomBytes(9).toString('base64url');

export type ScanResult =
  | { action: 'done'; result: 'done' | 'alreadyDone'; ticketId: number; title: string; followupId: number | null }
  | { action: 'timer'; result: 'started' | 'stopped' | 'alreadyDone'; ticketId: number; title: string }
  | { action: 'create'; result: 'created' | 'exists'; ticketId: number; title: string }
  | { action: TagAction; result: 'missing' };

/** Who scanned: a signed-in person, or Home Assistant (then timers count for the ticket's assignee). */
export interface Scanner {
  userId: number | null;
  name: string;
  via: 'app' | 'ha';
}

/** A repeating ticket's tag keeps working: it follows the series to the newest ticket. */
async function currentTicket(db: Queryable, ticketId: number) {
  const { rows: [t] } = await db.query<{ id: number; title: string; status: string; assigneeId: number | null }>(
    `WITH RECURSIVE chain AS (
       SELECT id, followup_id, 0 AS depth FROM tickets WHERE id = $1
       UNION ALL
       SELECT t.id, t.followup_id, c.depth + 1 FROM tickets t JOIN chain c ON t.id = c.followup_id WHERE c.depth < 1000
     )
     SELECT t.id, t.title, t.status, t.assignee_id AS "assigneeId"
       FROM chain c JOIN tickets t ON t.id = c.id ORDER BY c.depth DESC LIMIT 1`,
    [ticketId],
  );
  return t ?? null;
}

export async function scanTag(ctx: AppContext, tagId: number, by: Scanner): Promise<ScanResult> {
  const { db } = ctx;
  const s = await ctx.settings.get();
  const result = await withTransaction(db, async (c): Promise<ScanResult> => {
    const { rows: [tag] } = await c.query<{ action: TagAction; ticketId: number | null; title: string | null; areaId: number | null; prio: 'normal' | 'high'; name: string }>(
      'SELECT action, ticket_id AS "ticketId", title, area_id AS "areaId", prio, name FROM tags WHERE id = $1 FOR UPDATE', [tagId],
    );
    await c.query('UPDATE tags SET scans = scans + 1, last_scan_at = now(), last_scan_by = $2 WHERE id = $1', [tagId, by.name]);

    if (tag.action === 'create') {
      const last = tag.ticketId ? await currentTicket(c, tag.ticketId) : null;
      if (last && last.status !== 'done') return { action: 'create', result: 'exists', ticketId: last.id, title: last.title };
      if (!tag.areaId) return { action: 'create', result: 'missing' };
      const title = tag.title?.trim() || tag.name;
      const { rows: [{ today }] } = await c.query<{ today: string }>('SELECT current_date::text AS today');
      const id = await createTicket(c, { title, areaId: tag.areaId, prio: tag.prio, due: today, assigneeId: by.userId, source: by.via === 'ha' ? 'ha' : 'app' });
      await c.query('UPDATE tags SET ticket_id = $2 WHERE id = $1', [tagId, id]);
      return { action: 'create', result: 'created', ticketId: id, title };
    }

    const ticket = tag.ticketId ? await currentTicket(c, tag.ticketId) : null;
    if (!ticket) return { action: tag.action, result: 'missing' };
    if (ticket.id !== tag.ticketId) await c.query('UPDATE tags SET ticket_id = $2 WHERE id = $1', [tagId, ticket.id]);

    if (tag.action === 'done') {
      if (ticket.status === 'done') return { action: 'done', result: 'alreadyDone', ticketId: ticket.id, title: ticket.title, followupId: null };
      await setStatus(c, [ticket.id], 'done');
      const { rows: [f] } = await c.query<{ followupId: number | null }>('SELECT followup_id AS "followupId" FROM tickets WHERE id = $1', [ticket.id]);
      // The list of tags shows the ticket that is up next.
      if (f.followupId) await c.query('UPDATE tags SET ticket_id = $2 WHERE id = $1', [tagId, f.followupId]);
      return { action: 'done', result: 'done', ticketId: ticket.id, title: ticket.title, followupId: f.followupId };
    }

    // Timer: stop it when it runs, otherwise start it.
    const uid = by.via === 'ha' ? ticket.assigneeId : by.userId;
    const stopped = await stopEntries(c, 'ticket_id = $1 AND user_id IS NOT DISTINCT FROM $2', [ticket.id, uid], s.rounding);
    if (stopped) return { action: 'timer', result: 'stopped', ticketId: ticket.id, title: ticket.title };
    if (ticket.status === 'done') return { action: 'timer', result: 'alreadyDone', ticketId: ticket.id, title: ticket.title };
    await startTimer(c, ticket.id, uid, { single: s.timeRules.singleTimer, rounding: s.rounding });
    return { action: 'timer', result: 'started', ticketId: ticket.id, title: ticket.title };
  });
  ctx.publisher.schedule();
  if ('title' in result) await ctx.log.add('in', `NFC-Tag (${by.via === 'ha' ? 'Home Assistant' : by.name}): ${result.title} – ${result.result}`, 'done');
  return result;
}
