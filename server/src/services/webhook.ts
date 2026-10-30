import { z } from 'zod';
import type { Db } from '../db.js';
import { withTransaction } from '../db.js';
import type { EventLog } from './eventLog.js';
import type { Notifier } from './notifier.js';
import type { Publisher } from './publisher.js';
import { createTicket, setStatus } from './tickets.js';

/** Body Home Assistant posts. With `rule` the rule decides the ticket; without it `title` is required. */
export const webhookBodySchema = z.object({
  rule: z.union([z.number().int(), z.string().min(1)]).optional(),
  event: z.enum(['start', 'end']).default('start'),
  title: z.string().min(1).max(200).optional(),
  area: z.string().optional(),
  prio: z.enum(['normal', 'high']).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
}).refine(b => b.rule !== undefined || b.title, { message: '„rule“ oder „title“ fehlt' });

export type WebhookBody = z.infer<typeof webhookBodySchema>;

export interface WebhookResult {
  result: 'created' | 'duplicate' | 'disabled' | 'closed' | 'kept' | 'unknownRule';
  ticketId?: number;
  closed?: number;
}

interface RuleRow {
  id: number;
  name: string;
  title: string;
  areaId: number;
  prio: 'normal' | 'high';
  onEnd: 'close' | 'keepOpen';
  dedupe: boolean;
  enabled: boolean;
}

export class WebhookProcessor {
  constructor(private db: Db, private log: EventLog, private notifier: Notifier, private publisher: Publisher) {}

  async process(body: WebhookBody, replay = false): Promise<WebhookResult> {
    const result = body.rule !== undefined ? await this.fromRule(body, replay) : await this.adHoc(body, replay);
    if (result.result === 'created' || result.result === 'closed') this.publisher.schedule();
    return result;
  }

  private async adHoc(body: WebhookBody, replay: boolean): Promise<WebhookResult> {
    const { rows } = await this.db.query<{ id: number }>(
      'SELECT id FROM areas WHERE $1::text IS NULL OR lower(name) = lower($1) ORDER BY (lower(name) = lower(COALESCE($1, \'\'))) DESC, position, id LIMIT 1',
      [body.area ?? null],
    );
    if (!rows[0]) throw new Error('Es gibt noch keinen Bereich für neue Tickets');
    const title = body.title!;
    const ticketId = await createTicket(this.db, { title, areaId: rows[0].id, prio: body.prio, due: body.due ?? null, dueTime: body.dueTime ?? null, source: 'ha' });
    if (!replay) await this.log.add('in', `Ticket „${title}“ erstellt`, 'done', { kind: 'webhook', body });
    await this.notifier.deliver('haCreated', 'haCreated', { areaId: rows[0].id }, 'Neues Ticket von Home Assistant', title, { path: `/#/ticket/${ticketId}` });
    return { result: 'created', ticketId };
  }

  private async fromRule(body: WebhookBody, replay: boolean): Promise<WebhookResult> {
    const byId = typeof body.rule === 'number' || /^\d+$/.test(String(body.rule));
    const { rows } = await this.db.query<RuleRow>(
      `SELECT id, name, ticket_title AS title, area_id AS "areaId", prio, on_end AS "onEnd", dedupe, enabled
         FROM rules WHERE ${byId ? 'id = $1::int' : 'name = $1'}`,
      [String(body.rule)],
    );
    const rule = rows[0];
    const logged = async (message: string, status: 'done' | 'ignored' | 'rejected') => {
      if (!replay) await this.log.add('in', message, status, { kind: 'webhook', body });
    };

    if (!rule) {
      await logged(`Webhook: unbekannte Regel ${body.rule}`, 'rejected');
      return { result: 'unknownRule' };
    }
    if (!rule.enabled) {
      await logged(`Regel „${rule.name}“ übersprungen (deaktiviert)`, 'ignored');
      return { result: 'disabled' };
    }

    if (body.event === 'end') {
      if (rule.onEnd === 'keepOpen') {
        await logged(`Regel „${rule.name}“ beendet, Ticket bleibt offen`, 'ignored');
        return { result: 'kept' };
      }
      const { rows: open } = await this.db.query<{ id: number }>("SELECT id FROM tickets WHERE rule_id = $1 AND status <> 'done'", [rule.id]);
      const closed = open.length ? await setStatus(this.db, open.map(r => r.id), 'done') : 0;
      await logged(`Regel „${rule.name}“ beendet: ${closed} Ticket${closed === 1 ? '' : 's'} geschlossen`, 'done');
      return { result: 'closed', closed };
    }

    // Lock the rule row so two quick "start" calls can't both pass the duplicate check.
    const created = await withTransaction(this.db, async c => {
      await c.query('SELECT 1 FROM rules WHERE id = $1 FOR UPDATE', [rule.id]);
      if (rule.dedupe) {
        const { rows: open } = await c.query("SELECT 1 FROM tickets WHERE rule_id = $1 AND status <> 'done' LIMIT 1", [rule.id]);
        if (open.length) return null;
      }
      const { rows: [{ today }] } = await c.query<{ today: string }>('SELECT current_date::text AS today');
      return createTicket(c, { title: rule.title, areaId: rule.areaId, prio: rule.prio, due: today, source: 'ha', ruleId: rule.id });
    });

    if (created === null) {
      await logged(`Regel „${rule.name}“: Ticket „${rule.title}“ ist noch offen`, 'ignored');
      return { result: 'duplicate' };
    }
    await logged(`Ticket „${rule.title}“ erstellt`, 'done');
    await this.notifier.deliver('haCreated', 'haCreated', { areaId: rule.areaId }, 'Neues Ticket von Home Assistant', rule.title, { path: `/#/ticket/${created}` });
    return { result: 'created', ticketId: created };
  }
}
