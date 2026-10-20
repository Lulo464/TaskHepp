import type { EventLog } from './eventLog.js';
import type { HomeAssistant } from './homeAssistant.js';
import type { Settings, SettingsStore } from './settings.js';

export type NotificationKind = keyof Settings['notifications'];

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

/** Sends notifications over the configured channel. Only Home Assistant notify (notify.notify) is wired up so far. */
export class Notifier {
  constructor(private settings: SettingsStore, private ha: HomeAssistant, private log: EventLog, private timeZone: string) {}

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
