import type { AppContext } from '../context.js';
import { inQuietHours } from './notifier.js';

export interface PresenceRule {
  id: number;
  userId: number;
  personEntity: string;
  zone: string;
  areaId: number | null;
  notifyService: string;
  includeUndated: boolean;
  enabled: boolean;
  lastState: string | null;
  lastNotifiedAt: string | null;
}

export const PRESENCE_SELECT = `SELECT id, user_id AS "userId", person_entity AS "personEntity", zone, area_id AS "areaId",
  notify_service AS "notifyService", include_undated AS "includeUndated", enabled, last_state AS "lastState",
  last_notified_at AS "lastNotifiedAt" FROM presence_rules`;

/** GPS jumps in and out of a zone at its edge; one message per arrival is enough. */
const COOLDOWN_MINUTES = 30;
const MAX_LINES = 8;

/** Open tickets for the rule's user: due today or earlier (optionally undated), not assigned to someone else. */
async function dueFor(ctx: AppContext, rule: PresenceRule) {
  const { rows } = await ctx.db.query<{ title: string; overdue: boolean; dueTime: string | null }>(
    `SELECT t.title, t.due_date < current_date AS overdue, to_char(t.due_time, 'HH24:MI') AS "dueTime"
       FROM tickets t JOIN users u ON u.id = $1
      WHERE t.status <> 'done'
        AND ($2::int IS NULL AND NOT (t.area_id = ANY(u.hidden_areas)) OR t.area_id = $2)
        AND (t.assignee_id IS NULL OR t.assignee_id = $1)
        AND (t.due_date <= current_date OR ($3 AND t.due_date IS NULL))
      ORDER BY t.due_date NULLS LAST, t.due_time NULLS LAST, t.prio = 'high' DESC, t.id`,
    [rule.userId, rule.areaId, rule.includeUndated],
  );
  return rows;
}

/** Sends the "you arrived, this is due" message. Returns how many tickets it listed; null when it could not send. */
export async function sendArrival(ctx: AppContext, rule: PresenceRule, opts: { test?: boolean } = {}): Promise<number | null> {
  const due = await dueFor(ctx, rule);
  if (!due.length && !opts.test) return 0;
  const where = rule.zone === 'home' ? 'zuhause' : `in ${rule.zone}`;
  const title = due.length
    ? `Willkommen ${where} – ${due.length === 1 ? '1 Sache steht' : `${due.length} Sachen stehen`} an`
    : `Willkommen ${where} – nichts offen`;
  const lines = due.slice(0, MAX_LINES).map(t => `• ${t.title}${t.overdue ? ' (überfällig)' : t.dueTime ? ` (${t.dueTime})` : ''}`);
  if (due.length > MAX_LINES) lines.push(`… und ${due.length - MAX_LINES} weitere`);
  const url = new URL('/', ctx.config.PUBLIC_URL).toString();
  try {
    // url (iPhone) and clickAction (Android) open the app when the message is tapped; the tag replaces an older one.
    await ctx.ha.callService('notify', rule.notifyService, {
      title, message: lines.join('\n') || 'Für hier steht gerade nichts an.', data: { url, clickAction: url, tag: `tasklog-presence-${rule.id}` },
    });
    await ctx.log.add('out', `Anwesenheit: ${rule.personEntity} ${where}, ${due.length} Ticket(s) an notify.${rule.notifyService}`, 'sent');
    return due.length;
  } catch (err) {
    await ctx.log.add('out', `Anwesenheit: notify.${rule.notifyService} – ${(err as Error).message}`, 'error');
    return null;
  }
}

/** Job: notices arrivals in a rule's zone by comparing the person's state with the last one seen. */
export async function checkPresence(ctx: AppContext, now = new Date()) {
  const { rows: rules } = await ctx.db.query<PresenceRule>(`${PRESENCE_SELECT} WHERE enabled ORDER BY id`);
  if (!rules.length || !(await ctx.ha.isConfigured())) return;
  const s = await ctx.settings.get();
  const quiet = inQuietHours(now, s.quietFrom, s.quietTo, ctx.config.TZ);
  const states = new Map<string, string | null>();

  for (const rule of rules) {
    if (!states.has(rule.personEntity)) {
      states.set(rule.personEntity, await ctx.ha.getState(rule.personEntity).then(st => st.state, () => null));
    }
    const state = states.get(rule.personEntity);
    if (state == null || state === 'unavailable' || state === 'unknown') continue; // keep the last known state
    const arrived = rule.lastState !== null && rule.lastState !== state && state === rule.zone;
    const cooled = !rule.lastNotifiedAt || now.getTime() - new Date(rule.lastNotifiedAt).getTime() > COOLDOWN_MINUTES * 60_000;
    let notified = false;
    if (arrived && cooled && !quiet) notified = (await sendArrival(ctx, rule)) !== null;
    await ctx.db.query(
      `UPDATE presence_rules SET last_state = $2, last_notified_at = CASE WHEN $3 THEN $4 ELSE last_notified_at END WHERE id = $1`,
      [rule.id, state, notified, now],
    );
  }
}
