import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { previewSource, reapplySource, SOURCE_SELECT, syncSource, type CalendarSource } from '../services/calendars.js';
import { HaNotConfigured } from '../services/homeAssistant.js';

const sourceInput = z.object({
  entityId: z.string().trim().regex(/^calendar\.[\w]+$/, 'Kalender-Entität im Format calendar.name'),
  name: z.string().trim().min(1).max(80),
  areaId: z.number().int(),
  titleTemplate: z.string().trim().min(1).max(200),
  leadDays: z.number().int().min(0).max(14),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM').nullable(),
  lookaheadDays: z.number().int().min(1).max(90),
  prio: z.enum(['normal', 'high']),
  autoClose: z.boolean(),
  enabled: z.boolean(),
  excludedTypes: z.array(z.string().trim().min(1).max(200)).max(50),
});

const COLUMNS: Record<keyof z.infer<typeof sourceInput>, string> = {
  entityId: 'entity_id', name: 'name', areaId: 'area_id', titleTemplate: 'title_template', leadDays: 'lead_days', dueTime: 'due_time',
  lookaheadDays: 'lookahead_days', prio: 'prio', autoClose: 'auto_close', enabled: 'enabled', excludedTypes: 'excluded_types',
};

/** HA errors become a readable 502 instead of a 500. */
async function viaHa<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HaNotConfigured) throw new HttpError(409, err.message);
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, `Home Assistant: ${(err as Error).message}`);
  }
}

export function calendarRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  const getSource = async (id: number) => {
    const { rows } = await db.query<CalendarSource>(`${SOURCE_SELECT} WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound('Kalender nicht gefunden');
    return rows[0];
  };

  /** Calendars Home Assistant offers, for the picker. */
  app.get('/api/ha/calendars', { config: { access: 'admin' } }, async () => viaHa(() => ctx.ha.listCalendars()));

  app.get('/api/calendars', async () => (await db.query<CalendarSource>(`${SOURCE_SELECT} ORDER BY name`)).rows);

  app.post('/api/calendars', async (req, reply) => {
    const body = parse(sourceInput.extend({ excludedTypes: sourceInput.shape.excludedTypes.default([]), dueTime: sourceInput.shape.dueTime.default(null) }), req.body);
    const keys = Object.keys(COLUMNS) as (keyof typeof COLUMNS)[];
    try {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO calendar_sources (${keys.map(k => COLUMNS[k]).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        keys.map(k => body[k]),
      );
      const source = await getSource(rows[0].id);
      if (source.enabled) await syncSource(ctx, source).catch(() => {}); // first import right away; errors show on the source
      reply.code(201);
      return getSource(source.id);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'Dieser Kalender ist schon eingebunden');
      throw err;
    }
  });

  app.patch('/api/calendars/:id', async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(sourceInput.partial(), req.body);
    const keys = Object.keys(body) as (keyof typeof COLUMNS)[];
    if (keys.length) {
      const { rowCount } = await db.query(
        `UPDATE calendar_sources SET ${keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...keys.map(k => body[k])],
      );
      if (!rowCount) throw notFound('Kalender nicht gefunden');
    }
    const source = await getSource(id);
    if (keys.some(k => k === 'titleTemplate' || k === 'leadDays' || k === 'dueTime' || k === 'areaId' || k === 'prio' || k === 'excludedTypes')) await reapplySource(ctx, source);
    // A type switched back on gets its tickets right away.
    if (keys.includes('excludedTypes') && source.enabled) await syncSource(ctx, source).catch(() => {});
    return getSource(id);
  });

  /** Removes the link; tickets that were already created stay. */
  app.delete('/api/calendars/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rowCount } = await db.query('DELETE FROM calendar_sources WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Kalender nicht gefunden');
    return reply.code(204).send();
  });

  app.get('/api/calendars/:id/events', async req => {
    const { id } = parse(idParam, req.params);
    const source = await getSource(id);
    return viaHa(() => previewSource(ctx, source));
  });

  app.post('/api/calendars/:id/sync', async req => {
    const { id } = parse(idParam, req.params);
    const source = await getSource(id);
    return viaHa(() => syncSource(ctx, source));
  });
}
