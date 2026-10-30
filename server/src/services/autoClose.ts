import type { AppContext } from '../context.js';
import type { AutoClose } from './tickets.js';
import { setStatus } from './tickets.js';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Job: tickets with "erledigt, wenn …" close when their entity changes to the state. Only the change counts — a
 * washing machine that is already idle when "Wäsche aufhängen" is created closes it after its next run, not at once.
 */
export async function checkAutoClose(ctx: AppContext): Promise<number> {
  const { rows } = await ctx.db.query<{ id: number; title: string; rule: AutoClose; seen: string | null }>(
    "SELECT id, title, auto_close AS rule, auto_close_seen AS seen FROM tickets WHERE status <> 'done' AND auto_close IS NOT NULL ORDER BY id",
  );
  if (!rows.length || !(await ctx.ha.isConfigured())) return 0;
  const states = new Map<string, string | null>();
  let closed = 0;
  for (const t of rows) {
    if (!states.has(t.rule.entity)) states.set(t.rule.entity, await ctx.ha.getState(t.rule.entity).then(s => s.state, () => null));
    const state = states.get(t.rule.entity);
    if (state == null || state === 'unavailable' || state === 'unknown') continue;
    if (t.seen !== null && norm(t.seen) !== norm(t.rule.state) && norm(state) === norm(t.rule.state)) {
      await setStatus(ctx.db, [t.id], 'done');
      await ctx.log.add('in', `„${t.title}“ erledigt: ${t.rule.entity} ist jetzt ${state}`, 'done');
      closed++;
    } else if (t.seen !== state) {
      await ctx.db.query('UPDATE tickets SET auto_close_seen = $2 WHERE id = $1', [t.id, state]);
    }
  }
  if (closed) ctx.publisher.schedule();
  return closed;
}
