import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import type { HaCalendarEvent } from './homeAssistant.js';
import { createTicket, setStatus } from './tickets.js';

export interface CalendarSource {
  id: number;
  entityId: string;
  name: string;
  areaId: number;
  titleTemplate: string;
  leadDays: number;
  /** 'HH:MM' for the created tickets, or null for the whole day. */
  dueTime: string | null;
  lookaheadDays: number;
  prio: 'normal' | 'high';
  autoClose: boolean;
  enabled: boolean;
  /** Event titles that never become tickets. */
  excludedTypes: string[];
  lastSyncAt: string | null;
  lastError: string | null;
}

export const SOURCE_SELECT = `
  SELECT id, entity_id AS "entityId", name, area_id AS "areaId", title_template AS "titleTemplate",
         lead_days AS "leadDays", to_char(due_time, 'HH24:MI') AS "dueTime", lookahead_days AS "lookaheadDays", prio, auto_close AS "autoClose",
         enabled, excluded_types AS "excludedTypes", last_sync_at AS "lastSyncAt", last_error AS "lastError"
    FROM calendar_sources`;

/** Calendar date of an event in the household's time zone. */
export function eventDate(e: HaCalendarEvent, timeZone: string): string | null {
  if (e.start.date) return e.start.date;
  if (!e.start.dateTime) return null;
  return new Date(e.start.dateTime).toLocaleDateString('sv-SE', { timeZone }); // sv-SE formats as YYYY-MM-DD
}

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function ticketTitle(template: string, summary: string, date: string): string {
  const [, m, d] = date.split('-');
  return template.replaceAll('{title}', summary.trim()).replaceAll('{date}', `${d}.${m}.`).trim().slice(0, 200) || summary;
}

async function today(ctx: AppContext): Promise<string> {
  const { rows } = await ctx.db.query<{ today: string }>('SELECT current_date::text AS today');
  return rows[0].today;
}

async function fetchEvents(ctx: AppContext, source: CalendarSource, days: number) {
  const now = new Date();
  // Start a day back so today's all-day events are included whatever the UTC offset.
  const events = await ctx.ha.calendarEvents(source.entityId, new Date(now.getTime() - 86400000), new Date(now.getTime() + days * 86400000));
  const t = await today(ctx);
  const last = addDays(t, days); // don't rely on the calendar honouring the requested range
  return {
    today: t,
    events: events
      .map(e => ({ summary: (e.summary ?? '').trim(), date: eventDate(e, ctx.config.TZ) }))
      .filter((e): e is { summary: string; date: string } => Boolean(e.summary && e.date && e.date >= t && e.date <= last))
      .sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary)),
  };
}

export interface SyncResult {
  events: number;
  created: number;
  closed: number;
}

/** Creates one ticket per upcoming event (once), and closes tickets whose event day is over. */
export async function syncSource(ctx: AppContext, source: CalendarSource): Promise<SyncResult> {
  try {
    const { today: t, events } = await fetchEvents(ctx, source, source.lookaheadDays);
    let created = 0;
    for (const e of events) {
      if (source.excludedTypes.includes(e.summary)) continue;
      const inserted = await withTransaction(ctx.db, async c => {
        const { rowCount } = await c.query(
          `INSERT INTO calendar_imports (source_id, event_key, event_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [source.id, `${e.date}|${e.summary}`, e.date],
        );
        if (!rowCount) return false;
        const due = addDays(e.date, -source.leadDays);
        const ticketId = await createTicket(c, {
          title: ticketTitle(source.titleTemplate, e.summary, e.date),
          areaId: source.areaId,
          prio: source.prio,
          due: due < t ? t : due,
          dueTime: source.dueTime,
          source: 'ha',
        });
        await c.query('UPDATE calendar_imports SET ticket_id = $3 WHERE source_id = $1 AND event_key = $2', [source.id, `${e.date}|${e.summary}`, ticketId]);
        return true;
      });
      if (inserted) created++;
    }

    let closed = 0;
    if (source.autoClose) {
      const { rows } = await ctx.db.query<{ id: number }>(
        `SELECT t.id FROM calendar_imports i JOIN tickets t ON t.id = i.ticket_id
          WHERE i.source_id = $1 AND i.event_date < current_date AND t.status <> 'done'`,
        [source.id],
      );
      if (rows.length) closed = await setStatus(ctx.db, rows.map(r => r.id), 'done');
    }

    await ctx.db.query('UPDATE calendar_sources SET last_sync_at = now(), last_error = NULL WHERE id = $1', [source.id]);
    if (created || closed) {
      const parts = [created && `${created} Ticket${created === 1 ? '' : 's'} angelegt`, closed && `${closed} geschlossen`].filter(Boolean);
      await ctx.log.add('in', `Kalender „${source.name}“: ${parts.join(', ')}`, 'done');
      ctx.publisher.schedule();
    }
    return { events: events.filter(e => !source.excludedTypes.includes(e.summary)).length, created, closed };
  } catch (err) {
    const message = (err as Error).message;
    if (message !== source.lastError) await ctx.log.add('in', `Kalender „${source.name}“: ${message}`, 'error');
    await ctx.db.query('UPDATE calendar_sources SET last_sync_at = now(), last_error = $2 WHERE id = $1', [source.id, message]);
    throw err;
  }
}

/** After the settings changed: bring the still-open tickets of this calendar in line (title, due date, area, prio). */
export async function reapplySource(ctx: AppContext, source: CalendarSource): Promise<number> {
  const t = await today(ctx);
  const { rows } = await ctx.db.query<{ ticketId: number; eventKey: string; eventDate: string }>(
    `SELECT i.ticket_id AS "ticketId", i.event_key AS "eventKey", i.event_date::text AS "eventDate"
       FROM calendar_imports i JOIN tickets tk ON tk.id = i.ticket_id
      WHERE i.source_id = $1 AND tk.status <> 'done'`,
    [source.id],
  );
  for (const r of rows) {
    const summary = r.eventKey.slice(r.eventKey.indexOf('|') + 1);
    if (source.excludedTypes.includes(summary)) {
      // Unwanted type: drop the open ticket and forget the import, so switching it back on recreates it.
      await ctx.db.query('DELETE FROM tickets WHERE id = $1', [r.ticketId]);
      await ctx.db.query('DELETE FROM calendar_imports WHERE source_id = $1 AND event_key = $2', [source.id, r.eventKey]);
      continue;
    }
    const due = addDays(r.eventDate, -source.leadDays);
    await ctx.db.query(
      'UPDATE tickets SET title = $2, due_date = $3, area_id = $4, prio = $5, due_time = $6, due_notified_at = NULL, updated_at = now() WHERE id = $1',
      [r.ticketId, ticketTitle(source.titleTemplate, summary, r.eventDate), due < t ? t : due, source.areaId, source.prio, source.dueTime],
    );
  }
  if (rows.length) ctx.publisher.schedule();
  return rows.length;
}

/** The next events with the ticket each one gets (or already has). */
export async function previewSource(ctx: AppContext, source: CalendarSource, limit = 10) {
  const { today: t, events: all } = await fetchEvents(ctx, source, Math.max(source.lookaheadDays, 60));
  const types = [...new Set([...all.map(e => e.summary), ...source.excludedTypes])].sort((a, b) => a.localeCompare(b, 'de'));
  const events = all.filter(e => !source.excludedTypes.includes(e.summary));
  const { rows } = await ctx.db.query<{ eventKey: string; ticketId: number | null; status: string | null }>(
    `SELECT i.event_key AS "eventKey", i.ticket_id AS "ticketId", t.status
       FROM calendar_imports i LEFT JOIN tickets t ON t.id = i.ticket_id WHERE i.source_id = $1`,
    [source.id],
  );
  const imported = new Map(rows.map(r => [r.eventKey, r]));
  const upcoming = events.slice(0, limit).map(e => {
    const imp = imported.get(`${e.date}|${e.summary}`);
    return {
      date: e.date,
      summary: e.summary,
      ticketTitle: ticketTitle(source.titleTemplate, e.summary, e.date),
      due: (d => (d < t ? t : d))(addDays(e.date, -source.leadDays)),
      dueTime: source.dueTime,
      imported: Boolean(imp),
      ticketId: imp?.ticketId ?? null,
      ticketStatus: imp?.status ?? null,
      // Created at the next sync once the event is inside the lookahead window.
      createFrom: addDays(e.date, -source.lookaheadDays),
    };
  });
  return { events: upcoming, types: types.map(name => ({ name, excluded: source.excludedTypes.includes(name) })) };
}

/** Background job: sync every enabled source at most every `minutes`. */
export async function syncDueSources(ctx: AppContext, minutes = 15) {
  if (!(await ctx.ha.isConfigured())) return;
  const { rows } = await ctx.db.query<CalendarSource>(
    `${SOURCE_SELECT} WHERE enabled AND (last_sync_at IS NULL OR last_sync_at < now() - make_interval(mins => $1))`,
    [minutes],
  );
  for (const source of rows) await syncSource(ctx, source).catch(() => {}); // error is stored on the source and logged
}
