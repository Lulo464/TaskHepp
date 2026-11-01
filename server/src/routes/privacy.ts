import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { HttpError, idParam, parse } from '../lib/http.js';
import { deleteUser, exportUser, privacyTemplate } from '../services/privacy.js';

/** Imprint and privacy notice, plus each person's own data: download and delete. */
export function privacyRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, settings } = ctx;
  const own = (req: FastifyRequest) => {
    const uid = userId(req);
    if (uid === null) throw new HttpError(400, 'Nur für angemeldete Benutzer');
    return uid;
  };

  /** Public: the sign-in page links to them. */
  app.get('/api/legal', { config: { access: 'public' } }, async () => (await settings.get()).legal);

  app.get('/api/legal/template', { config: { access: 'admin' } }, async () => privacyTemplate(ctx));

  app.get('/api/me/export', async (req, reply) => {
    const data = await exportUser(db, own(req));
    reply.header('Content-Disposition', `attachment; filename="tasklog-meine-daten-${data.exportedAt.slice(0, 10)}.json"`);
    reply.header('Cache-Control', 'no-store');
    return data;
  });

  app.delete('/api/me', { config: { access: 'read' } }, async (req, reply) => {
    await deleteUser(db, own(req));
    await ctx.log.add('in', 'Ein Benutzer hat sein Konto gelöscht', 'done');
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.delete('/api/users/:id', { config: { access: 'admin' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await deleteUser(db, id);
    await ctx.log.add('in', `Benutzer #${id} gelöscht`, 'done');
    return reply.code(204).send();
  });
}
