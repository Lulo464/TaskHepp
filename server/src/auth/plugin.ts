import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { HttpError } from '../lib/http.js';
import { allows, type Access, type Principal } from './access.js';
import { findApiToken, findSession, SESSION_COOKIE } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
  interface FastifyContextConfig {
    access?: Access;
  }
}

async function authenticate(ctx: AppContext, req: FastifyRequest): Promise<Principal | null> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = await findApiToken(ctx.db, header.slice(7).trim());
    return token ? { kind: 'token', tokenId: token.id, scope: token.scope } : null;
  }
  const cookie = req.cookies[SESSION_COOKIE];
  if (cookie) {
    const session = await findSession(ctx.db, cookie);
    if (session) {
      const { sessionId, ...user } = session;
      return { kind: 'user', sessionId, user };
    }
  }
  return null;
}

/**
 * Every /api route is protected. A route opts out with `config: { access: 'public' }` or
 * asks for more with `access: 'member' | 'admin'`. Default: GET needs `read`, everything else `admin`.
 */
export function registerAuth(app: FastifyInstance, ctx: AppContext) {
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async req => {
    if (!req.url.startsWith('/api/')) return;
    const access = req.routeOptions.config?.access ?? (req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'admin');
    if (access === 'public') return;
    const principal = await authenticate(ctx, req);
    if (!principal) throw new HttpError(401, 'Nicht angemeldet');
    if (!allows(principal, access)) throw new HttpError(403, 'Keine Berechtigung');
    req.principal = principal;
  });
}

/** The signed-in user's id, or null for API tokens. */
export function userId(req: FastifyRequest): number | null {
  return req.principal?.kind === 'user' ? req.principal.user.id : null;
}
