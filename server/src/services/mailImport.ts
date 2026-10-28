import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import { SecretBox } from '../lib/secretBox.js';
import { htmlToText, planMail, type MailMessage, type MailPlan, type MailRule } from './mailRules.js';
import { createTicket } from './tickets.js';

export interface MailAccount {
  id: number;
  name: string;
  host: string;
  port: number;
  tls: 'tls' | 'starttls' | 'none';
  username: string;
  passwordEnc: string;
  mailbox: string;
  pollMinutes: number;
  onlyUnseen: boolean;
  afterImport: 'seen' | 'move' | 'delete' | 'none';
  moveTo: string;
  enabled: boolean;
  uidValidity: string | null;
  lastUid: string | null;
  lastPollAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export const ACCOUNT_SELECT = `
  SELECT id, name, host, port, tls, username, password_enc AS "passwordEnc", mailbox, poll_minutes AS "pollMinutes",
         only_unseen AS "onlyUnseen", after_import AS "afterImport", move_to AS "moveTo", enabled,
         uid_validity::text AS "uidValidity", last_uid::text AS "lastUid", last_poll_at AS "lastPollAt",
         last_error AS "lastError", created_at AS "createdAt"
    FROM mail_accounts`;

export const RULE_SELECT = `
  SELECT id, account_id AS "accountId", position, name, enabled, from_contains AS "fromContains",
         subject_contains AS "subjectContains", body_contains AS "bodyContains", subject_pattern AS "subjectPattern",
         action, split, split_pattern AS "splitPattern", title_template AS "titleTemplate",
         description_template AS "descriptionTemplate", area_id AS "areaId", prio, due_mode AS "dueMode",
         due_days AS "dueDays", to_char(due_time, 'HH24:MI') AS "dueTime", continue_after AS "continueAfter"
    FROM mail_rules`;

/**
 * Old mail programs put unencoded Latin-1 (umlauts) into headers. mailparser reads 8-bit headers as
 * UTF-8, so such a header block is converted first; the body keeps its declared charset.
 */
export function fixLatin1Headers(source: Buffer): Buffer {
  let end = source.indexOf('\r\n\r\n');
  if (end < 0) end = source.indexOf('\n\n');
  const head = source.subarray(0, end < 0 ? source.length : end);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return source;
  } catch {
    return Buffer.concat([Buffer.from(head.toString('latin1'), 'utf8'), source.subarray(head.length)]);
  }
}

/** Messages handled per poll; the rest follow on the next one. */
const BATCH = 25;
const MAX_SOURCE = 5 * 1024 * 1024;

export class MailImporter {
  private box: SecretBox;
  private busy = new Set<number>();

  constructor(private ctx: AppContext) {
    this.box = new SecretBox(ctx.config.COOKIE_SECRET, 'mail');
  }

  seal(password: string) {
    return this.box.seal(password);
  }

  private password(account: MailAccount): string {
    try {
      return this.box.open(account.passwordEnc);
    } catch {
      throw new Error('Passwort kann nicht entschlüsselt werden (COOKIE_SECRET geändert?) – bitte neu eingeben');
    }
  }

  private client(account: MailAccount): ImapFlow {
    return new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.tls === 'tls',
      doSTARTTLS: account.tls === 'starttls' ? true : account.tls === 'none' ? false : undefined,
      auth: { user: account.username, pass: this.password(account) },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
  }

  private async withClient<T>(account: MailAccount, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = this.client(account);
    c.on('error', () => {}); // socket errors surface through the awaited calls
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.logout().catch(() => c.close());
    }
  }

  async rules(accountId: number): Promise<MailRule[]> {
    return (await this.ctx.db.query<MailRule>(`${RULE_SELECT} WHERE account_id = $1 ORDER BY position, id`, [accountId])).rows;
  }

  private async today(): Promise<Date> {
    const { rows } = await this.ctx.db.query<{ y: number; m: number; d: number }>(
      'SELECT extract(year FROM current_date)::int AS y, extract(month FROM current_date)::int AS m, extract(day FROM current_date)::int AS d',
    );
    return new Date(rows[0].y, rows[0].m - 1, rows[0].d);
  }

  /** Connection test: login, folders, and how many messages the selected folder holds. */
  async test(account: MailAccount) {
    return this.withClient(account, async c => {
      const folders = (await c.list()).filter(f => !f.flags.has('\\Noselect')).map(f => f.path);
      const status = folders.includes(account.mailbox) ? await c.status(account.mailbox, { messages: true, unseen: true }) : null;
      return { ok: true, folders, mailboxExists: Boolean(status), messages: (status && status.messages) || 0, unseen: (status && status.unseen) || 0 };
    });
  }

  private async parse(uid: number, source: Buffer, uidValidity: string): Promise<MailMessage> {
    const p = await simpleParser(fixLatin1Headers(source.subarray(0, MAX_SOURCE)));
    const from = p.from?.value[0];
    return {
      messageKey: p.messageId || `${uidValidity}:${uid}`,
      fromAddress: from?.address ?? '',
      fromName: from?.name ?? '',
      subject: (p.subject ?? '').trim(),
      body: p.text?.trim() || (p.html ? htmlToText(p.html) : ''),
      date: p.date ?? new Date(),
    };
  }

  /** The newest messages and what each would become, without importing or touching them. */
  async preview(account: MailAccount, limit = 10) {
    const rules = await this.rules(account.id);
    const today = await this.today();
    return this.withClient(account, async c => {
      const lock = await c.getMailboxLock(account.mailbox, { readOnly: true });
      try {
        const box = c.mailbox;
        if (!box || !box.exists) return [];
        const from = Math.max(1, box.exists - limit + 1);
        const out: (Pick<MailMessage, 'fromAddress' | 'fromName' | 'subject'> & { date: string; seen: boolean; imported: boolean; plan: MailPlan })[] = [];
        for await (const m of c.fetch(`${from}:*`, { uid: true, flags: true, source: true })) {
          if (!m.source) continue;
          const mail = await this.parse(m.uid, m.source, String(box.uidValidity));
          const { rowCount } = await this.ctx.db.query('SELECT 1 FROM mail_imports WHERE account_id = $1 AND message_key = $2', [account.id, mail.messageKey]);
          out.push({
            fromAddress: mail.fromAddress, fromName: mail.fromName, subject: mail.subject, date: mail.date.toISOString(),
            seen: m.flags?.has('\\Seen') ?? false, imported: Boolean(rowCount), plan: planMail(rules, mail, today),
          });
        }
        return out.reverse();
      } finally {
        lock.release();
      }
    });
  }

  /** Imports new messages of one account. Returns how many messages were handled and tickets created. */
  async poll(account: MailAccount): Promise<{ messages: number; tickets: number }> {
    if (this.busy.has(account.id)) return { messages: 0, tickets: 0 };
    this.busy.add(account.id);
    try {
      const result = await this.withClient(account, c => this.pollOpen(c, account));
      await this.ctx.db.query('UPDATE mail_accounts SET last_poll_at = now(), last_error = NULL WHERE id = $1', [account.id]);
      return result;
    } catch (err) {
      const message = (err as { responseText?: string }).responseText || (err as Error).message;
      if (message !== account.lastError) await this.ctx.log.add('in', `Mail „${account.name}“: ${message}`, 'error');
      await this.ctx.db.query('UPDATE mail_accounts SET last_poll_at = now(), last_error = $2 WHERE id = $1', [account.id, message]);
      throw err;
    } finally {
      this.busy.delete(account.id);
    }
  }

  private async pollOpen(c: ImapFlow, account: MailAccount) {
    const lock = await c.getMailboxLock(account.mailbox);
    try {
      const box = c.mailbox;
      if (!box) throw new Error(`Ordner „${account.mailbox}“ nicht gefunden`);
      const uidValidity = String(box.uidValidity);
      // A new UIDVALIDITY means the server renumbered the folder: start over (the import log still prevents duplicates).
      const lastUid = account.uidValidity === uidValidity && account.lastUid ? Number(account.lastUid) : 0;

      let uids: number[] = [];
      if (box.exists) {
        const query = account.onlyUnseen ? { seen: false } : lastUid ? { uid: `${lastUid + 1}:*` } : { since: new Date(account.createdAt) };
        uids = ((await c.search(query, { uid: true })) || []).filter(u => account.onlyUnseen || u > lastUid).sort((a, b) => a - b);
      }

      // Skip what was handled before (unread mails stay unread when a rule did not match).
      const fresh: { uid: number; key: string }[] = [];
      if (uids.length) {
        for await (const m of c.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
          fresh.push({ uid: m.uid, key: m.envelope?.messageId || `${uidValidity}:${m.uid}` });
        }
      }
      const { rows: known } = await this.ctx.db.query<{ message_key: string }>(
        'SELECT message_key FROM mail_imports WHERE account_id = $1 AND message_key = ANY($2::text[])',
        [account.id, fresh.map(f => f.key)],
      );
      const knownKeys = new Set(known.map(k => k.message_key));
      const todo = fresh.filter(f => !knownKeys.has(f.key)).sort((a, b) => a.uid - b.uid).slice(0, BATCH);

      const rules = await this.rules(account.id);
      const today = await this.today();
      const done: number[] = [];
      let tickets = 0;
      let maxUid = lastUid;

      for (const { uid } of todo) {
        const msg = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const mail = await this.parse(uid, msg.source, uidValidity);
        const plan = planMail(rules, mail, today);
        const created = await this.store(account, uid, mail, plan);
        if (created === null) continue; // handled by a parallel poll
        tickets += created.length;
        if (plan.result !== 'nomatch') done.push(uid);
        if (created.length) {
          await this.ctx.log.add('in', `Mail „${mail.subject || '(ohne Betreff)'}“: ${created.length} Ticket${created.length === 1 ? '' : 's'} erstellt`, 'done');
        }
        maxUid = Math.max(maxUid, uid);
      }

      if (done.length) await this.afterImport(c, account, done);
      // Without a backlog everything seen so far is handled; with one, continue after this batch.
      const backlog = fresh.filter(f => !knownKeys.has(f.key)).length > todo.length;
      const handled = backlog ? todo : fresh;
      if (!account.onlyUnseen && handled.length) maxUid = Math.max(maxUid, ...handled.map(t => t.uid));
      await this.ctx.db.query('UPDATE mail_accounts SET uid_validity = $2, last_uid = $3 WHERE id = $1', [account.id, uidValidity, maxUid || null]);
      if (tickets) this.ctx.publisher.schedule();
      return { messages: todo.length, tickets };
    } finally {
      lock.release();
    }
  }

  /** Records the message and creates its tickets in one transaction. Null when it was recorded before. */
  private async store(account: MailAccount, uid: number, mail: MailMessage, plan: MailPlan): Promise<number[] | null> {
    return withTransaction(this.ctx.db, async c => {
      const { rows } = await c.query<{ id: number }>(
        `INSERT INTO mail_imports (account_id, message_key, uid, received_at, from_text, subject, rule_ids, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING id`,
        [account.id, mail.messageKey, uid, mail.date, mail.fromName ? `${mail.fromName} <${mail.fromAddress}>` : mail.fromAddress, mail.subject, plan.ruleIds, plan.result],
      );
      if (!rows[0]) return null;
      const fallbackArea = plan.tickets.some(t => t.areaId === null)
        ? (await c.query<{ id: number }>('SELECT id FROM areas ORDER BY position, id LIMIT 1')).rows[0]?.id
        : undefined;
      const ids: number[] = [];
      for (const t of plan.tickets) {
        const areaId = t.areaId ?? fallbackArea;
        if (!areaId) throw new Error('Es gibt noch keinen Bereich für neue Tickets');
        ids.push(await createTicket(c, { title: t.title, description: t.description, areaId, prio: t.prio, due: t.due, dueTime: t.dueTime, source: 'mail' }));
      }
      if (ids.length) await c.query('UPDATE mail_imports SET ticket_ids = $2 WHERE id = $1', [rows[0].id, ids]);
      return ids;
    });
  }

  private async afterImport(c: ImapFlow, account: MailAccount, uids: number[]) {
    const range = uids.join(',');
    if (account.afterImport === 'seen') await c.messageFlagsAdd(range, ['\\Seen'], { uid: true });
    else if (account.afterImport === 'move' && account.moveTo) {
      await c.messageFlagsAdd(range, ['\\Seen'], { uid: true });
      const moved = await c.messageMove(range, account.moveTo, { uid: true });
      if (!moved) throw new Error(`Verschieben nach „${account.moveTo}“ fehlgeschlagen`);
    } else if (account.afterImport === 'delete') await c.messageDelete(range, { uid: true });
  }

  /** Background job: poll every enabled account whose interval is up. */
  async pollDue(): Promise<void> {
    const { rows } = await this.ctx.db.query<MailAccount>(
      `${ACCOUNT_SELECT} WHERE enabled AND (last_poll_at IS NULL OR last_poll_at <= now() - make_interval(mins => poll_minutes) + interval '5 seconds')`,
    );
    for (const account of rows) await this.poll(account).catch(() => {}); // error stored on the account and logged
  }
}
