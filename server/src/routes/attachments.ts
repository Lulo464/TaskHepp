import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { randomToken } from '../lib/crypto.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { getTicket } from '../services/tickets.js';

const MAX_BYTES = 10 * 1024 * 1024;

/** Accepted image types, each recognised by its first bytes so nothing else can pass as a photo. */
const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/gif': b => b.subarray(0, 4).toString('latin1') === 'GIF8',
};

export const ATTACHMENT_SELECT = `SELECT a.id, a.file_name AS "fileName", a.mime, a.size, a.created_at AS "createdAt",
  a.user_id AS "userId", u.name AS "user" FROM ticket_attachments a LEFT JOIN users u ON u.id = a.user_id`;

/** Photos on tickets: stored in UPLOAD_DIR, served only to signed-in users. */
export function attachmentRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const dir = path.resolve(config.UPLOAD_DIR);
  const fileOf = (key: string) => path.join(dir, key);

  app.get('/api/tickets/:id/attachments', async req => {
    const { id } = parse(idParam, req.params);
    if (!(await getTicket(db, id))) throw notFound('Ticket nicht gefunden');
    return (await db.query(`${ATTACHMENT_SELECT} WHERE a.ticket_id = $1 ORDER BY a.created_at, a.id`, [id])).rows;
  });

  // The image itself is the request body; the file name comes as ?name=.
  app.register(async scoped => {
    scoped.addContentTypeParser(Object.keys(IMAGE_TYPES), { parseAs: 'buffer', bodyLimit: MAX_BYTES }, (_req, body, done) => done(null, body));
    scoped.post('/api/tickets/:id/attachments', { config: { access: 'member' }, bodyLimit: MAX_BYTES }, async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const { name } = parse(z.object({ name: z.string().max(200).optional() }), req.query);
      const mime = (req.headers['content-type'] ?? '').split(';')[0].trim();
      const body = req.body;
      if (!IMAGE_TYPES[mime] || !Buffer.isBuffer(body)) throw new HttpError(415, 'Nur Fotos (JPEG, PNG, WebP, GIF)');
      if (!IMAGE_TYPES[mime](body)) throw new HttpError(400, 'Die Datei ist kein gültiges Bild');
      if (!(await getTicket(db, id))) throw notFound('Ticket nicht gefunden');

      const key = `${randomToken(18)}.${mime.split('/')[1].replace('jpeg', 'jpg')}`;
      await mkdir(dir, { recursive: true });
      await writeFile(fileOf(key), body, { flag: 'wx' });
      const fileName = (name ?? '').replace(/[\\/\0]/g, '').trim() || key;
      const { rows: [row] } = await db.query<{ id: number }>(
        'INSERT INTO ticket_attachments (ticket_id, user_id, storage_key, file_name, mime, size) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [id, userId(req), key, fileName, mime, body.length],
      );
      return reply.code(201).send((await db.query(`${ATTACHMENT_SELECT} WHERE a.id = $1`, [row.id])).rows[0]);
    });
  });

  app.get('/api/attachments/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rows: [a] } = await db.query<{ key: string; mime: string; size: number; fileName: string }>(
      'SELECT storage_key AS key, mime, size, file_name AS "fileName" FROM ticket_attachments WHERE id = $1', [id],
    );
    if (!a) throw notFound('Foto nicht gefunden');
    try {
      await stat(fileOf(a.key));
    } catch {
      throw notFound('Die Datei fehlt im Upload-Ordner');
    }
    reply.header('Content-Type', a.mime);
    reply.header('Content-Length', a.size);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
    // Photos never change under the same id.
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(createReadStream(fileOf(a.key)));
  });

  /** The person who added it, or an admin. */
  app.delete('/api/attachments/:id', { config: { access: 'member' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rows: [a] } = await db.query<{ key: string; userId: number | null }>('SELECT storage_key AS key, user_id AS "userId" FROM ticket_attachments WHERE id = $1', [id]);
    if (!a) throw notFound('Foto nicht gefunden');
    const p = req.principal!;
    const isAdmin = p.kind === 'user' ? p.user.role === 'admin' : p.scope === 'admin';
    if (!isAdmin && a.userId !== userId(req)) throw new HttpError(403, 'Nur eigene Fotos lassen sich löschen');
    await db.query('DELETE FROM ticket_attachments WHERE id = $1', [id]);
    await unlink(fileOf(a.key)).catch(() => undefined);
    return reply.code(204).send();
  });
}

/** Removes files whose ticket was deleted (the rows go with the ticket, the files stay behind). */
export async function sweepUploads(ctx: AppContext, olderThanMs = 60 * 60 * 1000): Promise<number> {
  const dir = path.resolve(ctx.config.UPLOAD_DIR);
  const files = await readdir(dir).catch(() => [] as string[]);
  if (!files.length) return 0;
  const { rows } = await ctx.db.query<{ key: string }>('SELECT storage_key AS key FROM ticket_attachments WHERE storage_key = ANY($1::text[])', [files]);
  const known = new Set(rows.map(r => r.key));
  let removed = 0;
  for (const f of files) {
    if (known.has(f)) continue;
    const info = await stat(path.join(dir, f)).catch(() => null);
    if (!info?.isFile() || Date.now() - info.mtimeMs < olderThanMs) continue; // an upload may be on its way
    await unlink(path.join(dir, f)).catch(() => undefined);
    removed++;
  }
  return removed;
}
