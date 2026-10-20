import type { Queryable } from '../db.js';

export interface EntityState {
  state: string;
  attributes: Record<string, unknown>;
}

// Times are evaluated in the session time zone (set per connection from TZ).
const TODAY_START = "date_trunc('day', now())";

type Calculator = (db: Queryable) => Promise<EntityState>;

/** How each published entity gets its value. Keys match `published_entities.entity_id`. */
export const entityCalculators: Record<string, Calculator> = {
  'sensor.tasklog_open_tickets': async db => {
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets WHERE status <> 'done'");
    return { state: String(rows[0].n), attributes: { friendly_name: 'Tasklog offene Tickets', icon: 'mdi:checkbox-marked-outline', state_class: 'measurement' } };
  },
  'sensor.tasklog_today_time': async db => {
    const { rows } = await db.query<{ h: number }>(
      `SELECT COALESCE(sum(extract(epoch FROM (COALESCE(ended_at, now()) - GREATEST(started_at, ${TODAY_START})))), 0) / 3600.0 AS h
         FROM time_entries WHERE COALESCE(ended_at, now()) > ${TODAY_START}`,
    );
    return { state: Number(rows[0].h).toFixed(2), attributes: { friendly_name: 'Tasklog heute erfasst', unit_of_measurement: 'h', icon: 'mdi:timer-outline', state_class: 'measurement' } };
  },
  'binary_sensor.tasklog_timer_running': async db => {
    const { rows } = await db.query<{ title: string | null }>(
      'SELECT t.title FROM time_entries e JOIN tickets t ON t.id = e.ticket_id WHERE e.ended_at IS NULL ORDER BY e.started_at DESC LIMIT 1',
    );
    return { state: rows[0] ? 'on' : 'off', attributes: { friendly_name: 'Tasklog Timer läuft', icon: 'mdi:timer-play-outline', ticket: rows[0]?.title ?? null } };
  },
  'binary_sensor.tasklog_overdue': async db => {
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets WHERE status <> 'done' AND due_date < current_date");
    return { state: rows[0].n > 0 ? 'on' : 'off', attributes: { friendly_name: 'Tasklog überfällige Tickets', icon: 'mdi:alert-circle-outline', count: rows[0].n } };
  },
  'sensor.tasklog_next_due': async db => {
    const { rows } = await db.query<{ title: string; due: string }>(
      `SELECT title, due_date AS due FROM tickets
        WHERE status <> 'done' AND due_date >= current_date
        ORDER BY due_date, prio = 'high' DESC, id LIMIT 1`,
    );
    return { state: rows[0]?.title.slice(0, 250) ?? 'keins', attributes: { friendly_name: 'Tasklog nächstes Ticket', icon: 'mdi:calendar-clock', due: rows[0]?.due ?? null } };
  },
};

export async function enabledEntities(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ entity_id: string }>('SELECT entity_id FROM published_entities WHERE enabled ORDER BY position');
  return rows.map(r => r.entity_id).filter(id => id in entityCalculators);
}
