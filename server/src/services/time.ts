import type { Queryable } from '../db.js';

/** Rounds a running entry up to the next multiple of `rounding` minutes (0 = exact) when it stops. */
export async function stopEntries(db: Queryable, where: string, params: unknown[], rounding: number): Promise<number> {
  const end = rounding > 0
    ? `started_at + make_interval(mins => (ceil(extract(epoch FROM (now() - started_at)) / 60 / ${rounding}) * ${rounding})::int)`
    : 'now()';
  const { rowCount } = await db.query(`UPDATE time_entries SET ended_at = GREATEST(${end}, started_at) WHERE ended_at IS NULL AND ${where}`, params);
  return rowCount ?? 0;
}

export async function startTimer(db: Queryable, ticketId: number, userId: number | null, opts: { single: boolean; rounding: number }) {
  if (opts.single) {
    await stopEntries(db, userId === null ? 'user_id IS NULL' : 'user_id = $1', userId === null ? [] : [userId], opts.rounding);
  } else {
    await stopEntries(db, 'ticket_id = $1', [ticketId], opts.rounding);
  }
  await db.query('INSERT INTO time_entries (ticket_id, user_id, started_at) VALUES ($1, $2, now())', [ticketId, userId]);
  // Working on it means it is in progress.
  await db.query("UPDATE tickets SET status = 'inProgress', updated_at = now() WHERE id = $1 AND status = 'open'", [ticketId]);
}

export async function addManualTime(db: Queryable, ticketId: number, userId: number | null, minutes: number) {
  await db.query(
    'INSERT INTO time_entries (ticket_id, user_id, started_at, ended_at) VALUES ($1, $2, now() - make_interval(mins => $3), now())',
    [ticketId, userId, minutes],
  );
}
