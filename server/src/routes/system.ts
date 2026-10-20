import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import { HttpError, parse } from '../lib/http.js';
import { safeEqual } from '../lib/crypto.js';
import type { Settings } from '../services/settings.js';
import { listRules } from './rules.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/** Tables in dependency order; sessions are deliberately not part of a backup. */
const BACKUP_TABLES = ['areas', 'projects', 'users', 'group_roles', 'rules', 'tickets', 'time_entries', 'published_entities', 'api_tokens', 'event_log', 'settings'] as const;

export async function exportAll(db: AppContext['db']) {
  const data: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) data[table] = (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  return { format: 'tasklog-backup', version: 1, exportedAt: new Date().toISOString(), data };
}

const SERIAL_TABLES = new Set<string>(['areas', 'projects', 'users', 'rules', 'tickets', 'time_entries', 'api_tokens', 'event_log']);

const backupSchema = z.object({
  format: z.literal('tasklog-backup'),
  version: z.literal(1),
  data: z.record(z.enum(BACKUP_TABLES), z.array(z.record(z.string(), z.unknown()))),
});

async function monitorData(ctx: AppContext, s: Settings) {
  const { db } = ctx;
  const { rows: timer } = await db.query(
    `SELECT t.title, a.name AS area, t.source, e.started_at AS "startedAt", u.name AS "user" FROM time_entries e
       JOIN tickets t ON t.id = e.ticket_id JOIN areas a ON a.id = t.area_id LEFT JOIN users u ON u.id = e.user_id
      WHERE e.ended_at IS NULL ORDER BY e.started_at DESC LIMIT 1`,
  );
  const { rows: [totals] } = await db.query<{ openTickets: number; todayMinutes: number }>(
    `SELECT (SELECT count(*)::int FROM tickets WHERE status <> 'done') AS "openTickets",
            (SELECT COALESCE(round(sum(extract(epoch FROM (COALESCE(ended_at, now()) - GREATEST(started_at, date_trunc('day', now()))))) / 60), 0)::int
               FROM time_entries WHERE COALESCE(ended_at, now()) > date_trunc('day', now())) AS "todayMinutes"`,
  );
  const { rows: today } = await db.query<{ id: number; title: string; prio: string; area: string; overdue: boolean }>(
    `SELECT t.id, t.title, t.prio, a.name AS area, t.due_date < current_date AS overdue
       FROM tickets t JOIN areas a ON a.id = t.area_id
      WHERE t.status <> 'done' AND t.due_date <= current_date
      ORDER BY t.due_date < current_date DESC, t.prio = 'high' DESC, t.id`,
  );

  // Sensor values for the entities the rules watch.
  let sensors: { entity: string; state: string; unit?: string; name?: unknown }[] = [];
  if (s.widgets.haSensors && (await ctx.ha.isConfigured())) {
    const entities = [...new Set((await listRules(db)).filter(r => r.enabled).map(r => r.entity))].slice(0, 8);
    sensors = (await Promise.all(entities.map(async entity => {
      try {
        const st = await ctx.ha.getState(entity);
        return { entity, state: st.state, unit: st.attributes.unit_of_measurement as string | undefined, name: st.attributes.friendly_name };
      } catch {
        return null;
      }
    }))).filter(x => x !== null);
  }

  return {
    now: new Date().toISOString(),
    interval: s.monitorInterval,
    widgets: s.widgets,
    ...totals,
    timer: s.widgets.timer ? timer[0] ?? null : null,
    next: s.widgets.next ? today.slice(0, 3) : [],
    later: s.widgets.later ? today.slice(3) : [],
    sensors,
  };
}

export function systemRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config, settings } = ctx;

  app.get('/api/health', { config: { access: 'public' } }, async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  app.get('/api/system', async () => {
    const s = await settings.get();
    const { rows: [pg] } = await db.query<{ v: string }>("SELECT current_setting('server_version') AS v");
    return {
      version,
      database: `PostgreSQL ${pg.v.split(' ')[0]}`,
      jobs: ctx.jobsActive?.() ?? 0,
      ha: { configured: Boolean(s.ha.url && s.ha.token) },
      auth: { mode: config.AUTH_MODE, issuer: config.OIDC_ISSUER ?? null, clientId: config.OIDC_CLIENT_ID ?? null },
      language: 'de',
      timezone: config.TZ,
      lastBackupAt: s.lastBackupAt,
      monitorUrl: new URL(`/monitor?t=${s.monitorToken}`, config.PUBLIC_URL).toString(),
    };
  });

  // — monitor —
  app.get('/api/monitor', async () => monitorData(ctx, await settings.get()));

  /** Read-only link for the wall display; the token is part of the URL. */
  app.get('/api/monitor/public', { config: { access: 'public' } }, async req => {
    const { t } = parse(z.object({ t: z.string().min(1) }), req.query);
    const s = await settings.get();
    if (!safeEqual(t, s.monitorToken)) throw new HttpError(403, 'Ungültiger Monitor-Link');
    return monitorData(ctx, s);
  });

  // — backup —
  app.get('/api/backup', { config: { access: 'admin' } }, async (_req, reply) => {
    const dump = await exportAll(db);
    await settings.update({ lastBackupAt: dump.exportedAt });
    reply.header('Content-Disposition', `attachment; filename="tasklog-backup-${dump.exportedAt.slice(0, 10)}.json"`);
    return dump;
  });

  /** Replaces all data with the backup. Sessions are cleared, so everyone signs in again. */
  app.put('/api/backup', { bodyLimit: 50 * 1024 * 1024 }, async req => {
    const backup = parse(backupSchema, req.body);
    await withTransaction(db, async c => {
      await c.query(`TRUNCATE ${[...BACKUP_TABLES, 'sessions'].join(', ')} RESTART IDENTITY CASCADE`);
      for (const table of BACKUP_TABLES) {
        for (const row of backup.data[table] ?? []) {
          const cols = Object.keys(row);
          if (!cols.every(col => /^[a-z_][a-z0-9_]*$/.test(col))) throw new HttpError(400, `Ungültige Spalte in ${table}`);
          await c.query(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
            cols.map(col => (row[col] !== null && typeof row[col] === 'object' ? JSON.stringify(row[col]) : row[col])),
          );
        }
        // Keep serial sequences ahead of the restored ids.
        if (SERIAL_TABLES.has(table)) {
          await c.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM ${table}), 1))`, [table]);
        }
      }
    });
    ctx.publisher.schedule();
    return { ok: true, tables: Object.fromEntries(BACKUP_TABLES.map(t => [t, backup.data[t]?.length ?? 0])) };
  });
}
