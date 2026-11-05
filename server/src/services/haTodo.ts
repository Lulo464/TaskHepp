import type { AppContext } from '../context.js';
import { createTicket, setStatus } from './tickets.js';

/** A to-do item as Home Assistant's todo.get_items returns it. */
export interface HaTodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  due?: string;
  description?: string;
}

export interface TodoSyncResult {
  imported: number;
  exported: number;
  updated: number;
}

/** The lists the Tasklog integration itself creates; linking them would echo every change back and forth. */
export const OWN_LISTS = /^todo\.tasklog_/;

const key = (s: string) => s.trim().toLowerCase();

async function getItems(ctx: AppContext, entity: string): Promise<HaTodoItem[]> {
  const res = await ctx.ha.callServiceWithResponse<Record<string, { items?: HaTodoItem[] }>>('todo', 'get_items', { entity_id: entity });
  const items = res?.service_response?.[entity]?.items;
  if (!items) throw new Error(`${entity} liefert keine Einträge (gibt es die Liste noch?)`);
  return items;
}

/** "2030-06-01" or "2030-06-01T18:30:00+02:00" → Tasklog's local date and time. */
function dueFromHa(due: string | undefined, timeZone: string): { due: string | null; dueTime: string | null } {
  if (!due) return { due: null, dueTime: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return { due, dueTime: null };
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return { due: null, dueTime: null };
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { due: `${p.year}-${p.month}-${p.day}`, dueTime: `${p.hour}:${p.minute}` };
}

interface TicketState { id: number; title: string; description: string; done: boolean; due: string | null; dueTime: string | null }

/**
 * Brings one area and its Home Assistant list in step. What changed since the last sync wins: ticked off,
 * renamed or added in HA shows up in Tasklog and the other way round. An item removed in HA closes its ticket;
 * a ticket deleted in Tasklog removes the item. Done tickets and ticked-off items are not copied over as new.
 */
export async function syncArea(ctx: AppContext, areaId: number, entity: string): Promise<TodoSyncResult> {
  const { db } = ctx;
  const result: TodoSyncResult = { imported: 0, exported: 0, updated: 0 };
  const call = (service: string, data: Record<string, unknown>) => ctx.ha.callService('todo', service, { entity_id: entity, ...data });

  let items = await getItems(ctx, entity);
  const byUid = new Map(items.map(i => [i.uid, i]));
  const ticketOf = async (id: number) => (await db.query<TicketState>(
    `SELECT id, title, description, status = 'done' AS done, due_date::text AS due, to_char(due_time, 'HH24:MI') AS "dueTime" FROM tickets WHERE id = $1`, [id],
  )).rows[0] ?? null;

  // 1. Items both sides know.
  const { rows: links } = await db.query<{ id: number; uid: string; ticketId: number | null; summary: string; done: boolean }>(
    'SELECT id, uid, ticket_id AS "ticketId", summary, done FROM ha_todo_links WHERE area_id = $1 AND entity = $2', [areaId, entity],
  );
  for (const link of links) {
    const item = byUid.get(link.uid);
    const ticket = link.ticketId ? await ticketOf(link.ticketId) : null;
    if (!item) {
      // Removed in Home Assistant.
      if (ticket && !ticket.done) { await setStatus(db, [ticket.id], 'done'); result.updated++; }
      await db.query('DELETE FROM ha_todo_links WHERE id = $1', [link.id]);
      continue;
    }
    if (!ticket) {
      // Deleted in Tasklog.
      await call('remove_item', { item: [link.uid] });
      await db.query('DELETE FROM ha_todo_links WHERE id = $1', [link.id]);
      result.updated++;
      continue;
    }
    let summary = link.summary;
    let done = link.done;
    const itemDone = item.status === 'completed';
    if (item.summary !== link.summary) {
      await db.query('UPDATE tickets SET title = $2, updated_at = now() WHERE id = $1', [ticket.id, item.summary.slice(0, 200)]);
      summary = item.summary;
      result.updated++;
    } else if (ticket.title !== link.summary) {
      await call('update_item', { item: link.uid, rename: ticket.title });
      summary = ticket.title;
      result.updated++;
    }
    if (itemDone !== link.done) {
      await setStatus(db, [ticket.id], itemDone ? 'done' : 'open');
      done = itemDone;
      result.updated++;
    } else if (ticket.done !== link.done) {
      await call('update_item', { item: link.uid, status: ticket.done ? 'completed' : 'needs_action' });
      done = ticket.done;
      result.updated++;
    }
    if (summary !== link.summary || done !== link.done) {
      await db.query('UPDATE ha_todo_links SET summary = $2, done = $3 WHERE id = $1', [link.id, summary, done]);
    }
    byUid.delete(link.uid);
  }

  // 2. Open items and open tickets nobody linked yet. Same title: the same thing (e.g. after linking again).
  const { rows: loose } = await db.query<TicketState>(
    `SELECT t.id, t.title, t.description, false AS done, t.due_date::text AS due, to_char(t.due_time, 'HH24:MI') AS "dueTime"
       FROM tickets t WHERE t.area_id = $1 AND t.status <> 'done'
        AND NOT EXISTS (SELECT 1 FROM ha_todo_links l WHERE l.ticket_id = t.id AND l.entity = $2) ORDER BY t.id`,
    [areaId, entity],
  );
  const link = (uid: string, ticketId: number, summary: string, done: boolean) => db.query(
    'INSERT INTO ha_todo_links (area_id, entity, uid, ticket_id, summary, done) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (entity, uid) DO NOTHING',
    [areaId, entity, uid, ticketId, summary, done],
  );
  const newItems = [...byUid.values()].filter(i => i.status === 'needs_action');
  const toExport: TicketState[] = [];
  for (const ticket of loose) {
    const same = newItems.findIndex(i => key(i.summary) === key(ticket.title));
    if (same >= 0) {
      const [item] = newItems.splice(same, 1);
      await link(item.uid, ticket.id, item.summary, false);
    } else {
      toExport.push(ticket);
    }
  }
  const { rows: [area] } = await db.query<{ prio: 'normal' | 'high' }>('SELECT default_prio AS prio FROM areas WHERE id = $1', [areaId]);
  for (const item of newItems) {
    const id = await createTicket(db, {
      title: item.summary.slice(0, 200), description: item.description?.slice(0, 4000) ?? '', areaId, prio: area.prio, source: 'ha',
      ...dueFromHa(item.due, ctx.config.TZ),
    });
    await link(item.uid, id, item.summary, false);
    result.imported++;
  }

  // 3. New tickets go to the list. add_item does not say the new uid, so it is looked up afterwards by title.
  for (const ticket of toExport) {
    const extra: Record<string, unknown> = {};
    if (ticket.due) extra[ticket.dueTime ? 'due_datetime' : 'due_date'] = ticket.dueTime ? `${ticket.due} ${ticket.dueTime}:00` : ticket.due;
    if (ticket.description) extra.description = ticket.description;
    // Lists without dates or descriptions (e.g. the shopping list) refuse them: then the title alone.
    await call('add_item', { item: ticket.title, ...extra }).catch(() => call('add_item', { item: ticket.title }));
    result.exported++;
  }
  if (toExport.length) {
    items = await getItems(ctx, entity);
    const { rows: known } = await db.query<{ uid: string }>('SELECT uid FROM ha_todo_links WHERE entity = $1', [entity]);
    const taken = new Set(known.map(k => k.uid));
    for (const ticket of toExport) {
      const item = items.find(i => !taken.has(i.uid) && i.status === 'needs_action' && key(i.summary) === key(ticket.title));
      if (!item) continue;
      taken.add(item.uid);
      await link(item.uid, ticket.id, item.summary, false);
    }
  }
  return result;
}

let running: Promise<void> | null = null;

/** All linked areas; errors stay with their area so one broken list does not stop the others. */
export function syncHaTodos(ctx: AppContext): Promise<void> {
  if (running) return running;
  running = (async () => {
    const { rows } = await ctx.db.query<{ id: number; name: string; entity: string }>(
      'SELECT id, name, ha_todo_entity AS entity FROM areas WHERE ha_todo_entity IS NOT NULL ORDER BY position, id',
    );
    if (!rows.length || !(await ctx.ha.isConfigured())) return;
    let changed = false;
    for (const area of rows) {
      try {
        const r = await syncArea(ctx, area.id, area.entity);
        await ctx.db.query('UPDATE areas SET ha_todo_synced_at = now(), ha_todo_error = NULL WHERE id = $1', [area.id]);
        if (r.imported || r.exported || r.updated) {
          changed = true;
          await ctx.log.add('in', `To-do-Liste ${area.entity} ↔ ${area.name}: ${r.imported} neu aus HA, ${r.exported} nach HA, ${r.updated} geändert`, 'done');
        }
      } catch (err) {
        const message = (err as Error).message.slice(0, 300);
        const { rows: [before] } = await ctx.db.query<{ error: string | null }>('SELECT ha_todo_error AS error FROM areas WHERE id = $1', [area.id]);
        await ctx.db.query('UPDATE areas SET ha_todo_error = $2 WHERE id = $1', [area.id, message]);
        if (before?.error !== message) await ctx.log.add('in', `To-do-Liste ${area.entity}: ${message}`, 'error');
      }
    }
    // Not schedule(): that would start the next sync and never rest.
    if (changed) await ctx.publisher.publishAll();
  })().finally(() => { running = null; });
  return running;
}
