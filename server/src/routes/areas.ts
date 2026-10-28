import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { userId } from '../auth/plugin.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';

const areaInput = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().regex(/^[a-z0-9-]+$/).optional(),
  defaultPrio: z.enum(['normal', 'high']).optional(),
});
const projectInput = z.object({ name: z.string().trim().min(1).max(80) });
const ids = z.array(z.number().int().positive()).max(200);
const areaPrefsInput = z.object({ order: ids, hidden: ids });

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';
const isFkViolation = (err: unknown) => (err as { code?: string }).code === '23503';

export function areaRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/areas', async () => {
    const { rows } = await db.query(
      `SELECT a.id, a.name, a.icon, a.default_prio AS "defaultPrio",
              COALESCE(json_agg(json_build_object('id', p.id, 'name', p.name,
                'open', (SELECT count(*) FROM tickets t WHERE t.project_id = p.id AND t.status <> 'done'))
                ORDER BY p.position, p.id) FILTER (WHERE p.id IS NOT NULL), '[]') AS projects
         FROM areas a LEFT JOIN projects p ON p.area_id = a.id
        GROUP BY a.id ORDER BY a.position, a.id`,
    );
    return rows;
  });

  app.post('/api/areas', async (req, reply) => {
    const body = parse(areaInput, req.body);
    try {
      const { rows } = await db.query(
        `INSERT INTO areas (name, icon, default_prio, position) VALUES ($1, $2, $3, (SELECT COALESCE(max(position), 0) + 1 FROM areas))
         RETURNING id, name, icon, default_prio AS "defaultPrio"`,
        [body.name, body.icon ?? 'folder', body.defaultPrio ?? 'normal'],
      );
      reply.code(201);
      return { ...rows[0], projects: [] };
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Einen Bereich mit diesem Namen gibt es schon');
      throw err;
    }
  });

  app.patch('/api/areas/:id', async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(areaInput.partial(), req.body);
    const { rows } = await db.query(
      `UPDATE areas SET name = COALESCE($2, name), icon = COALESCE($3, icon), default_prio = COALESCE($4, default_prio)
        WHERE id = $1 RETURNING id, name, icon, default_prio AS "defaultPrio"`,
      [id, body.name ?? null, body.icon ?? null, body.defaultPrio ?? null],
    );
    if (!rows[0]) throw notFound('Bereich nicht gefunden');
    return rows[0];
  });

  app.delete('/api/areas/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    try {
      const { rowCount } = await db.query('DELETE FROM areas WHERE id = $1', [id]);
      if (!rowCount) throw notFound('Bereich nicht gefunden');
    } catch (err) {
      if (isFkViolation(err)) throw new HttpError(409, 'Der Bereich hat noch Tickets oder Regeln');
      throw err;
    }
    return reply.code(204).send();
  });

  app.post('/api/areas/:id/projects', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(projectInput, req.body);
    try {
      const { rows } = await db.query(
        `INSERT INTO projects (area_id, name, position) VALUES ($1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM projects WHERE area_id = $1))
         RETURNING id, name, 0 AS open`,
        [id, body.name],
      );
      reply.code(201);
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Dieses Projekt gibt es in dem Bereich schon');
      if (isFkViolation(err)) throw notFound('Bereich nicht gefunden');
      throw err;
    }
  });

  app.patch('/api/projects/:id', async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(projectInput, req.body);
    const { rows } = await db.query('UPDATE projects SET name = $2 WHERE id = $1 RETURNING id, name', [id, body.name]);
    if (!rows[0]) throw notFound('Projekt nicht gefunden');
    return rows[0];
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Projekt nicht gefunden');
    return reply.code(204).send();
  });

  // — the signed-in user's own order and hidden areas in the app —
  const ownUser = (req: Parameters<typeof userId>[0]) => {
    const uid = userId(req);
    if (uid === null) throw new HttpError(400, 'Nur für angemeldete Benutzer');
    return uid;
  };

  app.get('/api/me/areas', async req => {
    const { rows: [r] } = await db.query<{ order: number[]; hidden: number[] }>(
      'SELECT area_order AS "order", hidden_areas AS hidden FROM users WHERE id = $1', [ownUser(req)],
    );
    return r ?? { order: [], hidden: [] };
  });

  app.put('/api/me/areas', { config: { access: 'read' } }, async req => {
    const body = parse(areaPrefsInput, req.body);
    const { rows: [r] } = await db.query<{ order: number[]; hidden: number[] }>(
      `UPDATE users SET area_order = $2, hidden_areas = $3 WHERE id = $1
       RETURNING area_order AS "order", hidden_areas AS hidden`,
      [ownUser(req), [...new Set(body.order)], [...new Set(body.hidden)]],
    );
    return r;
  });
}
