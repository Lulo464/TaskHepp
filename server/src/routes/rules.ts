import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Queryable } from '../db.js';
import { idParam, notFound, parse } from '../lib/http.js';
import { ruleTemplate } from '../services/conditions.js';
import type { RuleForYaml } from '../services/yaml.js';

const ruleInput = z.object({
  name: z.string().trim().min(1).max(100),
  entity: z.string().trim().regex(/^[a-z_]+\.[\w]+$/, 'Entität im Format domain.objekt_id'),
  cond: z.string().trim().min(1).max(200),
  join: z.enum(['and', 'or']),
  cond2: z.string().trim().max(200),
  window: z.string().trim().regex(/^\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}$/, 'Zeitfenster im Format HH:MM–HH:MM'),
  title: z.string().trim().min(1).max(200),
  areaId: z.number().int(),
  prio: z.enum(['normal', 'high']),
  onEnd: z.enum(['close', 'keepOpen']),
  dedupe: z.boolean(),
  enabled: z.boolean(),
});

const COLUMNS: Record<keyof z.infer<typeof ruleInput>, string> = {
  name: 'name', entity: 'entity', cond: 'cond', join: 'join_op', cond2: 'cond2', window: 'time_window',
  title: 'ticket_title', areaId: 'area_id', prio: 'prio', onEnd: 'on_end', dedupe: 'dedupe', enabled: 'enabled',
};

export type RuleRow = RuleForYaml & { areaId: number };

export async function listRules(db: Queryable): Promise<RuleRow[]> {
  const { rows } = await db.query<RuleRow>(
    `SELECT r.id, r.name, r.entity, r.cond, r.join_op AS join, r.cond2, r.time_window AS window, r.ticket_title AS title,
            r.area_id AS "areaId", a.name AS area, r.prio, r.on_end AS "onEnd", r.dedupe, r.enabled
       FROM rules r JOIN areas a ON a.id = r.area_id ORDER BY r.id`,
  );
  return rows;
}

async function getRule(db: Queryable, id: number) {
  return (await listRules(db)).find(r => r.id === id) ?? null;
}

/** Whether the condition can be turned into a Home Assistant trigger; shown in the editor. */
const withCheck = (r: RuleRow) => ({ ...r, translatable: ruleTemplate(r) !== null });

export function ruleRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/rules', async () => (await listRules(db)).map(withCheck));

  app.post('/api/rules', async (req, reply) => {
    const body = parse(ruleInput, req.body);
    const cols = Object.keys(COLUMNS) as (keyof typeof COLUMNS)[];
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO rules (${cols.map(c => COLUMNS[c]).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      cols.map(c => body[c]),
    );
    reply.code(201);
    return withCheck((await getRule(db, rows[0].id))!);
  });

  app.patch('/api/rules/:id', async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(ruleInput.partial(), req.body);
    const keys = Object.keys(body) as (keyof typeof COLUMNS)[];
    if (keys.length) {
      const { rowCount } = await db.query(
        `UPDATE rules SET ${keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...keys.map(k => body[k])],
      );
      if (!rowCount) throw notFound('Regel nicht gefunden');
    }
    const rule = await getRule(db, id);
    if (!rule) throw notFound('Regel nicht gefunden');
    return withCheck(rule);
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rowCount } = await db.query('DELETE FROM rules WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Regel nicht gefunden');
    return reply.code(204).send();
  });

  /** Dry run: what the rule would create right now, without creating anything. */
  app.post('/api/rules/:id/test', { config: { access: 'member' } }, async req => {
    const { id } = parse(idParam, req.params);
    const rule = await getRule(db, id);
    if (!rule) throw notFound('Regel nicht gefunden');
    const parsed = ruleTemplate(rule);
    const { rows } = await db.query<{ id: number; title: string }>(
      "SELECT id, title FROM tickets WHERE rule_id = $1 AND status <> 'done' ORDER BY id LIMIT 1",
      [id],
    );
    const blockedBy = rule.dedupe ? rows[0] ?? null : null;
    return {
      ticket: { title: rule.title, area: rule.area, prio: rule.prio, due: 'today', source: 'ha' },
      wouldCreate: rule.enabled && !blockedBy,
      enabled: rule.enabled,
      duplicateOf: blockedBy,
      haTemplate: parsed ? `{{ ${parsed.template} }}` : null,
      holdFor: parsed?.holdFor ?? null,
    };
  });
}
