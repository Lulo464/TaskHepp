import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { randomToken } from '../lib/crypto.js';
import { HttpError, notFound, parse } from '../lib/http.js';
import { icalCalendar } from '../lib/ical.js';

const feedQuery = z.object({
  mine: z.stringbool().optional(),
  area: z.coerce.number().int().positive().optional(),
});

/** Calendar subscription: each user's open tickets with a due date as an iCal feed behind a secret link. */
export function feedRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;

  const ownUser = (req: FastifyRequest) => {
    const uid = userId(req);
    if (uid === null) throw new HttpError(400, 'Nur für angemeldete Benutzer');
    return uid;
  };
  const feedUrl = (token: string) => new URL(`/api/calendar/${token}.ics`, config.PUBLIC_URL).toString();

  app.get('/api/me/calendar-feed', async req => {
    const uid = ownUser(req);
    const { rows: [u] } = await db.query<{ token: string }>(
      'UPDATE users SET calendar_token = COALESCE(calendar_token, $2) WHERE id = $1 RETURNING calendar_token AS token', [uid, randomToken()],
    );
    return { url: feedUrl(u.token) };
  });

  /** A new link; calendars that subscribed the old one stop getting updates. */
  app.post('/api/me/calendar-feed/rotate', { config: { access: 'read' } }, async req => {
    const { rows: [u] } = await db.query<{ token: string }>(
      'UPDATE users SET calendar_token = $2 WHERE id = $1 RETURNING calendar_token AS token', [ownUser(req), randomToken()],
    );
    return { url: feedUrl(u.token) };
  });

  app.get('/api/calendar/:file', { config: { access: 'public' } }, async (req, reply) => {
    const { file } = parse(z.object({ file: z.string().regex(/^[\w-]{16,100}\.ics$/) }), req.params);
    const query = parse(feedQuery, req.query);
    const { rows: [user] } = await db.query<{ id: number; name: string; hidden: number[] }>(
      'SELECT id, name, hidden_areas AS hidden FROM users WHERE calendar_token = $1', [file.slice(0, -4)],
    );
    if (!user) throw notFound('Unbekannter Kalender-Link');

    const { rows } = await db.query<{
      id: number; title: string; description: string; due: string; dueTime: string | null; area: string; project: string | null;
      assignee: string | null; updatedAt: Date;
    }>(
      `SELECT t.id, t.title, t.description, t.due_date AS due, to_char(t.due_time, 'HH24:MI') AS "dueTime", a.name AS area,
              p.name AS project, u.name AS assignee, t.updated_at AS "updatedAt"
         FROM tickets t JOIN areas a ON a.id = t.area_id LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.status <> 'done' AND t.due_date IS NOT NULL
          AND NOT (t.area_id = ANY($1::int[]))
          AND ($2::boolean IS NOT TRUE OR t.assignee_id = $3)
          AND ($4::int IS NULL OR t.area_id = $4)
        ORDER BY t.due_date, t.due_time NULLS FIRST, t.id`,
      [user.hidden, query.mine ?? false, user.id, query.area ?? null],
    );
    const areaName = query.area ? (await db.query<{ name: string }>('SELECT name FROM areas WHERE id = $1', [query.area])).rows[0]?.name : null;
    const host = new URL(config.PUBLIC_URL).host;
    const name = ['Tasklog', areaName, query.mine ? user.name : null].filter(Boolean).join(' – ');

    const body = icalCalendar(name, rows.map(t => ({
      uid: `ticket-${t.id}@${host}`,
      stamp: t.updatedAt,
      summary: t.title,
      description: [[t.area, t.project, t.assignee].filter(Boolean).join(' · '), t.description].filter(Boolean).join('\n\n'),
      url: new URL(`/#/ticket/${t.id}`, config.PUBLIC_URL).toString(),
      categories: t.area,
      date: t.due,
      time: t.dueTime,
      tz: config.TZ,
    })));
    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    reply.header('Content-Disposition', 'inline; filename="tasklog.ics"');
    reply.header('Cache-Control', 'no-cache');
    return body;
  });
}
