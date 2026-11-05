import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { newTagCode, scanTag, TAG_SELECT, type Scanner, type Tag } from '../services/tags.js';

const tagInput = z.object({
  name: z.string().trim().min(1).max(100),
  action: z.enum(['done', 'timer', 'create']),
  ticketId: z.number().int().nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  areaId: z.number().int().nullable().optional(),
  prio: z.enum(['normal', 'high']).optional(),
  haTagId: z.string().trim().max(200).nullable().optional(),
});
const COLUMNS: Record<string, string> = { name: 'name', action: 'action', ticketId: 'ticket_id', title: 'title', areaId: 'area_id', prio: 'prio', haTagId: 'ha_tag_id' };

/** How long a tag scanned in Home Assistant that Tasklog does not know yet is offered for linking. */
const LEARN_MS = 10 * 60_000;

export function tagRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  let lastUnknownHa: { tagId: string; at: number } | null = null;

  const byId = async (id: number) => (await db.query<Tag>(`${TAG_SELECT} WHERE g.id = $1`, [id])).rows[0];
  /** "done" and "timer" need a ticket, "create" an area. */
  const check = async (t: { action: string; ticketId?: number | null; areaId?: number | null }) => {
    if (t.action === 'create') {
      if (!t.areaId || !(await db.query('SELECT 1 FROM areas WHERE id = $1', [t.areaId])).rowCount) throw new HttpError(400, 'Für „Ticket anlegen“ einen Bereich wählen');
    } else if (!t.ticketId || !(await db.query('SELECT 1 FROM tickets WHERE id = $1', [t.ticketId])).rowCount) {
      throw new HttpError(400, 'Ticket nicht gefunden');
    }
  };
  const uniqueHa = (err: unknown): never => {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'Dieser Home-Assistant-Tag gehört schon zu einem anderen Tag');
    throw err;
  };
  const scanner = (req: FastifyRequest): Scanner => req.principal?.kind === 'user'
    ? { userId: req.principal.user.id, name: req.principal.user.name, via: 'app' }
    : { userId: null, name: 'Home Assistant', via: 'ha' };
  const forget = (haTagId: string | null | undefined) => {
    if (haTagId && lastUnknownHa?.tagId === haTagId) lastUnknownHa = null;
  };

  app.get('/api/tags', async req => {
    const { ticketId } = parse(z.object({ ticketId: z.coerce.number().int().optional() }), req.query);
    return (await db.query<Tag>(`${TAG_SELECT} ${ticketId ? 'WHERE g.ticket_id = $1' : ''} ORDER BY g.name, g.id`, ticketId ? [ticketId] : [])).rows;
  });

  app.post('/api/tags', { config: { access: 'member' } }, async (req, reply) => {
    const body = parse(tagInput, req.body);
    await check(body);
    const createdBy = req.principal?.kind === 'user' ? req.principal.user.id : null;
    const { rows: [{ id }] } = await db.query<{ id: number }>(
      `INSERT INTO tags (code, name, action, ticket_id, title, area_id, prio, ha_tag_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [newTagCode(), body.name, body.action, body.action === 'create' ? null : body.ticketId, body.title ?? null, body.areaId ?? null, body.prio ?? 'normal', body.haTagId || null, createdBy],
    ).catch(uniqueHa);
    forget(body.haTagId);
    reply.code(201);
    return byId(id);
  });

  app.patch('/api/tags/:id', { config: { access: 'member' } }, async req => {
    const { id } = parse(idParam, req.params);
    const current = await byId(id);
    if (!current) throw notFound('Tag nicht gefunden');
    const body = parse(tagInput.partial(), req.body);
    if ('haTagId' in body) body.haTagId = body.haTagId || null;
    await check({ ...current, ...body });
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, col] of Object.entries(COLUMNS)) {
      if (key in body) {
        params.push(body[key as keyof typeof body] ?? null);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length) await db.query(`UPDATE tags SET ${sets.join(', ')} WHERE id = $1`, params).catch(uniqueHa);
    forget(body.haTagId);
    return byId(id);
  });

  app.delete('/api/tags/:id', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    if (!(await db.query('DELETE FROM tags WHERE id = $1', [id])).rowCount) throw notFound('Tag nicht gefunden');
    return reply.code(204).send();
  });

  /** The app opened /#/tag/<code>: the phone read the tag. */
  app.post('/api/tags/scan/:code', { config: { access: 'member' } }, async req => {
    const { code } = parse(z.object({ code: z.string().min(1).max(64) }), req.params);
    const { rows: [tag] } = await db.query<{ id: number; name: string }>('SELECT id, name FROM tags WHERE code = $1', [code]);
    if (!tag) throw notFound('Diesen Tag kennt Tasklog nicht (mehr)');
    return { tag: tag.name, tagId: tag.id, ...(await scanTag(ctx, tag.id, scanner(req))) };
  });

  /** The Home Assistant integration forwards every tag_scanned event; unknown tags are offered for linking. */
  app.post('/api/tags/ha', { config: { access: 'member' } }, async req => {
    const { tagId } = parse(z.object({ tagId: z.string().trim().min(1).max(200) }), req.body);
    const { rows: [tag] } = await db.query<{ id: number; name: string }>('SELECT id, name FROM tags WHERE ha_tag_id = $1', [tagId]);
    if (!tag) {
      lastUnknownHa = { tagId, at: Date.now() };
      return { result: 'unknown' };
    }
    return { tag: tag.name, tagId: tag.id, ...(await scanTag(ctx, tag.id, scanner(req))) };
  });

  /** "In Home Assistant scannen": the tag scanned there most recently that is not linked yet. */
  app.get('/api/tags/ha/last', async () => {
    if (!lastUnknownHa || Date.now() - lastUnknownHa.at > LEARN_MS) return { tagId: null };
    return { tagId: lastUnknownHa.tagId, secondsAgo: Math.round((Date.now() - lastUnknownHa.at) / 1000) };
  });
}
