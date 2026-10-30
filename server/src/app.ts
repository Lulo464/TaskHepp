import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth/plugin.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { AppContext } from './context.js';
import { HttpError } from './lib/http.js';
import { adminRoutes } from './routes/admin.js';
import { areaRoutes } from './routes/areas.js';
import { calendarRoutes } from './routes/calendars.js';
import { feedRoutes } from './routes/feed.js';
import { presenceRoutes } from './routes/presence.js';
import { integrationRoutes } from './routes/integration.js';
import { mailRoutes } from './routes/mail.js';
import { reportRoutes } from './routes/reports.js';
import { ruleRoutes } from './routes/rules.js';
import { systemRoutes } from './routes/system.js';
import { ticketRoutes } from './routes/tickets.js';

export async function buildApp(ctx: AppContext, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: ctx.config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(fastifyCookie, { secret: ctx.config.COOKIE_SECRET });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Interner Fehler' });
  });

  registerAuth(app, ctx);
  registerAuthRoutes(app, ctx);
  ticketRoutes(app, ctx);
  areaRoutes(app, ctx);
  reportRoutes(app, ctx);
  ruleRoutes(app, ctx);
  integrationRoutes(app, ctx);
  calendarRoutes(app, ctx);
  feedRoutes(app, ctx);
  presenceRoutes(app, ctx);
  mailRoutes(app, ctx);
  adminRoutes(app, ctx);
  systemRoutes(app, ctx);

  // Serve the built web frontends: the app (PWA) at /, the admin UI at /admin, the wall display at /monitor.
  const dist = ctx.config.ADMIN_DIST && path.resolve(ctx.config.ADMIN_DIST);
  if (dist && existsSync(path.join(dist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: dist,
      wildcard: false,
      // The service worker and pages must not be cached, or updates never arrive; hashed assets may be.
      setHeaders: (res, file) => {
        if (/\.(html|webmanifest)$|sw\.js$/.test(file)) res.header('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });
    const hasAdmin = existsSync(path.join(dist, 'admin.html'));
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/auth/')) {
        return reply.code(404).send({ error: 'Nicht gefunden' });
      }
      const page = hasAdmin && /^\/(admin|monitor)(\/|\?|$)/.test(req.url) ? 'admin.html' : 'index.html';
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile(page);
    });
  }

  return app;
}
