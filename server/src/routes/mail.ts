import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { ACCOUNT_SELECT, RULE_SELECT, type MailAccount } from '../services/mailImport.js';
import { checkPattern, htmlToText, planMail, type MailRule } from '../services/mailRules.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');
const pattern = z.string().max(500).superRefine((p, ctx) => {
  const error = checkPattern(p);
  if (error) ctx.addIssue({ code: 'custom', message: `Ungültiges Muster: ${error}` });
});

const accountInput = z.object({
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  tls: z.enum(['tls', 'starttls', 'none']),
  username: z.string().trim().min(1).max(255),
  password: z.string().max(500),
  mailbox: z.string().trim().min(1).max(255),
  pollMinutes: z.number().int().min(1).max(1440),
  onlyUnseen: z.boolean(),
  afterImport: z.enum(['seen', 'move', 'delete', 'none']),
  moveTo: z.string().trim().max(255),
  enabled: z.boolean(),
});
const ACCOUNT_COLUMNS: Record<Exclude<keyof z.infer<typeof accountInput>, 'password'>, string> = {
  name: 'name', host: 'host', port: 'port', tls: 'tls', username: 'username', mailbox: 'mailbox', pollMinutes: 'poll_minutes',
  onlyUnseen: 'only_unseen', afterImport: 'after_import', moveTo: 'move_to', enabled: 'enabled',
};

const ruleInput = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  fromContains: z.string().max(200),
  subjectContains: z.string().max(200),
  bodyContains: z.string().max(200),
  subjectPattern: pattern,
  bodyPattern: pattern.default(''),
  action: z.enum(['ticket', 'ignore']),
  split: z.enum(['none', 'lines', 'bullets', 'pattern']),
  splitPattern: pattern,
  splitExclude: z.string().max(1000),
  titleTemplate: z.string().trim().min(1).max(300),
  descriptionTemplate: z.string().max(2000),
  areaId: z.number().int().nullable(),
  prio: z.enum(['normal', 'high']),
  dueMode: z.enum(['none', 'days', 'detect']),
  dueDays: z.number().int().min(0).max(365),
  dueTime: hhmm.nullable(),
  continueAfter: z.boolean(),
});
const RULE_COLUMNS: Record<keyof z.infer<typeof ruleInput>, string> = {
  name: 'name', enabled: 'enabled', fromContains: 'from_contains', subjectContains: 'subject_contains', bodyContains: 'body_contains',
  subjectPattern: 'subject_pattern', bodyPattern: 'body_pattern', action: 'action', split: 'split', splitPattern: 'split_pattern', splitExclude: 'split_exclude', titleTemplate: 'title_template',
  descriptionTemplate: 'description_template', areaId: 'area_id', prio: 'prio', dueMode: 'due_mode', dueDays: 'due_days',
  dueTime: 'due_time', continueAfter: 'continue_after',
};

/** The account as the admin UI sees it: never the password. */
const publicAccount = ({ passwordEnc, uidValidity: _v, lastUid: _u, ...a }: MailAccount) => ({ ...a, hasPassword: Boolean(passwordEnc) });

/** IMAP errors become a readable 502 instead of a 500. */
async function viaImap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const e = err as { responseText?: string; authenticationFailed?: boolean; code?: string; message: string };
    const message = e.authenticationFailed ? 'Anmeldung fehlgeschlagen (Benutzer oder Passwort falsch)'
      : e.code === 'ENOTFOUND' ? 'Server nicht gefunden'
        : e.code === 'ECONNREFUSED' ? 'Verbindung abgelehnt (Port oder TLS-Einstellung prüfen)'
          : e.responseText || e.message;
    throw new HttpError(502, `Postfach: ${message}`);
  }
}

export function mailRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const admin = { config: { access: 'admin' as const } };

  const getAccount = async (id: number) => {
    const { rows } = await db.query<MailAccount>(`${ACCOUNT_SELECT} WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound('Postfach nicht gefunden');
    return rows[0];
  };
  const getRule = async (id: number) => {
    const { rows } = await db.query<MailRule & { accountId: number }>(`${RULE_SELECT} WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound('Regel nicht gefunden');
    return rows[0];
  };

  // — accounts —
  app.get('/api/mail/accounts', admin, async () => (await db.query<MailAccount>(`${ACCOUNT_SELECT} ORDER BY name, id`)).rows.map(publicAccount));

  /** Creates the account together with a catch-all rule, so it works right away and can be refined. */
  app.post('/api/mail/accounts', async (req, reply) => {
    const body = parse(accountInput, req.body);
    const id = await withTransaction(db, async c => {
      const keys = Object.keys(ACCOUNT_COLUMNS) as (keyof typeof ACCOUNT_COLUMNS)[];
      const { rows } = await c.query<{ id: number }>(
        `INSERT INTO mail_accounts (${keys.map(k => ACCOUNT_COLUMNS[k]).join(', ')}, password_enc)
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}) RETURNING id`,
        [...keys.map(k => body[k]), ctx.mail.seal(body.password)],
      );
      const { rows: [area] } = await c.query<{ id: number }>('SELECT id FROM areas ORDER BY position, id LIMIT 1');
      await c.query(
        `INSERT INTO mail_rules (account_id, position, name, title_template, description_template, area_id)
         VALUES ($1, 0, 'Alle Mails', '{subject}', 'Von {from} am {date}:\n\n{body}', $2)`,
        [rows[0].id, area?.id ?? null],
      );
      return rows[0].id;
    });
    reply.code(201);
    return publicAccount(await getAccount(id));
  });

  app.patch('/api/mail/accounts/:id', async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(accountInput.partial(), req.body);
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, col] of Object.entries(ACCOUNT_COLUMNS)) {
      if (key in body) {
        params.push(body[key as keyof typeof body]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    // Empty password field = keep the stored one.
    if (body.password) { params.push(ctx.mail.seal(body.password)); sets.push(`password_enc = $${params.length}`); }
    // A different server, user or folder is a different mailbox: forget where the last poll stopped.
    if (['host', 'port', 'username', 'mailbox'].some(k => k in body)) sets.push('uid_validity = NULL', 'last_uid = NULL');
    if (sets.length) {
      const { rowCount } = await db.query(`UPDATE mail_accounts SET ${sets.join(', ')}, last_error = NULL WHERE id = $1`, params);
      if (!rowCount) throw notFound('Postfach nicht gefunden');
    }
    return publicAccount(await getAccount(id));
  });

  /** Removes the mailbox, its rules and log; tickets that were created stay. */
  app.delete('/api/mail/accounts/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rowCount } = await db.query('DELETE FROM mail_accounts WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Postfach nicht gefunden');
    return reply.code(204).send();
  });

  app.post('/api/mail/accounts/:id/test', async req => {
    const { id } = parse(idParam, req.params);
    const account = await getAccount(id);
    return viaImap(() => ctx.mail.test(account));
  });

  app.get('/api/mail/accounts/:id/preview', admin, async req => {
    const { id } = parse(idParam, req.params);
    const account = await getAccount(id);
    return viaImap(() => ctx.mail.preview(account));
  });

  app.post('/api/mail/accounts/:id/poll', async req => {
    const { id } = parse(idParam, req.params);
    const account = await getAccount(id);
    return viaImap(() => ctx.mail.poll(account));
  });

  app.get('/api/mail/accounts/:id/imports', admin, async req => {
    const { id } = parse(idParam, req.params);
    const { rows } = await db.query(
      `SELECT i.id, i.received_at AS "receivedAt", i.created_at AS "createdAt", i.from_text AS "from", i.subject, i.result, i.error,
              i.ticket_ids AS "ticketIds",
              COALESCE((SELECT array_agg(r.name ORDER BY r.position) FROM mail_rules r WHERE r.id = ANY(i.rule_ids)), '{}') AS rules
         FROM mail_imports i WHERE i.account_id = $1 ORDER BY i.created_at DESC, i.id DESC LIMIT 50`,
      [id],
    );
    return rows;
  });

  // — rules —
  app.get('/api/mail/accounts/:id/rules', admin, async req => {
    const { id } = parse(idParam, req.params);
    return (await db.query(`${RULE_SELECT} WHERE account_id = $1 ORDER BY position, id`, [id])).rows;
  });

  app.post('/api/mail/accounts/:id/rules', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await getAccount(id);
    const body = parse(ruleInput, req.body);
    const keys = Object.keys(RULE_COLUMNS) as (keyof typeof RULE_COLUMNS)[];
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO mail_rules (account_id, position, ${keys.map(k => RULE_COLUMNS[k]).join(', ')})
       VALUES ($1, (SELECT COALESCE(max(position), -1) + 1 FROM mail_rules WHERE account_id = $1), ${keys.map((_, i) => `$${i + 2}`).join(', ')})
       RETURNING id`,
      [id, ...keys.map(k => body[k])],
    );
    reply.code(201);
    return getRule(rows[0].id);
  });

  app.patch('/api/mail/rules/:id', async req => {
    const { id } = parse(idParam, req.params);
    const body = parse(ruleInput.partial(), req.body);
    const keys = Object.keys(body) as (keyof typeof RULE_COLUMNS)[];
    if (keys.length) {
      const { rowCount } = await db.query(
        `UPDATE mail_rules SET ${keys.map((k, i) => `${RULE_COLUMNS[k]} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...keys.map(k => body[k])],
      );
      if (!rowCount) throw notFound('Regel nicht gefunden');
    }
    return getRule(id);
  });

  app.delete('/api/mail/rules/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rowCount } = await db.query('DELETE FROM mail_rules WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Regel nicht gefunden');
    return reply.code(204).send();
  });

  /** New order of an account's rules (all of its rule ids, top first). */
  app.put('/api/mail/accounts/:id/rules/order', async req => {
    const { id } = parse(idParam, req.params);
    const ids = parse(z.array(z.number().int()).max(200), req.body);
    await withTransaction(db, async c => {
      for (const [position, ruleId] of ids.entries()) {
        await c.query('UPDATE mail_rules SET position = $3 WHERE id = $1 AND account_id = $2', [ruleId, id, position]);
      }
    });
    return (await db.query(`${RULE_SELECT} WHERE account_id = $1 ORDER BY position, id`, [id])).rows;
  });

  /** Try the rules on a typed-in sample mail, without a mailbox connection. */
  app.post('/api/mail/accounts/:id/try', async req => {
    const { id } = parse(idParam, req.params);
    const sample = parse(z.object({ from: z.string().max(300), subject: z.string().max(500), body: z.string().max(20_000) }), req.body);
    const m = sample.from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    const rules = await ctx.mail.rules(id);
    const { rows: [d] } = await db.query<{ y: number; m: number; d: number }>(
      'SELECT extract(year FROM current_date)::int AS y, extract(month FROM current_date)::int AS m, extract(day FROM current_date)::int AS d',
    );
    return planMail(rules, {
      messageKey: 'sample', fromName: m ? m[1].replace(/^"|"$/g, '') : '', fromAddress: m ? m[2] : sample.from.trim(),
      // Pasted HTML (the mail's source) is read like an imported HTML mail, links included.
      subject: sample.subject, body: /<\/?(a|p|div|br|span|table|html)\b/i.test(sample.body) ? htmlToText(sample.body) : sample.body, date: new Date(),
    }, new Date(d.y, d.m - 1, d.d));
  });
}
