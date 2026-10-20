import type { Queryable } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import type { Role, TokenScope } from './access.js';

export const SESSION_COOKIE = 'tl_session';

export interface SessionUser {
  sessionId: string;
  id: number;
  name: string;
  email: string;
  role: Role;
}

/** Creates a session and returns the cookie value; only its hash is stored. */
export async function createSession(db: Queryable, userId: number, device: string, ip: string | undefined, days: number): Promise<string> {
  const token = randomToken(32);
  await db.query(
    `INSERT INTO sessions (id, user_id, device, ip, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [sha256(token), userId, device, ip ?? null, days],
  );
  await db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
  return token;
}

export async function findSession(db: Queryable, token: string): Promise<SessionUser | null> {
  const id = sha256(token);
  const { rows } = await db.query<SessionUser & { stale: boolean }>(
    `SELECT s.id AS "sessionId", u.id, u.name, u.email, u.role, s.last_seen_at < now() - interval '5 minutes' AS stale
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.stale) {
    await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]);
    await db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [row.id]);
  }
  const { stale: _stale, ...user } = row;
  return user;
}

export async function deleteSession(db: Queryable, sessionId: string) {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function findApiToken(db: Queryable, token: string): Promise<{ id: number; scope: TokenScope } | null> {
  const { rows } = await db.query<{ id: number; scope: TokenScope }>(
    'UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING id, scope',
    [sha256(token)],
  );
  return rows[0] ?? null;
}

/** Short device label from a user agent, e.g. "Chrome · Admin UI". */
export function deviceLabel(userAgent: string | undefined, client = 'Admin UI'): string {
  const ua = userAgent ?? '';
  const browser =
    /Tasklog/i.test(ua) ? 'Tasklog App'
      : /Edg\//.test(ua) ? 'Edge'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari'
              : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser === 'Tasklog App' ? os || browser : browser, browser === 'Tasklog App' ? 'Tasklog App' : client].filter(Boolean).join(' · ');
}
