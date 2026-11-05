import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { parse } from '../lib/http.js';

const query = z.object({
  groupBy: z.enum(['area', 'project', 'person']).default('area'),
  range: z.enum(['week', 'month']).default('week'),
  format: z.enum(['json', 'csv']).default('json'),
});

const GROUP_SQL = {
  area: 'a.name',
  project: "COALESCE(p.name, 'Ohne Projekt')",
  person: "COALESCE(u.name, 'Ohne Person')",
} as const;

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function reportRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  /** Tracked minutes in the current week (from Monday) or month, clipped to the range. */
  app.get('/api/reports/time', async (req, reply) => {
    const q = parse(query, req.query);
    const exact = (await ctx.settings.get()).rounding === 0;
    const { rows: raw } = await db.query<{ name: string; seconds: number }>(
      `WITH bounds AS (SELECT date_trunc($1, now()) AS start)
       SELECT ${GROUP_SQL[q.groupBy]} AS name,
              round(sum(extract(epoch FROM (COALESCE(e.ended_at, now()) - GREATEST(e.started_at, b.start)))))::int AS seconds
         FROM time_entries e
         CROSS JOIN bounds b
         JOIN tickets t ON t.id = e.ticket_id
         JOIN areas a ON a.id = t.area_id
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = e.user_id
        WHERE COALESCE(e.ended_at, now()) > b.start
        GROUP BY 1 HAVING sum(extract(epoch FROM (COALESCE(e.ended_at, now()) - GREATEST(e.started_at, b.start)))) > 0
        ORDER BY 2 DESC, 1`,
      [q.range],
    );
    const rows = raw.map(r => ({ ...r, minutes: Math.round(r.seconds / 60) }));
    const totalSeconds = rows.reduce((sum, r) => sum + r.seconds, 0);
    const total = Math.round(totalSeconds / 60);

    if (q.format === 'csv') {
      const head = { area: 'Bereich', project: 'Projekt', person: 'Person' }[q.groupBy];
      const hms = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      // To the second: also the exact duration, and hours from seconds.
      const lines = exact
        ? [`${head};Dauer;Sekunden;Stunden`, ...rows.map(r => `${csvCell(r.name)};${hms(r.seconds)};${r.seconds};${(r.seconds / 3600).toFixed(4).replace('.', ',')}`)]
        : [`${head};Minuten;Stunden`, ...rows.map(r => `${csvCell(r.name)};${r.minutes};${(r.minutes / 60).toFixed(2).replace('.', ',')}`)];
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="zeitbericht-${q.range}-${q.groupBy}.csv"`);
      return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8
    }
    return { rows, total, totalSeconds, exactTime: exact };
  });

  app.get('/api/overview', async () => {
    const { rows: [stats] } = await db.query(
      `SELECT (SELECT count(*)::int FROM tickets WHERE status <> 'done') AS "openTickets",
              (SELECT count(*)::int FROM tickets WHERE status <> 'done' AND due_date <= current_date) AS "dueToday",
              (SELECT count(*)::int FROM tickets WHERE source = 'ha' AND created_at > now() - interval '30 days') AS "fromHa30d",
              (SELECT count(*)::int FROM rules WHERE enabled) AS "activeRules",
              (SELECT count(*)::int FROM rules) AS "totalRules"`,
    );
    const { rows: [lastIn] } = await db.query(
      "SELECT at, status FROM event_log WHERE direction = 'in' ORDER BY at DESC LIMIT 1",
    );
    return { ...stats, webhook: lastIn ? { lastAt: lastIn.at, ok: lastIn.status !== 'rejected' && lastIn.status !== 'error' } : null };
  });
}
