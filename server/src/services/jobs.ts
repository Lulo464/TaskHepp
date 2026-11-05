import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { sweepUploads } from '../routes/attachments.js';
import { exportAll } from '../routes/system.js';
import { checkAutoClose } from './autoClose.js';
import { syncHaTodos } from './haTodo.js';
import { syncDueSources } from './calendars.js';
import { checkPresence } from './presence.js';
import { applyRetention } from './privacy.js';

const LONG_TIMER_HOURS = 4;

function localClock(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(p => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

type Job = (ctx: AppContext, now: Date) => Promise<void>;

/** Remembers per job which day it last ran, for "once a day at HH:MM" jobs. */
function daily(at: string, run: Job): Job {
  let lastRun = '';
  return async (ctx, now) => {
    const { date, time } = localClock(now, ctx.config.TZ);
    if (time < at || lastRun === date) return;
    if (lastRun === '' && time > at) { lastRun = date; return; } // started after the slot: wait for tomorrow
    lastRun = date;
    await run(ctx, now);
  };
}

const remindedEntries = new Set<number>();

/**
 * Morning lists, one per user with devices: their own and unassigned tickets in the areas they see. Returns false
 * while nobody set up devices, so the caller uses the global channel.
 */
export async function sendPersonalLists(ctx: AppContext, kind: 'dailyDigest' | 'dueToday', where: string, title: (n: number) => string): Promise<boolean> {
  if (!(await ctx.notifier.hasPersonal())) return false;
  for (const user of await ctx.notifier.recipients(kind)) {
    const { rows } = await ctx.db.query<{ title: string; overdue: boolean }>(
      `SELECT t.title, t.due_date < current_date AS overdue FROM tickets t JOIN users u ON u.id = $1
        WHERE t.status <> 'done' AND ${where} AND (t.assignee_id IS NULL OR t.assignee_id = $1) AND NOT (t.area_id = ANY(u.hidden_areas))
        ORDER BY t.due_date, t.due_time NULLS LAST, t.prio = 'high' DESC, t.id`,
      [user.id],
    );
    if (!rows.length) continue;
    const lines = rows.slice(0, 10).map(r => `• ${r.title}${r.overdue ? ' (überfällig)' : ''}`);
    if (rows.length > 10) lines.push(`… und ${rows.length - 10} weitere`);
    await ctx.notifier.sendTo([user], title(rows.length), lines.join('\n'), { tag: `tasklog-${kind}` });
  }
  return true;
}

export const jobs: Record<string, Job> = {
  publishEntities: async ctx => {
    await ctx.publisher.publishAll();
  },

  pollMail: async ctx => {
    await ctx.mail.pollDue();
  },

  /** Areas linked to a Home Assistant to-do list (Admin → Home Assistant). */
  syncHaTodos: async ctx => {
    await syncHaTodos(ctx);
  },

  syncCalendars: async ctx => {
    await syncDueSources(ctx);
  },

  autoStopAtMidnight: async ctx => {
    const s = await ctx.settings.get();
    if (!s.timeRules.autoStop) return;
    const { rowCount } = await ctx.db.query(
      "UPDATE time_entries SET ended_at = date_trunc('day', now()) WHERE ended_at IS NULL AND started_at < date_trunc('day', now())",
    );
    if (rowCount) {
      await ctx.log.add('out', `Auto-Stopp: ${rowCount} Timer um Mitternacht beendet`, 'done');
      ctx.publisher.schedule();
    }
  },

  longTimerReminder: async ctx => {
    const s = await ctx.settings.get();
    if (!s.timeRules.longTimer) return;
    const { rows } = await ctx.db.query<{ id: number; title: string; ticketId: number; userId: number | null }>(
      `SELECT e.id, t.title, t.id AS "ticketId", e.user_id AS "userId" FROM time_entries e JOIN tickets t ON t.id = e.ticket_id
        WHERE e.ended_at IS NULL AND e.started_at < now() - make_interval(hours => $1)`,
      [LONG_TIMER_HOURS],
    );
    for (const r of rows) {
      if (remindedEntries.has(r.id)) continue;
      remindedEntries.add(r.id);
      await ctx.notifier.deliver('longTimer', null, { userIds: r.userId ? [r.userId] : [] }, 'Timer läuft noch',
        `„${r.title}“ läuft seit über ${LONG_TIMER_HOURS} Stunden.`, { path: `/#/ticket/${r.ticketId}` });
    }
  },

  dailyDigest: daily('07:00', async ctx => {
    if (await sendPersonalLists(ctx, 'dailyDigest', 't.due_date <= current_date', n => `Heute: ${n} Ticket${n === 1 ? '' : 's'}`)) return;
    const { rows } = await ctx.db.query<{ title: string }>(
      "SELECT title FROM tickets WHERE status <> 'done' AND due_date <= current_date ORDER BY prio = 'high' DESC, id LIMIT 10",
    );
    if (rows.length) await ctx.notifier.notify('dailyDigest', `Heute: ${rows.length} Ticket${rows.length === 1 ? '' : 's'}`, rows.map(r => `• ${r.title}`).join('\n'));
  }),

  /** Tickets that close themselves when a Home Assistant entity changes to a state. */
  autoClose: async ctx => {
    await checkAutoClose(ctx);
  },

  /** "Wenn ich nach Hause komme": arrivals in a zone bring what is due there. */
  presence: async (ctx, now) => {
    await checkPresence(ctx, now);
  },

  /** Tickets with a time: one reminder an hour before. */
  dueSoon: async ctx => {
    const { rows } = await ctx.db.query<{ id: number; title: string; at: string; assigneeId: number | null; areaId: number }>(
      `SELECT id, title, to_char(due_time, 'HH24:MI') AS at, assignee_id AS "assigneeId", area_id AS "areaId" FROM tickets
        WHERE status <> 'done' AND due_time IS NOT NULL AND due_notified_at IS NULL
          AND due_date + due_time > localtimestamp AND due_date + due_time <= localtimestamp + interval '60 minutes'
        ORDER BY due_date + due_time`,
    );
    for (const r of rows) {
      await ctx.db.query('UPDATE tickets SET due_notified_at = now() WHERE id = $1', [r.id]);
      // Personally: the assignee, or everyone who sees the area when nobody is assigned.
      await ctx.notifier.deliver('dueSoon', 'dueSoon', r.assigneeId ? { userIds: [r.assigneeId] } : { areaId: r.areaId }, `Um ${r.at} fällig`, r.title, { path: `/#/ticket/${r.id}` });
    }
  },

  /** Tickets without a time: in the morning. */
  dueToday: daily('09:00', async ctx => {
    if (await sendPersonalLists(ctx, 'dueToday', 't.due_date = current_date AND t.due_time IS NULL', () => 'Heute fällig')) return;
    const { rows } = await ctx.db.query<{ title: string }>(
      "SELECT title FROM tickets WHERE status <> 'done' AND due_date = current_date AND due_time IS NULL ORDER BY prio = 'high' DESC, id LIMIT 10",
    );
    if (rows.length) await ctx.notifier.notify('dueSoon', 'Heute fällig', rows.map(r => `• ${r.title}`).join('\n'));
  }),

  /** Storage limits: expired sign-ins, old log entries, long-done tickets (Admin → Datenschutz). */
  retention: daily('03:15', async ctx => {
    const r = await applyRetention(ctx);
    if (r.log || r.tickets) await ctx.log.add('out', `Aufbewahrung: ${r.log} Protokolleinträge, ${r.tickets} erledigte Tickets gelöscht`, 'done');
  }),

  /** Files of deleted tickets' photos. */
  sweepUploads: daily('03:30', async ctx => {
    const removed = await sweepUploads(ctx);
    if (removed) await ctx.log.add('out', `Aufgeräumt: ${removed} Foto(s) gelöschter Tickets`, 'done');
  }),

  nightlyBackup: daily('03:00', async ctx => {
    if (!ctx.config.BACKUP_DIR) return;
    const dump = await exportAll(ctx.db);
    await mkdir(ctx.config.BACKUP_DIR, { recursive: true });
    await writeFile(path.join(ctx.config.BACKUP_DIR, `tasklog-backup-${dump.exportedAt.slice(0, 10)}.json`), JSON.stringify(dump));
    await ctx.settings.update({ lastBackupAt: dump.exportedAt });
  }),
};

/** Runs all jobs once a minute. Returns a stop function. */
export function startJobs(ctx: AppContext, onError: (job: string, err: unknown) => void): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    const now = new Date();
    for (const [name, job] of Object.entries(jobs)) {
      try {
        await job(ctx, now);
      } catch (err) {
        onError(name, err);
      }
    }
    busy = false;
  };
  // Changes in Tasklog reach linked to-do lists within seconds, not only on the next tick.
  ctx.publisher.onChange(() => syncHaTodos(ctx));
  const interval = setInterval(() => void tick(), 60_000);
  void tick();
  ctx.jobsActive = () => Object.keys(jobs).length;
  return () => clearInterval(interval);
}
