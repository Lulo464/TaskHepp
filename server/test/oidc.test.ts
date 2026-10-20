import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import Provider from 'oidc-provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { TEST_DB } from './helpers.js';

/** Full authorization-code + PKCE login against a real OIDC provider (dev interactions). */

const accounts: Record<string, { email: string; name: string; groups: string[] }> = {
  anna: { email: 'anna@example.com', name: 'Anna Beispiel', groups: ['tasklog-team'] },
  boss: { email: 'boss@example.com', name: 'Chefin', groups: ['/tasklog-admins', 'sonstwas'] },
  fremd: { email: 'fremd@example.com', name: 'Fremd', groups: ['andere-app'] },
};

let idp: Server;
let issuer: string;
let app: FastifyInstance;
let db: Db;

beforeAll(async () => {
  // Bind first to learn the port, then create the provider with the final issuer URL.
  let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
  idp = createServer((req, res) => handler(req, res));
  await new Promise<void>(r => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;

  const provider = new Provider(issuer, {
    clients: [{ client_id: 'tasklog', client_secret: 'geheim', redirect_uris: ['http://tasklog.test/auth/callback'], grant_types: ['authorization_code'], response_types: ['code'] }],
    claims: { openid: ['sub'], email: ['email'], profile: ['name'], groups: ['groups'] },
    scopes: ['openid', 'email', 'profile', 'groups'],
    features: { devInteractions: { enabled: true } },
    findAccount: (_ctx, id) => ({ accountId: id, claims: () => ({ sub: id, ...accounts[id] }) }),
    pkce: { required: () => true },
  });
  handler = provider.callback();

  const config = loadConfig({
    AUTH_MODE: 'oidc', DATABASE_URL: TEST_DB, PUBLIC_URL: 'http://tasklog.test', OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'tasklog', OIDC_CLIENT_SECRET: 'geheim', OIDC_SCOPES: 'openid email profile groups',
  });
  db = createPool(config.DATABASE_URL, config.TZ);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(db);
  app = await buildApp(createContext(config, db), { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.end();
  await new Promise<void>(r => idp.close(() => r()));
});

/** Drives the browser part: Tasklog → IdP login + consent → Tasklog callback. Returns the callback response. */
async function signIn(login: string) {
  const start = await app.inject({ method: 'GET', url: '/auth/login?returnTo=%2F%23rules' });
  expect(start.statusCode).toBe(302);
  const loginCookie = String(start.headers['set-cookie']).split(';')[0];

  const jar = new Map<string, string>();
  const remember = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      jar.set(k, v.join('='));
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const go = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, { ...init, redirect: 'manual', headers: { ...(init.headers as object), cookie: cookieHeader() } });
    remember(res);
    return res;
  };

  let res = await go(String(start.headers.location));
  for (let i = 0; i < 10 && res.status >= 300 && res.status < 400; i++) {
    const location = new URL(res.headers.get('location')!, issuer).toString();
    if (location.startsWith('http://tasklog.test/')) {
      const url = new URL(location);
      return app.inject({ method: 'GET', url: url.pathname + url.search, headers: { cookie: loginCookie } });
    }
    if (location.includes('/interaction/')) {
      const page = await (await go(location)).text();
      const isLogin = page.includes('name="login"');
      const form = new URLSearchParams(isLogin ? { prompt: 'login', login, password: 'x' } : { prompt: 'consent' });
      const action = page.match(/action="([^"]+)"/)![1];
      res = await go(new URL(action, issuer).toString(), { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    } else {
      res = await go(location);
    }
  }
  throw new Error('login flow did not reach the callback');
}

describe('OIDC login', () => {
  it('signs in a team member with the role from the group mapping', async () => {
    const res = await signIn('anna');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/#rules');
    const cookie = sessionCookie(res.headers['set-cookie']);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ email: 'anna@example.com', name: 'Anna Beispiel', role: 'member' });
  });

  it('maps Keycloak-style "/group" names and picks the highest role', async () => {
    const res = await signIn('boss');
    const cookie = sessionCookie(res.headers['set-cookie']);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json().role).toBe('admin');
  });

  it('refuses accounts without a Tasklog group', async () => {
    const res = await signIn('fremd');
    expect(res.statusCode).toBe(403);
  });

  it('rejects a callback without the login cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/callback?code=x&state=y' });
    expect(res.statusCode).toBe(400);
  });
});

function sessionCookie(header: string | string[] | undefined): string {
  const all = Array.isArray(header) ? header : header ? [header] : [];
  return all.map(c => c.split(';')[0]).find(c => c.startsWith('tl_session=')) ?? '';
}
