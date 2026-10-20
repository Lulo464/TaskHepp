import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { seedDemo } from './seed.js';
import { startJobs } from './services/jobs.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL, config.TZ);
const ctx = createContext(config, db);
const app = await buildApp(ctx);

await migrate(db, msg => app.log.info(msg));
if (config.SEED_DEMO && (await seedDemo(db))) app.log.info('demo data inserted');
if (config.AUTH_MODE === 'dev') app.log.warn('AUTH_MODE=dev: every visitor is signed in as admin – never expose this instance');

const stopJobs = startJobs(ctx, (job, err) => app.log.error({ err, job }, 'background job failed'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopJobs();
    ctx.publisher.stop();
    await app.close();
    await db.end();
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
