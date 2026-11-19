import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { withTransaction, type Queryable } from '../db.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { createTicket, getTicket } from '../services/tickets.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');

const itemInput = z.object({
  title: z.string().trim().min(1, 'Jeder Eintrag braucht einen Titel').max(200),
  description: z.string().trim().max(4000).default(''),
  prio: z.enum(['normal', 'high']).default('normal'),
  /** Days from the date chosen when the template is used; negative = before, null = no due date. */
  offsetDays: z.number().int().min(-365).max(365).nullable().default(null),
  dueTime: hhmm.nullable().default(null),
  checklist: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
});
export type TemplateItem = z.infer<typeof itemInput>;

const templateInput = z.object({
  name: z.string().trim().min(1, 'Die Vorlage braucht einen Namen').max(100),
  icon: z.string().regex(/^[a-z0-9-]+$/).max(40).default('stack'),
  areaId: z.number().int().nullable().default(null),
  items: z.array(itemInput).min(1, 'Die Vorlage braucht mindestens einen Eintrag').max(50),
});

const TEMPLATE_SELECT = `
  SELECT t.id, t.name, t.icon, t.area_id AS "areaId", a.name AS area, t.items, t.updated_at AS "updatedAt"
    FROM ticket_templates t LEFT JOIN areas a ON a.id = t.area_id`;

/** The example offered on an empty list. */
export const EXAMPLE_TEMPLATE = {
  name: 'Urlaub vorbereiten',
  icon: 'airplane-tilt',
  items: [
    { title: 'Unterkunft und Anreise prüfen', offsetDays: -14, description: '', prio: 'normal', dueTime: null, checklist: [] },
    { title: 'Nachbarn wegen Post und Blumen fragen', offsetDays: -7, description: '', prio: 'normal', dueTime: null, checklist: [] },
    { title: 'Koffer packen', offsetDays: -1, description: '', prio: 'normal', dueTime: null, checklist: ['Ausweise', 'Ladekabel', 'Medikamente', 'Kleidung', 'Kulturbeutel'] },
    { title: 'Heizung runter, Fenster zu, Stecker ziehen', offsetDays: 0, description: '', prio: 'high', dueTime: '07:00', checklist: [] },
    { title: 'Müll rausbringen, Kühlschrank leeren', offsetDays: -1, description: '', prio: 'normal', dueTime: '19:00', checklist: [] },
  ] satisfies TemplateItem[],
};

const checkAreas = async (db: Queryable, ...ids: (number | null | undefined)[]) => {
  for (const id of ids) {
    if (id != null && !(await db.query('SELECT 1 FROM areas WHERE id = $1', [id])).rowCount) throw new HttpError(400, 'Unbekannter Bereich');
  }
};

/** Ticket templates and duplicating a ticket. Everyone who works on tickets may use and maintain templates. */
export function templateRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, publisher } = ctx;
  const byId = async (id: number) => (await db.query(`${TEMPLATE_SELECT} WHERE t.id = $1`, [id])).rows[0];

  app.get('/api/templates', async () => (await db.query(`${TEMPLATE_SELECT} ORDER BY lower(t.name), t.id`)).rows);

  app.post('/api/templates', { config: { access: 'member' } }, async (req, reply) => {
    const body = parse(templateInput, req.body);
    await checkAreas(db, body.areaId);
    const { rows: [{ id }] } = await db.query<{ id: number }>(
      'INSERT INTO ticket_templates (name, icon, area_id, items, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [body.name, body.icon, body.areaId, JSON.stringify(body.items), userId(req)],
    );
    reply.code(201);
    return byId(id);
  });

  app.put('/api/templates/:id', { config: { access: 'member' } }, async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(templateInput, req.body);
    await checkAreas(db, body.areaId);
    const { rowCount } = await db.query(
      'UPDATE ticket_templates SET name = $2, icon = $3, area_id = $4, items = $5, updated_at = now() WHERE id = $1',
      [id, body.name, body.icon, body.areaId, JSON.stringify(body.items)],
    );
    if (!rowCount) throw notFound('Vorlage nicht gefunden');
    return byId(id);
  });

  app.delete('/api/templates/:id', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    if (!(await db.query('DELETE FROM ticket_templates WHERE id = $1', [id])).rowCount) throw notFound('Vorlage nicht gefunden');
    return reply.code(204).send();
  });

  /** All tickets of a template at once; due dates counted from `date` (default today). */
  app.post('/api/templates/:id/apply', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      date: date.optional(),
      areaId: z.number().int().optional(),
      assigneeId: z.number().int().nullable().optional(),
      /** Only these items (by position); default all. */
      only: z.array(z.number().int().min(0)).optional(),
    }), req.body ?? {});
    const template = await byId(id) as { areaId: number | null; items: TemplateItem[] } | undefined;
    if (!template) throw notFound('Vorlage nicht gefunden');
    const areaId = body.areaId ?? template.areaId;
    if (!areaId) throw new HttpError(400, 'Bitte einen Bereich wählen');
    await checkAreas(db, areaId);
    if (body.assigneeId != null && !(await db.query("SELECT 1 FROM users WHERE id = $1 AND role IN ('member', 'admin')", [body.assigneeId])).rowCount) {
      throw new HttpError(400, 'Diese Person kann keine Tickets übernehmen');
    }
    const ids = await withTransaction(db, async c => {
      const { rows: [{ base }] } = await c.query<{ base: string }>('SELECT COALESCE($1::date, current_date)::text AS base', [body.date ?? null]);
      const made: number[] = [];
      for (const [i, item] of template.items.entries()) {
        if (body.only && !body.only.includes(i)) continue;
        const { rows: [{ due }] } = await c.query<{ due: string | null }>(
          'SELECT CASE WHEN $2::int IS NULL THEN NULL ELSE ($1::date + $2::int)::text END AS due', [base, item.offsetDays],
        );
        const ticketId = await createTicket(c, {
          title: item.title, description: item.description, areaId, prio: item.prio, due, dueTime: due ? item.dueTime : null,
          assigneeId: body.assigneeId === undefined ? userId(req) : body.assigneeId, source: 'app',
        });
        if (item.checklist.length) {
          await c.query(
            'INSERT INTO ticket_checklist (ticket_id, text, position) SELECT $1, line, n FROM unnest($2::text[]) WITH ORDINALITY AS l(line, n)',
            [ticketId, item.checklist],
          );
        }
        made.push(ticketId);
      }
      return made;
    });
    publisher.schedule();
    reply.code(201);
    return { created: ids.length, tickets: await Promise.all(ids.map(t => getTicket(db, t))) };
  });

  /** Everything that describes the work — not its time, notes, photos or done state. */
  app.post('/api/tickets/:id/duplicate', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const newId = await withTransaction(db, async c => {
      const { rows: [t] } = await c.query(
        `SELECT title, description, area_id AS "areaId", project_id AS "projectId", prio, assignee_id AS "assigneeId",
                due_date::text AS due, to_char(due_time, 'HH24:MI') AS "dueTime", recurrence, auto_close AS "autoClose"
           FROM tickets WHERE id = $1`,
        [id],
      );
      if (!t) throw notFound('Ticket nicht gefunden');
      const copy = await createTicket(c, { ...t, source: 'app' });
      await c.query(
        'INSERT INTO ticket_checklist (ticket_id, text, position) SELECT $2, text, position FROM ticket_checklist WHERE ticket_id = $1 ORDER BY position, id',
        [id, copy],
      );
      return copy;
    });
    publisher.schedule();
    reply.code(201);
    return getTicket(db, newId);
  });

  /** "Als Vorlage speichern": a template with this ticket as its only item. */
  app.post('/api/tickets/:id/template', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const ticket = await getTicket(db, id);
    if (!ticket) throw notFound('Ticket nicht gefunden');
    const { rows: checklist } = await db.query<{ text: string }>('SELECT text FROM ticket_checklist WHERE ticket_id = $1 ORDER BY position, id', [id]);
    const item: TemplateItem = {
      title: ticket.title, description: ticket.description, prio: ticket.prio, offsetDays: ticket.due ? 0 : null,
      dueTime: ticket.dueTime, checklist: checklist.map(c => c.text),
    };
    const { rows: [{ id: templateId }] } = await db.query<{ id: number }>(
      'INSERT INTO ticket_templates (name, area_id, items, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [ticket.title, ticket.areaId, JSON.stringify([item]), userId(req)],
    );
    reply.code(201);
    return byId(templateId);
  });

  app.get('/api/templates/example', async () => EXAMPLE_TEMPLATE);
}
