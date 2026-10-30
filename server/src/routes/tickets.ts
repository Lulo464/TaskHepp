import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { createTicket, getTicket, setStatus, TICKET_ORDER, TICKET_SELECT, type TicketRow } from '../services/tickets.js';
import { recurrenceSchema } from '../services/recurrence.js';
import { addManualTime, startTimer, stopEntries } from '../services/time.js';

const status = z.enum(['open', 'inProgress', 'done']);
const prio = z.enum(['normal', 'high']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');

const ticketInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  areaId: z.number().int(),
  projectId: z.number().int().nullable().optional(),
  status: status.optional(),
  prio: prio.optional(),
  assigneeId: z.number().int().nullable().optional(),
  due: date.nullable().optional(),
  dueTime: hhmm.nullable().optional(),
  source: z.enum(['manual', 'app']).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
});

const listQuery = z.object({
  q: z.string().optional(),
  areaId: z.coerce.number().int().optional(),
  source: z.enum(['manual', 'app', 'ha', 'mail']).optional(),
  status: status.optional(),
  open: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export function ticketRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, publisher } = ctx;

  /** Who tickets can be assigned to: everyone allowed to work on them. */
  const PEOPLE_SQL = "SELECT id, name FROM users WHERE role IN ('member', 'admin')";
  const checkAssignee = async (assigneeId: number | null | undefined) => {
    if (assigneeId == null) return;
    const { rowCount } = await db.query(`${PEOPLE_SQL} AND id = $1`, [assigneeId]);
    if (!rowCount) throw new HttpError(400, 'Diese Person kann keine Tickets übernehmen');
  };

  /** The area must exist and the project, if any, belong to it. */
  const checkPlace = async (areaId: number, projectId: number | null | undefined) => {
    if (!(await db.query('SELECT 1 FROM areas WHERE id = $1', [areaId])).rowCount) throw new HttpError(400, 'Unbekannter Bereich');
    if (projectId == null) return;
    if (!(await db.query('SELECT 1 FROM projects WHERE id = $1 AND area_id = $2', [projectId, areaId])).rowCount) {
      throw new HttpError(400, 'Das Projekt gehört nicht zu diesem Bereich');
    }
  };

  app.get('/api/people', async () => (await db.query(`${PEOPLE_SQL} ORDER BY name, id`)).rows);

  app.get('/api/tickets', async req => {
    const q = parse(listQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.q) add('t.title ILIKE ?', `%${q.q.replace(/[%_\\]/g, '\\$&')}%`);
    if (q.areaId) add('t.area_id = ?', q.areaId);
    if (q.source) add('t.source = ?', q.source);
    if (q.status) add('t.status = ?', q.status);
    if (q.open !== undefined) where.push(q.open ? "t.status <> 'done'" : "t.status = 'done'");
    params.push(q.limit);
    const { rows } = await db.query<TicketRow>(
      `${TICKET_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${TICKET_ORDER} LIMIT $${params.length}`,
      params,
    );
    return rows;
  });

  app.get('/api/tickets/:id', async req => {
    const { id } = parse(idParam, req.params);
    return (await getTicket(db, id)) ?? Promise.reject(notFound('Ticket nicht gefunden'));
  });

  app.post('/api/tickets', { config: { access: 'member' } }, async (req, reply) => {
    const body = parse(ticketInput, req.body);
    // Tickets created by a person are theirs unless assigned otherwise.
    await checkAssignee(body.assigneeId);
    await checkPlace(body.areaId, body.projectId);
    const id = await createTicket(db, { ...body, assigneeId: body.assigneeId === undefined ? userId(req) : body.assigneeId });
    publisher.schedule();
    reply.code(201);
    return getTicket(db, id);
  });

  app.patch('/api/tickets/:id', { config: { access: 'member' } }, async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(ticketInput.partial(), req.body);
    await checkAssignee(body.assigneeId);
    if ('areaId' in body || 'projectId' in body) {
      const current = await getTicket(db, id);
      if (!current) throw notFound('Ticket nicht gefunden');
      const areaId = body.areaId ?? current.areaId;
      // Moved to another area: a project of the old area no longer fits and is dropped.
      if (!('projectId' in body) && areaId !== current.areaId) body.projectId = null;
      await checkPlace(areaId, 'projectId' in body ? body.projectId : current.projectId);
    }
    const cols: Record<string, string> = { title: 'title', description: 'description', areaId: 'area_id', projectId: 'project_id', prio: 'prio', assigneeId: 'assignee_id', due: 'due_date', dueTime: 'due_time', source: 'source', recurrence: 'recurrence' };
    await withTransaction(db, async c => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, col] of Object.entries(cols)) {
        if (key in body) {
          params.push(body[key as keyof typeof body] ?? null);
          sets.push(`${col} = $${params.length}`);
        }
      }
      // A new due date/time gets its own "due soon" reminder.
      if ('due' in body || 'dueTime' in body) sets.push('due_notified_at = NULL');
      if (sets.length) {
        const { rowCount } = await c.query(`UPDATE tickets SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
        if (!rowCount) throw notFound('Ticket nicht gefunden');
      }
      if (body.status) await setStatus(c, [id], body.status);
    });
    publisher.schedule();
    return (await getTicket(db, id)) ?? Promise.reject(notFound('Ticket nicht gefunden'));
  });

  app.delete('/api/tickets/:id', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rowCount } = await db.query('DELETE FROM tickets WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Ticket nicht gefunden');
    publisher.schedule();
    return reply.code(204).send();
  });

  app.post('/api/tickets/bulk', { config: { access: 'member' } }, async req => {
    const body = parse(z.object({ ids: z.array(z.number().int()).min(1).max(1000), action: z.enum(['delete', 'setStatus']), status: status.optional() }), req.body);
    const affected = await withTransaction(db, async c => {
      if (body.action === 'delete') return (await c.query('DELETE FROM tickets WHERE id = ANY($1::int[])', [body.ids])).rowCount ?? 0;
      return setStatus(c, body.ids, body.status ?? 'done');
    });
    publisher.schedule();
    return { affected };
  });

  /** What happened to a ticket: creation, timers, manual time, completion. Newest last. */
  app.get('/api/tickets/:id/history', async req => {
    const { id } = parse(idParam, req.params);
    const ticket = await getTicket(db, id);
    if (!ticket) throw notFound('Ticket nicht gefunden');
    const { rows: entries } = await db.query<{ startedAt: string; endedAt: string | null; user: string | null; manual: boolean }>(
      `SELECT e.started_at AS "startedAt", e.ended_at AS "endedAt", u.name AS "user", e.manual
         FROM time_entries e LEFT JOIN users u ON u.id = e.user_id WHERE e.ticket_id = $1 ORDER BY e.started_at`,
      [id],
    );
    const events: { at: string; kind: string; user?: string | null; minutes?: number }[] = [
      { at: ticket.createdAt, kind: ticket.source === 'ha' ? 'createdByHa' : ticket.source === 'mail' ? 'createdByMail' : 'created' },
    ];
    const minutes = (e: { startedAt: string; endedAt: string | null }) => Math.round((Date.parse(e.endedAt!) - Date.parse(e.startedAt)) / 60000);
    for (const e of entries) {
      if (e.manual) {
        events.push({ at: e.endedAt!, kind: 'timeAdded', user: e.user, minutes: minutes(e) });
        continue;
      }
      events.push({ at: e.startedAt, kind: 'timerStarted', user: e.user });
      if (e.endedAt) events.push({ at: e.endedAt, kind: 'timerStopped', user: e.user, minutes: minutes(e) });
    }
    if (ticket.doneAt) events.push({ at: ticket.doneAt, kind: 'done' });
    return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  });

  // — notes —
  const NOTE_SELECT = `SELECT n.id, n.body, n.created_at AS "createdAt", n.user_id AS "userId", u.name AS "user"
                         FROM ticket_notes n LEFT JOIN users u ON u.id = n.user_id`;

  app.get('/api/tickets/:id/notes', async req => {
    const { id } = parse(idParam, req.params);
    if (!(await getTicket(db, id))) throw notFound('Ticket nicht gefunden');
    return (await db.query(`${NOTE_SELECT} WHERE n.ticket_id = $1 ORDER BY n.created_at, n.id`, [id])).rows;
  });

  app.post('/api/tickets/:id/notes', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { body } = parse(z.object({ body: z.string().trim().min(1, 'Die Notiz ist leer').max(4000) }), req.body);
    if (!(await getTicket(db, id))) throw notFound('Ticket nicht gefunden');
    const { rows: [{ id: noteId }] } = await db.query<{ id: number }>(
      'INSERT INTO ticket_notes (ticket_id, user_id, body) VALUES ($1, $2, $3) RETURNING id', [id, userId(req), body],
    );
    const { rows: [note] } = await db.query(`${NOTE_SELECT} WHERE n.id = $1`, [noteId]);
    return reply.code(201).send(note);
  });

  /** Authors delete their own notes, admins any. */
  app.delete('/api/notes/:id', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rows: [note] } = await db.query<{ userId: number | null }>('SELECT user_id AS "userId" FROM ticket_notes WHERE id = $1', [id]);
    if (!note) throw notFound('Notiz nicht gefunden');
    const p = req.principal!;
    const isAdmin = p.kind === 'user' ? p.user.role === 'admin' : p.scope === 'admin';
    if (!isAdmin && note.userId !== userId(req)) throw new HttpError(403, 'Nur eigene Notizen lassen sich löschen');
    await db.query('DELETE FROM ticket_notes WHERE id = $1', [id]);
    return reply.code(204).send();
  });

  /** The signed-in user's own tracked time: today, this week per day, per area, and the top tickets. */
  app.get('/api/me/time', async req => {
    const uid = userId(req);
    // Minutes of entry e inside [from, from + span), running timers counted up to now.
    const clipped = (from: string, span: string) =>
      `GREATEST(extract(epoch FROM (LEAST(COALESCE(e.ended_at, now()), now(), ${from} + interval '${span}') - GREATEST(e.started_at, ${from}))), 0) / 60`;
    // Own entries, without the areas the user hid in the app.
    const mine = `e.user_id IS NOT DISTINCT FROM $1 AND NOT EXISTS (
      SELECT 1 FROM tickets ht JOIN users hu ON hu.id = $1 WHERE ht.id = e.ticket_id AND ht.area_id = ANY(hu.hidden_areas))`;
    const week = "date_trunc('week', now())";
    const today = "date_trunc('day', now())";

    const { rows: days } = await db.query<{ date: string; minutes: number }>(
      `SELECT d::date::text AS date,
              COALESCE((SELECT round(sum(${clipped('d', '1 day')}))::int FROM time_entries e WHERE ${mine}), 0) AS minutes
         FROM generate_series(${week}, ${week} + interval '6 days', interval '1 day') d ORDER BY d`,
      [uid],
    );
    const perArea = async (from: string, span: string) => (await db.query<{ name: string; icon: string; minutes: number }>(
      `SELECT a.name, a.icon, round(sum(${clipped(from, span)}))::int AS minutes
         FROM time_entries e JOIN tickets t ON t.id = e.ticket_id JOIN areas a ON a.id = t.area_id
        WHERE ${mine} GROUP BY a.id ORDER BY a.position, a.id`,
      [uid],
    )).rows.filter(r => r.minutes > 0);
    const { rows: top } = await db.query<{ id: number; title: string; minutes: number }>(
      `SELECT t.id, t.title, round(sum(${clipped(week, '7 days')}))::int AS minutes
         FROM time_entries e JOIN tickets t ON t.id = e.ticket_id
        WHERE ${mine} GROUP BY t.id ORDER BY 3 DESC, t.id LIMIT 5`,
      [uid],
    );

    const todayAreas = await perArea(today, '1 day');
    return {
      today: { total: todayAreas.reduce((s, r) => s + r.minutes, 0), byArea: todayAreas },
      week: { total: days.reduce((s, d) => s + d.minutes, 0), days, byArea: await perArea(week, '7 days') },
      top: top.filter(r => r.minutes > 0),
    };
  });

  // — time tracking —

  app.get('/api/timer', async req => {
    const uid = userId(req);
    const { rows } = await db.query(
      `SELECT e.id, e.ticket_id AS "ticketId", t.title, e.started_at AS "startedAt"
         FROM time_entries e JOIN tickets t ON t.id = e.ticket_id
        WHERE e.ended_at IS NULL AND e.user_id IS NOT DISTINCT FROM $1 ORDER BY e.started_at DESC`,
      [uid],
    );
    return rows;
  });

  app.post('/api/tickets/:id/timer', { config: { access: 'member' } }, async req => {
    const { id } = parse(idParam, req.params);
    if (!(await getTicket(db, id))) throw notFound('Ticket nicht gefunden');
    const s = await ctx.settings.get();
    await withTransaction(db, c => startTimer(c, id, userId(req), { single: s.timeRules.singleTimer, rounding: s.rounding }));
    publisher.schedule();
    return getTicket(db, id);
  });

  app.post('/api/timer/stop', { config: { access: 'member' } }, async req => {
    const body = parse(z.object({ ticketId: z.number().int().optional() }).default({}), req.body ?? {});
    const uid = userId(req);
    const s = await ctx.settings.get();
    const params: unknown[] = [uid];
    let where = 'user_id IS NOT DISTINCT FROM $1';
    if (body.ticketId) { params.push(body.ticketId); where += ' AND ticket_id = $2'; }
    const stopped = await stopEntries(db, where, params, s.rounding);
    publisher.schedule();
    return { stopped };
  });

  app.post('/api/tickets/:id/time', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { minutes } = parse(z.object({ minutes: z.number().int().min(1).max(24 * 60) }), req.body);
    if (!(await getTicket(db, id))) throw notFound('Ticket nicht gefunden');
    await addManualTime(db, id, userId(req), minutes);
    publisher.schedule();
    reply.code(201);
    return getTicket(db, id);
  });
}
