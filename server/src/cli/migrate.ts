import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';

const config = loadConfig({ AUTH_MODE: 'dev', ...process.env });
const db = createPool(config.DATABASE_URL, config.TZ);
const applied = await migrate(db, console.log);
console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
await db.end();
