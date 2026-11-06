import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');

export interface DayEntry {
  id: number;
  userId: number | null;
  user: string | null;
  startedAt: string;
  endedAt: string | null;
  manual: boolean;
  /** Local day and times of the whole entry, "2030-06-01", "09:00", "10:30" (null while running). */
  startDay: string;
  startTime: string;
  endTime: string | null;
  /** Part of the entry that falls on this day. */
  seconds: number;
}

/**
 * Time on a ticket per day (local time). An entry running over midnight counts on both days with its part each;
 * a running timer counts up to now.
 */
export async function ticketDays(ctx: AppContext, ticketId: number) {
  const { rows } = await ctx.db.query<DayEntry & { date: string }>(
    `SELECT d::date::text AS date, e.id, e.user_id AS "userId", u.name AS "user", e.started_at AS "startedAt", e.ended_at AS "endedAt",
            COALESCE(e.manual, false) AS manual,
            -- In Tasklog's time zone (the session's), whatever zone the browser is in.
            e.started_at::date::text AS "startDay", to_char(e.started_at, 'HH24:MI') AS "startTime", to_char(e.ended_at, 'HH24:MI') AS "endTime",
            round(extract(epoch FROM (LEAST(COALESCE(e.ended_at, now()), d + interval '1 day') - GREATEST(e.started_at, d))))::int AS seconds
       FROM time_entries e
       LEFT JOIN users u ON u.id = e.user_id
       CROSS JOIN LATERAL generate_series(date_trunc('day', e.started_at), date_trunc('day', COALESCE(e.ended_at, now())), interval '1 day') d
      WHERE e.ticket_id = $1
      ORDER BY d DESC, e.started_at`,
    [ticketId],
  );
  const days: { date: string; seconds: number; minutes: number; entries: DayEntry[] }[] = [];
  for (const { date: day, ...entry } of rows) {
    if (entry.seconds <= 0 && entry.endedAt !== null) continue; // ends exactly at midnight
    let d = days.find(x => x.date === day);
    if (!d) days.push(d = { date: day, seconds: 0, minutes: 0, entries: [] });
    d.entries.push(entry);
    d.seconds += entry.seconds;
    d.minutes = Math.round(d.seconds / 60);
  }
  return days;
}

/** Start and end for time booked on a day: from `start` (default 09:00, earlier if it would run past midnight). */
export async function bookedSpan(ctx: AppContext, day: string, start: string | undefined, minutes: number) {
  const latest = 24 * 60 - minutes;
  const [h, m] = (start ?? '09:00').split(':').map(Number);
  const from = Math.max(0, Math.min(h * 60 + m, latest));
  const { rows: [span] } = await ctx.db.query<{ startedAt: Date; endedAt: Date; future: boolean }>(
    // ::timestamptz reads the local time in Tasklog's time zone (the session's), so the instant is right.
    `SELECT ($1::date + make_interval(mins => $2))::timestamptz AS "startedAt", ($1::date + make_interval(mins => $2 + $3))::timestamptz AS "endedAt",
            ($1::date + make_interval(mins => $2 + $3))::timestamptz > now() + interval '1 minute' AS future`,
    [day, from, minutes],
  );
  if (span.future) throw new HttpError(400, 'Diese Zeit liegt in der Zukunft');
  return span;
}

/** Changing and removing single time entries: everyone their own, admins all. */
export function timeEntryRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  const ownEntry = async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const { rows: [entry] } = await db.query<{ id: number; ticketId: number; userId: number | null; running: boolean; day: string; start: string; minutes: number }>(
      `SELECT id, ticket_id AS "ticketId", user_id AS "userId", ended_at IS NULL AS running, started_at::date::text AS day,
              to_char(started_at, 'HH24:MI') AS start, round(extract(epoch FROM (COALESCE(ended_at, now()) - started_at)) / 60)::int AS minutes
         FROM time_entries WHERE id = $1`,
      [id],
    );
    if (!entry) throw notFound('Zeiteintrag nicht gefunden');
    const isAdmin = req.principal?.kind === 'user' ? req.principal.user.role === 'admin' : req.principal?.scope === 'admin';
    if (!isAdmin && entry.userId !== userId(req)) throw new HttpError(403, 'Nur eigene Zeiten lassen sich ändern');
    return entry;
  };

  app.get('/api/tickets/:id/days', async req => {
    const { id } = parse(idParam, req.params);
    if (!(await db.query('SELECT 1 FROM tickets WHERE id = $1', [id])).rowCount) throw notFound('Ticket nicht gefunden');
    return ticketDays(ctx, id);
  });

  /** Another day, start or length, or booked onto another ticket ("umbuchen"). A running timer can only move. */
  app.patch('/api/time/:id', { config: { access: 'member' } }, async req => {
    const entry = await ownEntry(req);
    const body = parse(z.object({
      ticketId: z.number().int().optional(),
      date: date.optional(),
      start: hhmm.optional(),
      minutes: z.number().int().min(1).max(24 * 60).optional(),
    }), req.body);
    if (body.ticketId !== undefined && !(await db.query('SELECT 1 FROM tickets WHERE id = $1', [body.ticketId])).rowCount) {
      throw new HttpError(400, 'Ticket nicht gefunden');
    }
    if (entry.running && (body.date || body.start || body.minutes)) throw new HttpError(409, 'Der Timer läuft noch; erst stoppen, dann die Zeit ändern');
    if (body.date || body.start || body.minutes) {
      const span = await bookedSpan(ctx, body.date ?? entry.day, body.start ?? entry.start, body.minutes ?? entry.minutes);
      await db.query('UPDATE time_entries SET started_at = $2, ended_at = $3, manual = true WHERE id = $1', [entry.id, span.startedAt, span.endedAt]);
    }
    if (body.ticketId !== undefined) await db.query('UPDATE time_entries SET ticket_id = $2 WHERE id = $1', [entry.id, body.ticketId]);
    ctx.publisher.schedule();
    return { ok: true };
  });

  app.delete('/api/time/:id', { config: { access: 'member' } }, async (req, reply) => {
    const entry = await ownEntry(req);
    await db.query('DELETE FROM time_entries WHERE id = $1', [entry.id]);
    ctx.publisher.schedule();
    return reply.code(204).send();
  });
}
