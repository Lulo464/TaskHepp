import { z } from 'zod';
import type { Queryable } from '../db.js';
import { randomToken } from '../lib/crypto.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const settingsSchema = z.object({
  notifications: z.object({ dueSoon: z.boolean(), haCreated: z.boolean(), weeklyReport: z.boolean(), dailyDigest: z.boolean() }),
  channel: z.enum(['push', 'haNotify', 'email']),
  quietFrom: hhmm,
  quietTo: hhmm,
  widgets: z.object({ clock: z.boolean(), timer: z.boolean(), next: z.boolean(), later: z.boolean(), haSensors: z.boolean() }),
  monitorInterval: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  monitorToken: z.string(),
  timeRules: z.object({ autoStop: z.boolean(), longTimer: z.boolean(), singleTimer: z.boolean() }),
  rounding: z.union([z.literal(0), z.literal(5), z.literal(15)]),
  enforceSignature: z.boolean(),
  webhookId: z.string(),
  webhookSecret: z.string(),
  ha: z.object({ url: z.string(), token: z.string() }),
  lastBackupAt: z.string().nullable(),
  /** Imprint and privacy notice, shown on the sign-in page and in the app; empty = no link. */
  legal: z.object({ imprint: z.string().max(20_000), privacy: z.string().max(60_000) }),
  /** Days to keep the log and done tickets; 0 = keep. */
  retention: z.object({ logDays: z.number().int().min(0).max(3650), doneTicketsDays: z.number().int().min(0).max(3650) }),
});

export type Settings = z.infer<typeof settingsSchema>;

/** What an admin may change through the API. Secrets and generated ids are rotated via their own endpoints. */
export const settingsPatchSchema = z.object({
  notifications: settingsSchema.shape.notifications.partial(),
  channel: settingsSchema.shape.channel,
  quietFrom: hhmm,
  quietTo: hhmm,
  widgets: settingsSchema.shape.widgets.partial(),
  monitorInterval: settingsSchema.shape.monitorInterval,
  timeRules: settingsSchema.shape.timeRules.partial(),
  rounding: settingsSchema.shape.rounding,
  enforceSignature: z.boolean(),
  ha: z.object({ url: z.string().url().or(z.literal('')), token: z.string() }).partial(),
  legal: settingsSchema.shape.legal.partial(),
  retention: settingsSchema.shape.retention.partial(),
}).partial().strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

function defaults(env: { HA_URL?: string; HA_TOKEN?: string }): Settings {
  return {
    notifications: { dueSoon: true, haCreated: true, weeklyReport: false, dailyDigest: true },
    channel: 'push',
    quietFrom: '22:00',
    quietTo: '07:00',
    widgets: { clock: true, timer: true, next: true, later: false, haSensors: true },
    monitorInterval: 30,
    monitorToken: randomToken(),
    timeRules: { autoStop: true, longTimer: false, singleTimer: true },
    rounding: 15,
    // Off by default: Home Assistant's rest_command cannot sign requests, so the generated config would be rejected.
    enforceSignature: false,
    webhookId: randomToken(9),
    webhookSecret: randomToken(32),
    ha: { url: env.HA_URL ?? '', token: env.HA_TOKEN ?? '' },
    lastBackupAt: null,
    legal: { imprint: '', privacy: '' },
    retention: { logDays: 90, doneTicketsDays: 0 },
  };
}

const KEY = 'app';

export class SettingsStore {
  constructor(private db: Queryable, private env: { HA_URL?: string; HA_TOKEN?: string }) {}

  /** Stored values over defaults. Generated secrets are persisted on first read so they stay stable. */
  async get(): Promise<Settings> {
    const { rows } = await this.db.query<{ value: Partial<Settings> }>('SELECT value FROM settings WHERE key = $1', [KEY]);
    const base = defaults(this.env);
    if (!rows[0]) {
      await this.save(base);
      return base;
    }
    const stored = rows[0].value;
    const merged: Settings = {
      ...base,
      ...stored,
      notifications: { ...base.notifications, ...stored.notifications },
      widgets: { ...base.widgets, ...stored.widgets },
      timeRules: { ...base.timeRules, ...stored.timeRules },
      legal: { ...base.legal, ...stored.legal },
      retention: { ...base.retention, ...stored.retention },
      ha: {
        url: stored.ha?.url || base.ha.url,
        token: stored.ha?.token || base.ha.token,
      },
    };
    return merged;
  }

  async update(patch: SettingsPatch | Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const next: Settings = {
      ...current,
      ...patch,
      notifications: { ...current.notifications, ...patch.notifications },
      widgets: { ...current.widgets, ...patch.widgets },
      timeRules: { ...current.timeRules, ...patch.timeRules },
      ha: { ...current.ha, ...patch.ha },
      legal: { ...current.legal, ...patch.legal },
      retention: { ...current.retention, ...patch.retention },
    };
    await this.save(next);
    return next;
  }

  private async save(value: Settings) {
    await this.db.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [KEY, JSON.stringify(value)],
    );
  }
}
