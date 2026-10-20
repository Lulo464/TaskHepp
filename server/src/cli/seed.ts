import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';
import { seedDemo } from '../seed.js';

const config = loadConfig({ AUTH_MODE: 'dev', ...process.env });
const db = createPool(config.DATABASE_URL, config.TZ);
await migrate(db, console.log);
console.log((await seedDemo(db)) ? 'demo data inserted' : 'database already has data – nothing inserted');
await db.end();
