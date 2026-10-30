import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { HttpError, parse } from '../lib/http.js';
import { PERSONAL_KINDS, type Recipient } from '../services/notifier.js';

const prefsInput = z.object({
  targets: z.array(z.string().regex(/^[a-z0-9_]+$/, 'Dienst ohne „notify.“, z. B. mobile_app_pixel_8')).max(10),
  kinds: z.partialRecord(z.enum(PERSONAL_KINDS), z.boolean()),
});

/** "mobile_app_pixel_8" → "Pixel 8"; other services keep their name. */
const deviceName = (service: string) =>
  service.startsWith('mobile_app_')
    ? service.slice('mobile_app_'.length).split('_').map(w => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
    : service;

/** Each user picks the Home Assistant devices and kinds of notifications they want. */
export function notificationRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, ha, notifier } = ctx;
  const own = async (req: FastifyRequest) => {
    const uid = userId(req);
    if (uid === null) throw new HttpError(400, 'Nur für angemeldete Benutzer');
    const { rows: [u] } = await db.query<Recipient & { kinds: Record<string, boolean> }>(
      'SELECT id, name, notify_targets AS targets, notify_kinds AS kinds FROM users WHERE id = $1', [uid],
    );
    return u;
  };
  const view = (u: { targets: string[]; kinds: Record<string, boolean> }) => ({
    targets: u.targets,
    kinds: Object.fromEntries(PERSONAL_KINDS.map(k => [k, u.kinds[k] !== false])),
  });

  app.get('/api/me/notifications', async req => {
    const u = await own(req);
    let devices: { id: string; name: string }[] = [];
    const configured = await ha.isConfigured();
    if (configured) {
      const services = await ha.listServices().catch(() => []);
      devices = Object.keys(services.find(d => d.domain === 'notify')?.services ?? {})
        .sort((a, b) => Number(b.startsWith('mobile_app_')) - Number(a.startsWith('mobile_app_')) || a.localeCompare(b))
        .map(id => ({ id, name: deviceName(id) }));
    }
    return { ...view(u), haConfigured: configured, devices, personalActive: await notifier.hasPersonal() };
  });

  app.put('/api/me/notifications', { config: { access: 'read' } }, async req => {
    const u = await own(req);
    const body = parse(prefsInput, req.body);
    const { rows: [saved] } = await db.query<{ targets: string[]; kinds: Record<string, boolean> }>(
      'UPDATE users SET notify_targets = $2, notify_kinds = $3 WHERE id = $1 RETURNING notify_targets AS targets, notify_kinds AS kinds',
      [u.id, [...new Set(body.targets)], { ...u.kinds, ...body.kinds }],
    );
    return view(saved);
  });

  /** Sends a test message to the user's devices right away, quiet hours or not. */
  app.post('/api/me/notifications/test', { config: { access: 'read' } }, async req => {
    const u = await own(req);
    if (!u.targets.length) throw new HttpError(400, 'Wähle zuerst mindestens ein Gerät');
    const sent = await notifier.sendTo([u], 'Test von Tasklog', 'So kommen deine Benachrichtigungen an.', { ignoreQuietHours: true });
    if (!sent) throw new HttpError(502, 'Senden fehlgeschlagen – steht im Protokoll');
    return { sent };
  });
}
