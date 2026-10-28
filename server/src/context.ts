import type { Config } from './config.js';
import type { Db } from './db.js';
import { EventLog } from './services/eventLog.js';
import { HomeAssistant } from './services/homeAssistant.js';
import { MailImporter } from './services/mailImport.js';
import { Notifier } from './services/notifier.js';
import { Publisher } from './services/publisher.js';
import { SettingsStore } from './services/settings.js';
import { WebhookProcessor } from './services/webhook.js';

/** Everything route handlers and jobs share. */
export interface AppContext {
  config: Config;
  db: Db;
  settings: SettingsStore;
  log: EventLog;
  ha: HomeAssistant;
  publisher: Publisher;
  notifier: Notifier;
  webhook: WebhookProcessor;
  mail: MailImporter;
  /** Number of scheduled background jobs, set once they start. */
  jobsActive?: () => number;
}

export function createContext(config: Config, db: Db, overrides: Partial<AppContext> = {}): AppContext {
  const settings = overrides.settings ?? new SettingsStore(db, config);
  const log = overrides.log ?? new EventLog(db);
  const ha = overrides.ha ?? new HomeAssistant(settings);
  const publisher = overrides.publisher ?? new Publisher(db, ha, log);
  const notifier = overrides.notifier ?? new Notifier(settings, ha, log, config.TZ);
  const webhook = overrides.webhook ?? new WebhookProcessor(db, log, notifier, publisher);
  const ctx = { config, db, settings, log, ha, publisher, notifier, webhook } as AppContext;
  ctx.mail = overrides.mail ?? new MailImporter(ctx);
  return ctx;
}
