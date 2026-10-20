import type { Queryable } from '../db.js';

export type Direction = 'in' | 'out';
export type LogStatus = 'rejected' | 'sent' | 'ignored' | 'done' | 'error';

/** Replay information for "Wiederholen". */
export type LogPayload =
  | { kind: 'webhook'; body: unknown }
  | { kind: 'state'; entityId: string; state: string; attributes: Record<string, unknown> }
  | { kind: 'notify'; title: string; message: string };

export class EventLog {
  constructor(private db: Queryable) {}

  async add(direction: Direction, message: string, status: LogStatus, payload?: LogPayload): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      'INSERT INTO event_log (direction, message, status, payload) VALUES ($1, $2, $3, $4) RETURNING id',
      [direction, message.slice(0, 500), status, payload ? JSON.stringify(payload) : null],
    );
    return rows[0].id;
  }

  async markRetried(id: number, status: LogStatus) {
    await this.db.query('UPDATE event_log SET status = $2, retried_at = now() WHERE id = $1', [id, status]);
  }
}
