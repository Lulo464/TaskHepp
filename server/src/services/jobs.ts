import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { exportAll } from '../routes/system.js';
import { syncDueSources } from './calendars.js';

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

export const jobs: Record<string, Job> = {
  publishEntities: async ctx => {
    await ctx.publisher.publishAll();
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
    const { rows } = await ctx.db.query<{ id: number; title: string }>(
      `SELECT e.id, t.title FROM time_entries e JOIN tickets t ON t.id = e.ticket_id
        WHERE e.ended_at IS NULL AND e.started_at < now() - make_interval(hours => $1)`,
      [LONG_TIMER_HOURS],
    );
    for (const r of rows) {
      if (remindedEntries.has(r.id)) continue;
      remindedEntries.add(r.id);
      await ctx.notifier.notify(null, 'Timer läuft noch', `„${r.title}“ läuft seit über ${LONG_TIMER_HOURS} Stunden.`);
    }
  },

  dailyDigest: daily('07:00', async ctx => {
    const { rows } = await ctx.db.query<{ title: string }>(
      "SELECT title FROM tickets WHERE status <> 'done' AND due_date <= current_date ORDER BY prio = 'high' DESC, id LIMIT 10",
    );
    if (rows.length) await ctx.notifier.notify('dailyDigest', `Heute: ${rows.length} Ticket${rows.length === 1 ? '' : 's'}`, rows.map(r => `• ${r.title}`).join('\n'));
  }),

  /** Tickets with a time: one reminder an hour before. */
  dueSoon: async ctx => {
    const { rows } = await ctx.db.query<{ id: number; title: string; at: string }>(
      `SELECT id, title, to_char(due_time, 'HH24:MI') AS at FROM tickets
        WHERE status <> 'done' AND due_time IS NOT NULL AND due_notified_at IS NULL
          AND due_date + due_time > localtimestamp AND due_date + due_time <= localtimestamp + interval '60 minutes'
        ORDER BY due_date + due_time`,
    );
    for (const r of rows) {
      await ctx.db.query('UPDATE tickets SET due_notified_at = now() WHERE id = $1', [r.id]);
      await ctx.notifier.notify('dueSoon', `Um ${r.at} fällig`, r.title);
    }
  },

  /** Tickets without a time: in the morning. */
  dueToday: daily('09:00', async ctx => {
    const { rows } = await ctx.db.query<{ title: string }>(
      "SELECT title FROM tickets WHERE status <> 'done' AND due_date = current_date AND due_time IS NULL ORDER BY prio = 'high' DESC, id LIMIT 10",
    );
    if (rows.length) await ctx.notifier.notify('dueSoon', 'Heute fällig', rows.map(r => `• ${r.title}`).join('\n'));
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
  const interval = setInterval(() => void tick(), 60_000);
  void tick();
  ctx.jobsActive = () => Object.keys(jobs).length;
  return () => clearInterval(interval);
}
