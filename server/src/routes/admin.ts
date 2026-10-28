import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import type { LogPayload, LogStatus } from '../services/eventLog.js';
import { settingsPatchSchema, type Settings } from '../services/settings.js';
import { webhookBodySchema } from '../services/webhook.js';

const role = z.enum(['admin', 'member', 'read']);

/** Settings as the admin UI sees them: the HA token never leaves the server. */
const publicSettings = ({ ha, webhookSecret: _secret, ...rest }: Settings) => ({ ...rest, ha: { url: ha.url, hasToken: Boolean(ha.token) } });

export function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, settings } = ctx;

  // — users & roles —
  app.get('/api/users', { config: { access: 'admin' } }, async () => {
    const { rows } = await db.query(
      `SELECT id, name, email, oidc_group AS "group", role, role_override AS "roleOverride", last_seen_at AS "lastSeenAt"
         FROM users ORDER BY name`,
    );
    return rows;
  });

  /** Manual role change; it then sticks across logins instead of following the OIDC groups. */
  app.patch('/api/users/:id', async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ role, followGroups: z.boolean().optional() }), req.body);
    if (req.principal?.kind === 'user' && req.principal.user.id === id && body.role !== 'admin') {
      throw new HttpError(409, 'Du kannst dir die Admin-Rolle nicht selbst entziehen');
    }
    const { rows } = await db.query(
      `UPDATE users SET role = $2, role_override = $3 WHERE id = $1
       RETURNING id, name, email, oidc_group AS "group", role, role_override AS "roleOverride", last_seen_at AS "lastSeenAt"`,
      [id, body.role, !body.followGroups],
    );
    if (!rows[0]) throw notFound('Benutzer nicht gefunden');
    return rows[0];
  });

  app.get('/api/group-roles', async () => {
    const { rows } = await db.query('SELECT oidc_group AS "group", role FROM group_roles ORDER BY oidc_group');
    return rows;
  });

  app.put('/api/group-roles', async req => {
    const body = parse(z.array(z.object({ group: z.string().trim().min(1), role })).max(100), req.body);
    await withTransaction(db, async c => {
      await c.query('DELETE FROM group_roles');
      for (const g of body) await c.query('INSERT INTO group_roles (oidc_group, role) VALUES ($1, $2) ON CONFLICT (oidc_group) DO UPDATE SET role = EXCLUDED.role', [g.group, g.role]);
    });
    return body;
  });

  // — sessions —
  app.get('/api/sessions', { config: { access: 'admin' } }, async req => {
    const { rows } = await db.query(
      `SELECT s.id, s.device, s.ip, s.created_at AS "createdAt", s.last_seen_at AS "lastSeenAt", u.name AS "user"
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > now() ORDER BY s.last_seen_at DESC`,
    );
    const current = req.principal?.kind === 'user' ? req.principal.sessionId : null;
    return rows.map(r => ({ ...r, current: r.id === current }));
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rowCount } = await db.query('DELETE FROM sessions WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Sitzung nicht gefunden');
    return reply.code(204).send();
  });

  // — API tokens —
  app.get('/api/tokens', { config: { access: 'admin' } }, async () => {
    const { rows } = await db.query(
      `SELECT id, name, prefix, scope, created_at AS "createdAt", last_used_at AS "lastUsedAt" FROM api_tokens ORDER BY id`,
    );
    return rows;
  });

  /** The full token is returned exactly once. */
  app.post('/api/tokens', async (req, reply) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), scope: z.enum(['read', 'tickets:write', 'admin']) }), req.body);
    const kind = body.scope === 'read' ? 'ro' : body.scope === 'admin' ? 'admin' : 'live';
    const token = `tl_${kind}_${randomToken(24)}`;
    const prefix = token.slice(0, token.indexOf('_', 3) + 5);
    const { rows } = await db.query(
      `INSERT INTO api_tokens (name, prefix, token_hash, scope) VALUES ($1, $2, $3, $4)
       RETURNING id, name, prefix, scope, created_at AS "createdAt", last_used_at AS "lastUsedAt"`,
      [body.name, prefix, sha256(token), body.scope],
    );
    reply.code(201);
    return { ...rows[0], token };
  });

  app.delete('/api/tokens/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rowCount } = await db.query('DELETE FROM api_tokens WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Token nicht gefunden');
    return reply.code(204).send();
  });

  // — event log —
  app.get('/api/logs', async req => {
    const q = parse(z.object({ filter: z.enum(['all', 'errors', 'in', 'out']).default('all'), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const where = { all: 'true', errors: "status IN ('rejected', 'error')", in: "direction = 'in'", out: "direction = 'out'" }[q.filter];
    const { rows } = await db.query(
      `SELECT id, at, direction, message, status, retried_at AS "retriedAt", payload IS NOT NULL AND status IN ('rejected', 'error') AS retryable
         FROM event_log WHERE ${where} ORDER BY at DESC, id DESC LIMIT $1`,
      [q.limit],
    );
    return rows;
  });

  /** Replays a failed event: re-processes an inbound webhook or re-sends a state/notification. */
  app.post('/api/logs/:id/retry', async req => {
    const { id } = parse(idParam, req.params);
    const { rows } = await db.query<{ payload: LogPayload | null }>('SELECT payload FROM event_log WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Eintrag nicht gefunden');
    const payload = rows[0].payload;
    if (!payload) throw new HttpError(409, 'Dieser Eintrag kann nicht wiederholt werden');

    let status: LogStatus;
    if (payload.kind === 'webhook') {
      const body = webhookBodySchema.safeParse(payload.body);
      if (!body.success) throw new HttpError(409, 'Die gespeicherten Daten sind ungültig und können nicht erneut verarbeitet werden');
      const { result } = await ctx.webhook.process(body.data, true);
      status = result === 'created' || result === 'closed' ? 'done' : result === 'unknownRule' ? 'error' : 'ignored';
    } else if (payload.kind === 'state') {
      status = (await ctx.publisher.send(payload.entityId, payload.state, payload.attributes)) ? 'sent' : 'error';
    } else {
      status = (await ctx.notifier.send(payload.title, payload.message)) ? 'sent' : 'error';
    }
    await ctx.log.markRetried(id, status);
    return { ok: status !== 'error', status };
  });

  // — settings —
  app.get('/api/settings', { config: { access: 'admin' } }, async () => publicSettings(await settings.get()));

  app.patch('/api/settings', async req => {
    const patch = parse(settingsPatchSchema, req.body);
    const next = await settings.update(patch);
    if (patch.ha) ctx.publisher.schedule();
    return publicSettings(next);
  });

  app.get('/api/settings/webhook-secret', { config: { access: 'admin' } }, async () => ({ secret: (await settings.get()).webhookSecret }));

  app.post('/api/settings/monitor-token/rotate', async () => {
    const s = await settings.update({ monitorToken: randomToken() });
    return { monitorUrl: new URL(`/monitor?t=${s.monitorToken}`, ctx.config.PUBLIC_URL).toString() };
  });
}
