import type { Db } from './db.js';
import { withTransaction } from './db.js';

/**
 * Demo data matching the design prototype. Only runs on an empty database (no areas yet).
 * Times are relative to now so reports and "today" always have something to show.
 */
export async function seedDemo(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM areas');
  if (rows[0].n > 0) return false;

  await withTransaction(db, async c => {
    const id = async (sql: string, params: unknown[]) => (await c.query<{ id: number }>(sql + ' RETURNING id', params)).rows[0].id;

    const work = await id("INSERT INTO areas (name, icon, position) VALUES ('Arbeit', 'briefcase', 0)", []);
    const home = await id("INSERT INTO areas (name, icon, position) VALUES ('Zuhause', 'house', 1)", []);
    const p = {
      auth: await id('INSERT INTO projects (area_id, name, position) VALUES ($1, $2, 0)', [work, 'Plattform / Auth']),
      sprint: await id('INSERT INTO projects (area_id, name, position) VALUES ($1, $2, 1)', [work, 'Sprint 42']),
      house: await id('INSERT INTO projects (area_id, name, position) VALUES ($1, $2, 0)', [home, 'Haus & Technik']),
      garden: await id('INSERT INTO projects (area_id, name, position) VALUES ($1, $2, 1)', [home, 'Garten']),
      finance: await id('INSERT INTO projects (area_id, name, position) VALUES ($1, $2, 2)', [home, 'Finanzen']),
    };

    const user = (name: string, email: string, group: string, role: string, seen: string) =>
      id(`INSERT INTO users (name, email, oidc_group, role, last_seen_at) VALUES ($1, $2, $3, $4, now() - $5::interval)`, [name, email, group, role, seen]);
    const max = await user('Max Mustermann', 'max@example.com', 'tasklog-admins', 'admin', '0');
    const anna = await user('Anna Beispiel', 'anna@example.com', 'tasklog-team', 'member', '12 minutes');
    const jonas = await user('Jonas Test', 'jonas@example.com', 'tasklog-team', 'member', '1 day');
    await user('Lea Gast', 'lea@example.com', 'tasklog-guests', 'read', '3 days');

    const rule = (r: unknown[]) => id(
      `INSERT INTO rules (name, entity, cond, join_op, cond2, time_window, ticket_title, area_id, prio, on_end, dedupe, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, r);
    const filterRule = await rule(['Filterdruck zu hoch', 'sensor.filterdruck', '> 1.8', 'and', '', '00:00–23:59', 'Wärmepumpe: Filter reinigen', home, 'high', 'close', true, true]);
    await rule(['Müllabfuhr morgen', 'calendar.muell', 'in 1 Tag', 'and', '', '17:00–21:00', 'Müll rausstellen', home, 'normal', 'close', true, true]);
    await rule(['Fenster lange offen', 'binary_sensor.fenster', 'on > 2 h', 'and', 'sensor.aussen_temp < 5', '00:00–23:59', 'Fenster schließen', home, 'normal', 'keepOpen', false, false]);
    const nasRule = await rule(['Server-Alarm', 'sensor.nas_temp', '> 60', 'or', 'sensor.nas_fan = 0', '00:00–23:59', 'NAS überhitzt', work, 'high', 'close', true, true]);

    // [title, area, project, status, prio, assignee, due (days from today, null = none), minutes, source, rule]
    const tickets: [string, number, number, string, string, number, number | null, number, string, number | null][] = [
      ['Wärmepumpe: Filter reinigen', home, p.house, 'inProgress', 'high', max, 0, 24, 'ha', filterRule],
      ['Steuererklärung 2025 abgeben', home, p.finance, 'inProgress', 'high', max, 0, 45, 'manual', null],
      ['Sprint-Review vorbereiten', work, p.sprint, 'open', 'normal', anna, 0, 90, 'manual', null],
      ['Rauchmelder Batterien tauschen', home, p.house, 'open', 'normal', max, 4, 0, 'app', null],
      ['API-Doku Auth-Flow ergänzen', work, p.auth, 'inProgress', 'normal', jonas, 3, 390, 'manual', null],
      ['Hecke schneiden', home, p.garden, 'done', 'normal', max, null, 60, 'manual', null],
      ['Code-Review PR #482', work, p.auth, 'done', 'normal', anna, null, 30, 'manual', null],
      ['NAS überhitzt', work, p.auth, 'open', 'high', jonas, 0, 12, 'ha', nasRule],
    ];
    for (const [title, area, project, status, prio, assignee, due, minutes, source, ruleId] of tickets) {
      const ticket = await id(
        `INSERT INTO tickets (title, area_id, project_id, status, prio, assignee_id, due_date, source, rule_id, done_at)
         VALUES ($1, $2, $3, $4, $5, $6, current_date + $7::int, $8, $9, CASE WHEN $4 = 'done' THEN now() END)`,
        [title, area, project, status, prio, assignee, due, source, ruleId],
      );
      if (minutes > 0) {
        // Spread over today, so the current week and month include it whatever weekday it is.
        await c.query(
          `INSERT INTO time_entries (ticket_id, user_id, started_at, ended_at)
           VALUES ($1, $2, GREATEST(date_trunc('day', now()), now() - make_interval(mins => $3 + 5)),
                   GREATEST(date_trunc('day', now()), now() - make_interval(mins => $3 + 5)) + make_interval(mins => $3))`,
          [ticket, assignee, minutes],
        );
      }
    }

    await c.query("UPDATE tickets SET due_time = '15:30' WHERE title = 'Sprint-Review vorbereiten'");
    await c.query("UPDATE tickets SET due_time = '17:00' WHERE title = 'Steuererklärung 2025 abgeben'");

    const log = (minutesAgo: number, dir: string, message: string, status: string, payload: unknown = null) =>
      c.query('INSERT INTO event_log (at, direction, message, status, payload) VALUES (now() - make_interval(mins => $1), $2, $3, $4, $5)', [minutesAgo, dir, message, status, payload && JSON.stringify(payload)]);
    await log(400, 'out', 'sensor.tasklog_next_due: Zeitüberschreitung', 'error', { kind: 'state', entityId: 'sensor.tasklog_next_due', state: 'Sprint-Review vorbereiten', attributes: {} });
    await log(386, 'in', 'Ticket „Wärmepumpe: Filter reinigen“ erstellt', 'done', { kind: 'webhook', body: { rule: filterRule, event: 'start' } });
    await log(318, 'out', 'binary_sensor.tasklog_timer_running = on', 'sent');
    await log(283, 'in', 'Regel „Fenster lange offen“ übersprungen (deaktiviert)', 'ignored');
    await log(95, 'out', 'sensor.tasklog_open_tickets = 6', 'sent');
    await log(8, 'in', 'Webhook: ungültiges Token', 'rejected', { kind: 'webhook', body: { rule: nasRule, event: 'start' } });
  });
  return true;
}
