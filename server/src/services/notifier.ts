import type { Db } from '../db.js';
import type { EventLog } from './eventLog.js';
import type { HomeAssistant } from './homeAssistant.js';
import type { Settings, SettingsStore } from './settings.js';

export type NotificationKind = keyof Settings['notifications'];

/** What each user can switch on or off for themselves. */
export const PERSONAL_KINDS = ['dueSoon', 'dueToday', 'dailyDigest', 'assigned', 'haCreated', 'longTimer'] as const;
export type PersonalKind = (typeof PERSONAL_KINDS)[number];

export interface Recipient {
  id: number;
  name: string;
  targets: string[];
}

export interface Who {
  /** Only these users; omitted = everyone who wants this kind. */
  userIds?: number[];
  /** Leaves out users who hid the ticket's area in the app. */
  areaId?: number | null;
}

/** Minutes since midnight in the server time zone. */
function minutesNow(now: Date, timeZone: string): number {
  const [h, m] = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(now).split(':').map(Number);
  return h * 60 + m;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function inQuietHours(now: Date, from: string, to: string, timeZone: string): boolean {
  const t = minutesNow(now, timeZone);
  const a = toMinutes(from);
  const b = toMinutes(to);
  return a <= b ? t >= a && t < b : t >= a || t < b; // window may wrap midnight
}

/**
 * Sends notifications through Home Assistant. Users who chose their own devices get theirs personally (`personal`);
 * as long as nobody did, everything goes to the global channel (notify.notify) as before.
 */
export class Notifier {
  constructor(
    private settings: SettingsStore, private ha: HomeAssistant, private log: EventLog, private timeZone: string,
    private db?: Db, private publicUrl = '',
  ) {}

  /** Whether anyone set up their own devices; then personal delivery replaces the global channel. */
  async hasPersonal(): Promise<boolean> {
    if (!this.db) return false;
    return Boolean((await this.db.query("SELECT 1 FROM users WHERE notify_targets <> '{}' LIMIT 1")).rowCount);
  }

  /** Users with devices who want this kind (a kind missing from their choices is on). */
  async recipients(kind: PersonalKind, who: Who = {}): Promise<Recipient[]> {
    if (!this.db) return [];
    const { rows } = await this.db.query<Recipient>(
      `SELECT id, name, notify_targets AS targets FROM users
        WHERE notify_targets <> '{}' AND COALESCE((notify_kinds ->> $1)::boolean, true)
          AND ($2::int[] IS NULL OR id = ANY($2::int[]))
          AND ($3::int IS NULL OR NOT ($3 = ANY(hidden_areas)))
        ORDER BY id`,
      [kind, who.userIds ?? null, who.areaId ?? null],
    );
    return rows;
  }

  /** Sends to each recipient's devices; `path` opens that page of the app when the message is tapped. */
  async sendTo(users: Recipient[], title: string, message: string, opts: { path?: string; tag?: string; now?: Date; ignoreQuietHours?: boolean } = {}): Promise<number> {
    if (!users.length) return 0;
    const s = await this.settings.get();
    if (!opts.ignoreQuietHours && inQuietHours(opts.now ?? new Date(), s.quietFrom, s.quietTo, this.timeZone)) return 0;
    const url = this.publicUrl ? new URL(opts.path ?? '/', this.publicUrl).toString() : undefined;
    let sent = 0;
    for (const u of users) {
      for (const target of u.targets) {
        try {
          await this.ha.callService('notify', target, { title, message, data: { ...(url ? { url, clickAction: url } : {}), ...(opts.tag ? { tag: opts.tag } : {}) } });
          sent++;
        } catch (err) {
          await this.log.add('out', `Benachrichtigung an ${u.name} (notify.${target}): ${(err as Error).message}`, 'error');
        }
      }
    }
    if (sent) await this.log.add('out', `Benachrichtigung „${title}“ an ${users.map(u => u.name).join(', ')}`, 'sent', { kind: 'notify', title, message });
    return sent;
  }

  /** Personal when anyone set up devices, otherwise the global channel. */
  async deliver(kind: PersonalKind, global: NotificationKind | null, who: Who, title: string, message: string, opts: { path?: string; tag?: string; now?: Date } = {}) {
    if (await this.hasPersonal()) {
      await this.sendTo(await this.recipients(kind, who), title, message, opts);
      return;
    }
    await this.notify(global, title, message, opts.now);
  }

  /** `kind` null = not tied to a notification toggle (e.g. the long-timer reminder, which has its own). */
  async notify(kind: NotificationKind | null, title: string, message: string, now = new Date()): Promise<void> {
    const s = await this.settings.get();
    if (kind && !s.notifications[kind]) return;
    if (inQuietHours(now, s.quietFrom, s.quietTo, this.timeZone)) return;
    // Push and e-mail need a delivery service that doesn't exist yet; the admin UI says so next to the channel.
    if (s.channel !== 'haNotify') return;
    await this.send(title, message);
  }

  async send(title: string, message: string): Promise<boolean> {
    try {
      await this.ha.callService('notify', 'notify', { title, message });
      await this.log.add('out', `Benachrichtigung „${title}“`, 'sent', { kind: 'notify', title, message });
      return true;
    } catch (err) {
      await this.log.add('out', `Benachrichtigung „${title}“: ${(err as Error).message}`, 'error', { kind: 'notify', title, message });
      return false;
    }
  }
}
