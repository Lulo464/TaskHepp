import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import type { AppContext } from '../context.js';
import type { Queryable } from '../db.js';
import { HttpError } from '../lib/http.js';
import { roleForGroups, type Role } from './access.js';
import { createSession, deleteSession, deviceLabel, SESSION_COOKIE } from './sessions.js';

const LOGIN_COOKIE = 'tl_oidc';

interface LoginClaims {
  subject: string | null;
  email: string;
  name: string;
  groups: string[];
}

/** Creates or updates the user from the identity provider's claims and decides the role. */
export async function upsertUser(db: Queryable, claims: LoginClaims, bootstrapAdmin?: string): Promise<{ id: number; role: Role }> {
  const { rows: mapRows } = await db.query<{ oidc_group: string; role: Role }>('SELECT oidc_group, role FROM group_roles');
  const fromGroups = roleForGroups(claims.groups, new Map(mapRows.map(r => [r.oidc_group, r.role])));
  const isBootstrap = Boolean(bootstrapAdmin) && claims.email.toLowerCase() === bootstrapAdmin!.toLowerCase();

  const { rows: existing } = await db.query<{ id: number; role: Role; role_override: boolean }>(
    'SELECT id, role, role_override FROM users WHERE ($1::text IS NOT NULL AND subject = $1) OR lower(email) = lower($2) ORDER BY subject = $1 DESC NULLS LAST LIMIT 1',
    [claims.subject, claims.email],
  );
  const user = existing[0];
  const role: Role | null = isBootstrap ? 'admin' : user?.role_override ? user.role : fromGroups?.role ?? null;
  if (!role) throw new HttpError(403, 'Dein Konto gehört zu keiner Tasklog-Gruppe. Bitte einen Admin, dich freizuschalten.');

  if (user) {
    await db.query(
      'UPDATE users SET subject = COALESCE($2, subject), email = $3, name = $4, oidc_group = COALESCE($5, oidc_group), role = $6 WHERE id = $1',
      [user.id, claims.subject, claims.email, claims.name, fromGroups?.group ?? null, role],
    );
    return { id: user.id, role };
  }
  const { rows } = await db.query<{ id: number }>(
    'INSERT INTO users (subject, email, name, oidc_group, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [claims.subject, claims.email, claims.name, fromGroups?.group ?? null, role],
  );
  return { id: rows[0].id, role };
}

const safeReturnTo = (v: unknown) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : '/');

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const { config, db } = ctx;
  const secure = config.PUBLIC_URL.startsWith('https://');
  const redirectUri = new URL('/auth/callback', config.PUBLIC_URL).toString();

  let discovered: Promise<oidc.Configuration> | undefined;
  const oidcConfig = () => {
    discovered ??= oidc.discovery(
      new URL(config.OIDC_ISSUER!),
      config.OIDC_CLIENT_ID!,
      config.OIDC_CLIENT_SECRET || undefined,
      config.OIDC_CLIENT_SECRET ? undefined : oidc.None(),
      config.OIDC_ISSUER!.startsWith('http://') ? { execute: [oidc.allowInsecureRequests] } : undefined,
    ).catch(err => {
      discovered = undefined; // retry discovery on the next login
      throw err;
    });
    return discovered;
  };

  async function startSession(req: FastifyRequest, reply: FastifyReply, userId: number, returnTo: string) {
    const token = await createSession(db, userId, deviceLabel(req.headers['user-agent']), req.ip, config.SESSION_DAYS);
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: config.SESSION_DAYS * 86400 });
    return reply.redirect(returnTo);
  }

  app.get('/auth/login', async (req, reply) => {
    const returnTo = safeReturnTo((req.query as Record<string, unknown>).returnTo);

    if (config.AUTH_MODE === 'dev') {
      const { id } = await upsertUser(db, { subject: null, email: config.DEV_USER_EMAIL, name: config.DEV_USER_EMAIL.split('@')[0], groups: [] }, config.DEV_USER_EMAIL);
      return startSession(req, reply, id, returnTo);
    }

    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const url = oidc.buildAuthorizationUrl(await oidcConfig(), {
      redirect_uri: redirectUri,
      scope: config.OIDC_SCOPES,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
    });
    reply.setCookie(LOGIN_COOKIE, JSON.stringify({ verifier, state, returnTo }), { path: '/auth', httpOnly: true, sameSite: 'lax', secure, maxAge: 600, signed: true });
    return reply.redirect(url.toString());
  });

  app.get('/auth/callback', async (req, reply) => {
    const raw = req.cookies[LOGIN_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (!unsigned?.valid || !unsigned.value) throw new HttpError(400, 'Anmeldung abgelaufen – bitte erneut anmelden');
    const pending = JSON.parse(unsigned.value) as { verifier: string; state: string; returnTo: string };
    reply.clearCookie(LOGIN_COOKIE, { path: '/auth' });

    const cfg = await oidcConfig();
    const tokens = await oidc.authorizationCodeGrant(cfg, new URL(req.url, config.PUBLIC_URL), {
      pkceCodeVerifier: pending.verifier,
      expectedState: pending.state,
    });
    let claims: Record<string, unknown> = { ...tokens.claims() };
    if (!claims.email || claims[config.OIDC_GROUPS_CLAIM] === undefined) {
      claims = { ...claims, ...(await oidc.fetchUserInfo(cfg, tokens.access_token, String(claims.sub))) };
    }
    const rawGroups = claims[config.OIDC_GROUPS_CLAIM];
    const groups = (Array.isArray(rawGroups) ? rawGroups : typeof rawGroups === 'string' ? rawGroups.split(/[ ,]+/) : [])
      .map(g => String(g).replace(/^\//, '')); // Keycloak sends "/group"
    const email = String(claims.email ?? claims.preferred_username ?? '');
    if (!email) throw new HttpError(400, 'Der Identity Provider liefert keine E-Mail-Adresse');

    const { id } = await upsertUser(db, {
      subject: String(claims.sub),
      email,
      name: String(claims.name ?? claims.preferred_username ?? email.split('@')[0]),
      groups,
    }, config.BOOTSTRAP_ADMIN_EMAIL);
    return startSession(req, reply, id, safeReturnTo(pending.returnTo));
  });

  app.post('/api/logout', { config: { access: 'read' } }, async (req, reply) => {
    if (req.principal?.kind === 'user') await deleteSession(db, req.principal.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** For the login screen: how sign-in works here. */
  app.get('/api/auth/info', { config: { access: 'public' } }, async () => ({
    mode: config.AUTH_MODE,
    issuer: config.AUTH_MODE === 'oidc' ? config.OIDC_ISSUER ?? null : null,
  }));

  app.get('/api/me', async req => {
    const p = req.principal!;
    return p.kind === 'user'
      ? { kind: 'user', ...p.user, authMode: config.AUTH_MODE }
      : { kind: 'token', scope: p.scope, authMode: config.AUTH_MODE };
  });
}
