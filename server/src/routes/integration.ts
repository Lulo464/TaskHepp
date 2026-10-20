import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { hmacSha256, randomToken, safeEqual } from '../lib/crypto.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import { enabledEntities, entityCalculators } from '../services/entities.js';
import { webhookBodySchema } from '../services/webhook.js';
import { homeAssistantYaml, tasklogYaml } from '../services/yaml.js';
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
  app.get('/api/ha', async () => {
    const s = await settings.get();
    return { url: s.ha.url, hasToken: Boolean(s.ha.token), webhookUrl: webhookUrl(config.PUBLIC_URL, s.webhookId), enforceSignature: s.enforceSignature };
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

  /** Current values of the published entities, for checking without HA. */
  app.get('/api/entities/preview', async () => {
    const out: Record<string, unknown> = {};
    for (const id of Object.keys(entityCalculators)) out[id] = await entityCalculators[id](db);
    return out;
  });
}
