import type { Queryable } from '../db.js';

export type TicketStatus = 'open' | 'inProgress' | 'done';
export type Prio = 'normal' | 'high';

export interface TicketRow {
  id: number;
  title: string;
  description: string;
  status: TicketStatus;
  prio: Prio;
  due: string | null;
  /** 'HH:MM' or null for the whole day. */
  dueTime: string | null;
  source: 'manual' | 'app' | 'ha' | 'mail';
  ruleId: number | null;
  areaId: number;
  area: string;
  projectId: number | null;
  project: string | null;
  assigneeId: number | null;
  assignee: string | null;
  minutes: number;
  running: boolean;
  createdAt: string;
  doneAt: string | null;
}

export const TICKET_SELECT = `
  SELECT t.id, t.title, t.description, t.status, t.prio, t.due_date AS due, to_char(t.due_time, 'HH24:MI') AS "dueTime", t.source, t.rule_id AS "ruleId",
         t.area_id AS "areaId", a.name AS area, t.project_id AS "projectId", p.name AS project,
         t.assignee_id AS "assigneeId", u.name AS assignee,
         COALESCE(tm.minutes, 0)::int AS minutes, COALESCE(tm.running, false) AS running,
         t.created_at AS "createdAt", t.done_at AS "doneAt"
    FROM tickets t
    JOIN areas a ON a.id = t.area_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN LATERAL (
      SELECT round(sum(extract(epoch FROM (COALESCE(e.ended_at, now()) - e.started_at))) / 60) AS minutes,
             bool_or(e.ended_at IS NULL) AS running
        FROM time_entries e WHERE e.ticket_id = t.id
    ) tm ON true`;

export const TICKET_ORDER = `ORDER BY CASE t.status WHEN 'inProgress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, t.due_date NULLS LAST, t.due_time NULLS LAST, t.prio = 'high' DESC, t.id`;

export async function getTicket(db: Queryable, id: number): Promise<TicketRow | null> {
  const { rows } = await db.query<TicketRow>(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

export interface NewTicket {
  title: string;
  description?: string;
  areaId: number;
  projectId?: number | null;
  status?: TicketStatus;
  prio?: Prio;
  assigneeId?: number | null;
  due?: string | null;
  dueTime?: string | null;
  source?: 'manual' | 'app' | 'ha' | 'mail';
  ruleId?: number | null;
}

export async function createTicket(db: Queryable, t: NewTicket): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO tickets (title, area_id, project_id, status, prio, assignee_id, due_date, source, rule_id, description, due_time, done_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $4 = 'done' THEN now() END) RETURNING id`,
    [t.title, t.areaId, t.projectId ?? null, t.status ?? 'open', t.prio ?? 'normal', t.assigneeId ?? null, t.due ?? null, t.source ?? 'manual', t.ruleId ?? null, t.description ?? '', t.dueTime ?? null],
  );
  return rows[0].id;
}

/** Applies a status change, keeping done_at in step and stopping running timers on completion. */
export async function setStatus(db: Queryable, ids: number[], status: TicketStatus): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE tickets SET status = $2, updated_at = now(),
            done_at = CASE WHEN $2 = 'done' THEN COALESCE(done_at, now()) ELSE NULL END
      WHERE id = ANY($1::int[])`,
    [ids, status],
  );
  if (status === 'done') await db.query('UPDATE time_entries SET ended_at = now() WHERE ended_at IS NULL AND ticket_id = ANY($1::int[])', [ids]);
  return rowCount ?? 0;
}

/** SQL condition: ticket `t` is past its due date, or due today and past its time. */
export const OVERDUE_SQL = "(t.due_date < current_date OR (t.due_date = current_date AND t.due_time < localtime))";
