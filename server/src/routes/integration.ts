import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { hmacSha256, randomToken, safeEqual } from '../lib/crypto.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { OWN_LISTS, syncHaTodos } from '../services/haTodo.js';
import { enabledEntities, entityCalculators } from '../services/entities.js';
import { webhookBodySchema } from '../services/webhook.js';
import { dashboardYaml, homeAssistantYaml, tasklogYaml } from '../services/yaml.js';
import { findApiToken } from '../auth/sessions.js';
import { listRules } from './rules.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export const webhookUrl = (publicUrl: string, webhookId: string) => new URL(`/api/hooks/ha/${webhookId}`, publicUrl).toString();

/** Home Assistant in both directions: the inbound webhook, published entities, connection and generated config. */
export function integrationRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, settings, config } = ctx;

  // — HA → Tasklog —
  // Own scope so the raw body is kept for the HMAC check without affecting other routes.
  app.register(async scoped => {
    scoped.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      req.rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(new HttpError(400, 'Ungültiges JSON'), undefined);
      }
    });

    scoped.post('/api/hooks/ha/:hookId', { config: { access: 'public' } }, async (req, reply) => {
      const s = await settings.get();
      const { hookId } = req.params as { hookId: string };
      if (!safeEqual(hookId, s.webhookId)) throw notFound();

      const reject = async (message: string, code: number) => {
        await ctx.log.add('in', `Webhook: ${message}`, 'rejected', { kind: 'webhook', body: req.body });
        throw new HttpError(code, message);
      };

      const auth = req.headers.authorization;
      const token = auth?.startsWith('Bearer ') ? await findApiToken(db, auth.slice(7).trim()) : null;
      if (!token) return reject('ungültiges Token', 401);
      if (token.scope === 'read') return reject('Token ohne Schreibrecht', 403);

      if (s.enforceSignature) {
        const sig = String(req.headers['x-tasklog-signature'] ?? '');
        const expected = 'sha256=' + hmacSha256(s.webhookSecret, req.rawBody ?? '');
        if (!safeEqual(sig, expected)) return reject('Signatur fehlt oder ist falsch', 401);
      }

      const parsed = webhookBodySchema.safeParse(req.body);
      if (!parsed.success) return reject(`ungültige Daten (${parsed.error.issues[0]?.message})`, 400);
      const result = await ctx.webhook.process(parsed.data);
      reply.code(result.result === 'created' ? 201 : result.result === 'unknownRule' ? 404 : 200);
      return result;
    });
  });

  // — Tasklog → HA —
  app.get('/api/entities', async () => {
    const { rows } = await db.query<{ id: string; enabled: boolean; lastState: string | null }>(
      'SELECT entity_id AS id, enabled, last_state AS "lastState" FROM published_entities ORDER BY position, entity_id',
    );
    return rows;
  });

  app.patch('/api/entities/:entityId', async req => {
    const { entityId } = req.params as { entityId: string };
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const { rows } = await db.query(
      'UPDATE published_entities SET enabled = $2 WHERE entity_id = $1 RETURNING entity_id AS id, enabled, last_state AS "lastState"',
      [entityId, enabled],
    );
    if (!rows[0]) throw notFound('Entität nicht gefunden');
    if (enabled) ctx.publisher.schedule();
    return rows[0];
  });

  // — connection —
  app.get('/api/ha', { config: { access: 'admin' } }, async () => {
    const s = await settings.get();
    return { url: s.ha.url, hasToken: Boolean(s.ha.token), webhookUrl: webhookUrl(config.PUBLIC_URL, s.webhookId), enforceSignature: s.enforceSignature };
  });

  /** Entities to pick from, e.g. for "erledigt, wenn …"; members may read them. */
  app.get('/api/ha/entities', { config: { access: 'member' } }, async () => {
    if (!(await ctx.ha.isConfigured())) return [];
    const states = await ctx.ha.listStates().catch((err: Error) => { throw new HttpError(502, `Home Assistant: ${err.message}`); });
    return states
      .filter(s => !/^(zone|sun|weather|update|automation|script|scene|conversation|tts|stt|event|button|todo|calendar)\./.test(s.entity_id))
      .map(s => ({ id: s.entity_id, name: String(s.attributes.friendly_name ?? s.entity_id), state: s.state }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });

  // — to-do lists linked to areas —

  /** Each area with its linked list, and the lists Home Assistant has. */
  app.get('/api/ha/todo-links', async () => {
    const { rows: areas } = await ctx.db.query(
      `SELECT a.id, a.name, a.icon, a.ha_todo_entity AS entity, a.ha_todo_synced_at AS "syncedAt", a.ha_todo_error AS error,
              (SELECT count(*)::int FROM ha_todo_links l WHERE l.area_id = a.id AND l.entity = a.ha_todo_entity) AS linked
         FROM areas a ORDER BY a.position, a.id`,
    );
    let lists: { id: string; name: string; open: number }[] = [];
    let haError: string | null = null;
    if (await ctx.ha.isConfigured()) {
      try {
        lists = (await ctx.ha.listStates())
          .filter(s => s.entity_id.startsWith('todo.') && !OWN_LISTS.test(s.entity_id))
          .map(s => ({ id: s.entity_id, name: String(s.attributes.friendly_name ?? s.entity_id), open: Number(s.state) || 0 }))
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      } catch (err) {
        haError = (err as Error).message;
      }
    }
    return { configured: await ctx.ha.isConfigured(), haError, lists, areas };
  });

  app.put('/api/areas/:id/ha-todo', async req => {
    const { id } = parse(idParam, req.params);
    const { entity } = parse(z.object({
      entity: z.string().regex(/^todo\.[a-z0-9_]+$/, 'Eine To-do-Liste aus Home Assistant, z. B. todo.einkaufsliste').nullable(),
    }), req.body);
    if (entity && OWN_LISTS.test(entity)) throw new HttpError(400, 'Das ist eine Liste der Tasklog-Integration selbst; sie zeigt den Bereich schon');
    if (entity) {
      const { rows: [other] } = await ctx.db.query<{ name: string }>('SELECT name FROM areas WHERE ha_todo_entity = $1 AND id <> $2', [entity, id]);
      if (other) throw new HttpError(409, `Diese Liste ist schon mit „${other.name}“ verknüpft`);
    }
    const { rowCount } = await ctx.db.query(
      'UPDATE areas SET ha_todo_entity = $2, ha_todo_synced_at = NULL, ha_todo_error = NULL WHERE id = $1', [id, entity],
    );
    if (!rowCount) throw notFound('Bereich nicht gefunden');
    // Another list (or none) starts fresh; tickets and items themselves stay.
    await ctx.db.query('DELETE FROM ha_todo_links WHERE area_id = $1 AND entity IS DISTINCT FROM $2', [id, entity]);
    if (entity) await syncHaTodos(ctx);
    return { ok: true };
  });

  app.post('/api/ha/todo-links/sync', async () => {
    await syncHaTodos(ctx);
    return { ok: true };
  });

  app.post('/api/ha/test', async () => {
    const result = await ctx.ha.check();
    if (result.ok) ctx.publisher.schedule();
    return result;
  });

  app.post('/api/ha/publish', async () => {
    await ctx.publisher.publishAll();
    return { ok: true };
  });

  /** New webhook id and signing secret; HA's rest_command must then be updated. */
  app.post('/api/ha/webhook/rotate', async () => {
    const s = await settings.update({ webhookId: randomToken(9), webhookSecret: randomToken(32) });
    return { webhookUrl: webhookUrl(config.PUBLIC_URL, s.webhookId), webhookSecret: s.webhookSecret };
  });

  // — generated configuration —
  app.get('/api/config/homeassistant.yaml', async (_req, reply) => {
    const s = await settings.get();
    reply.type('text/yaml; charset=utf-8');
    return homeAssistantYaml(await listRules(db), webhookUrl(config.PUBLIC_URL, s.webhookId));
  });

  app.get('/api/config/tasklog.yaml', async (_req, reply) => {
    const s = await settings.get();
    reply.type('text/yaml; charset=utf-8');
    return tasklogYaml(await listRules(db), await enabledEntities(db), { haUrl: s.ha.url, webhookUrl: webhookUrl(config.PUBLIC_URL, s.webhookId) });
  });

  app.get('/api/config/dashboard.yaml', async (_req, reply) => {
    reply.type('text/yaml; charset=utf-8');
    return dashboardYaml((await db.query<{ name: string }>('SELECT name FROM areas ORDER BY position, id')).rows);
  });

  /** Current values of the published entities, for checking without HA. */
  app.get('/api/entities/preview', async () => {
    const out: Record<string, unknown> = {};
    for (const id of Object.keys(entityCalculators)) out[id] = await entityCalculators[id](db);
    return out;
  });
}
