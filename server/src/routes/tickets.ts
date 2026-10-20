import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import { idParam, notFound, parse } from '../lib/http.js';
import { createTicket, getTicket, setStatus, TICKET_ORDER, TICKET_SELECT, type TicketRow } from '../services/tickets.js';
import { addManualTime, startTimer, stopEntries } from '../services/time.js';

const status = z.enum(['open', 'inProgress', 'done']);
const prio = z.enum(['normal', 'high']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ticketInput = z.object({
  title: z.string().trim().min(1).max(200),
  areaId: z.number().int(),
  projectId: z.number().int().nullable().optional(),
  status: status.optional(),
  prio: prio.optional(),
  assigneeId: z.number().int().nullable().optional(),
  due: date.nullable().optional(),
  source: z.enum(['manual', 'app']).optional(),
});

const listQuery = z.object({
  q: z.string().optional(),
  areaId: z.coerce.number().int().optional(),
  source: z.enum(['manual', 'app', 'ha']).optional(),
  status: status.optional(),
  open: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export function ticketRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, publisher } = ctx;

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
    const id = await createTicket(db, body);
    publisher.schedule();
    reply.code(201);
    return getTicket(db, id);
  });

  app.patch('/api/tickets/:id', { config: { access: 'member' } }, async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(ticketInput.partial(), req.body);
    const cols: Record<string, string> = { title: 'title', areaId: 'area_id', projectId: 'project_id', prio: 'prio', assigneeId: 'assignee_id', due: 'due_date', source: 'source' };
    await withTransaction(db, async c => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, col] of Object.entries(cols)) {
        if (key in body) {
          params.push(body[key as keyof typeof body] ?? null);
          sets.push(`${col} = $${params.length}`);
        }
      }
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
