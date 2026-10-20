import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const LOCK_ID = 727274;

/** Applies every `migrations/*.sql` not yet recorded, in file-name order, each in its own transaction. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  // One connection throughout: the advisory lock belongs to the session that took it.
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]); // serialise replicas booting at once
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map(r => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
      log(`migration applied: ${file}`);
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
