import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createSession } from '../src/auth/sessions.js';
import { loadConfig } from '../src/config.js';
import { createContext, type AppContext } from '../src/context.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seedDemo } from '../src/seed.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://tasklog@127.0.0.1:5433/tasklog_test';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  db: Db;
  /** Cookie header for a fresh session of a user with the given role. */
  login: (role: 'admin' | 'member' | 'read') => Promise<string>;
  close: () => Promise<void>;
}

/** Fresh schema + demo data for each test file. */
export async function setup(): Promise<TestApp> {
  const config = loadConfig({
    AUTH_MODE: 'dev', DATABASE_URL: TEST_DB, PUBLIC_URL: 'http://tasklog.test', TZ: 'Europe/Berlin',
    UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'tasklog-uploads-')),
  });
  const db = createPool(config.DATABASE_URL, config.TZ);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(db);
  await seedDemo(db);
  const ctx = createContext(config, db);
  const app = await buildApp(ctx, { logger: false });
  await app.ready();

  let n = 0;
  const login = async (role: 'admin' | 'member' | 'read') => {
    n += 1;
    const { rows } = await db.query<{ id: number }>('INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING id', [`T ${role} ${n}`, `t${n}-${role}@example.com`, role]);
    return `tl_session=${await createSession(db, rows[0].id, 'test', undefined, 1)}`;
  };

  return {
    app, ctx, db, login,
    close: async () => {
      ctx.publisher.stop();
      await app.close();
      await db.end();
    },
  };
}

export interface FakeHa {
  url: string;
  states: Map<string, { state: string; attributes: Record<string, unknown> }>;
  /** Calendar entity → events (HA format, e.g. { summary, start: { date } }). */
  calendars: Map<string, { summary: string; start: { date?: string; dateTime?: string } }[]>;
  calls: { method: string; path: string; body: unknown; auth?: string }[];
  fail: boolean;
  close: () => Promise<void>;
}

/** Minimal Home Assistant REST API: config, states, notify. */
export async function fakeHomeAssistant(token = 'ha-token'): Promise<FakeHa> {
  const fake: Omit<FakeHa, 'url' | 'close'> = { states: new Map(), calendars: new Map(), calls: [], fail: false };
  const readBody = (req: IncomingMessage) => new Promise<string>(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b)); });
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const path = req.url ?? '';
    fake.calls.push({ method: req.method ?? '', path, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
    const send = (code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: 'unauthorized' });
    if (fake.fail) return send(500, { message: 'boom' });
    if (path === '/api/config') return send(200, { version: '2026.10.1' });
    const m = path.match(/^\/api\/states\/(.+)$/);
    if (path === '/api/states') return send(200, [...fake.states].map(([entity_id, st]) => ({ entity_id, ...st })));
    if (path === '/api/services') return send(200, [{ domain: 'notify', services: { notify: {}, mobile_app_pixel: {} } }, { domain: 'light', services: { turn_on: {} } }]);
    if (path.startsWith('/api/services/notify/')) return send(200, []);
    if (m && req.method === 'POST') { fake.states.set(decodeURIComponent(m[1]), JSON.parse(body)); return send(200, {}); }
    if (m) return fake.states.has(decodeURIComponent(m[1])) ? send(200, fake.states.get(decodeURIComponent(m[1]))) : send(404, {});
    if (path === '/api/calendars') return send(200, [...fake.calendars.keys()].map(id => ({ entity_id: id, name: id.split('.')[1] })));
    // Returns every event, ignoring ?start/&end, so Tasklog's own range filter is exercised.
    const cal = path.match(/^\/api\/calendars\/([^?]+)\?/);
    if (cal) {
      const events = fake.calendars.get(decodeURIComponent(cal[1]));
      return events ? send(200, events) : send(404, { message: 'not found' });
    }
    return send(404, {});
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => server.close(() => r())) });
}
