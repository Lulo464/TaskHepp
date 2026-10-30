import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { userId } from '../auth/plugin.js';
import type { AppContext } from '../context.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { PRESENCE_SELECT, sendArrival, type PresenceRule } from '../services/presence.js';

const ruleInput = z.object({
  personEntity: z.string().regex(/^(person|device_tracker)\.[a-z0-9_]+$/, 'Person oder Gerät aus Home Assistant, z. B. person.lukas'),
  zone: z.string().trim().min(1).max(100),
  areaId: z.number().int().nullable(),
  notifyService: z.string().regex(/^[a-z0-9_]+$/, 'Dienst ohne „notify.“, z. B. mobile_app_pixel_8'),
  includeUndated: z.boolean(),
  enabled: z.boolean(),
});
const COLUMNS: Record<string, string> = {
  personEntity: 'person_entity', zone: 'zone', areaId: 'area_id', notifyService: 'notify_service', includeUndated: 'include_undated', enabled: 'enabled',
};

/** Each user's own "when I arrive" rules; the Home Assistant connection itself stays an admin setting. */
export function presenceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, ha } = ctx;
  const ownUser = (req: FastifyRequest) => {
    const uid = userId(req);
    if (uid === null) throw new HttpError(400, 'Nur für angemeldete Benutzer');
    return uid;
  };
  const ownRule = async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const { rows: [rule] } = await db.query<PresenceRule>(`${PRESENCE_SELECT} WHERE id = $1 AND user_id = $2`, [id, ownUser(req)]);
    if (!rule) throw notFound('Regel nicht gefunden');
    return rule;
  };

  /** Persons, zones and notify targets from Home Assistant to pick from. */
  app.get('/api/me/presence/options', async req => {
    ownUser(req);
    if (!(await ha.isConfigured())) return { configured: false, persons: [], zones: [], notify: [] };
    const [states, services] = await Promise.all([ha.listStates(), ha.listServices()]).catch((err: Error) => {
      throw new HttpError(502, `Home Assistant: ${err.message}`);
    });
    const name = (s: { entity_id: string; attributes: Record<string, unknown> }) => String(s.attributes.friendly_name ?? s.entity_id);
    return {
      configured: true,
      persons: states.filter(s => s.entity_id.startsWith('person.')).map(s => ({ id: s.entity_id, name: name(s), state: s.state })),
      // A person in zone.home has the state "home", in any other zone the zone's name.
      zones: states.filter(s => s.entity_id.startsWith('zone.')).map(s => ({ value: s.entity_id === 'zone.home' ? 'home' : name(s), name: name(s) })),
      notify: Object.keys(services.find(d => d.domain === 'notify')?.services ?? {}).sort((a, b) => Number(b.startsWith('mobile_app')) - Number(a.startsWith('mobile_app')) || a.localeCompare(b)),
    };
  });

  app.get('/api/me/presence', async req => (await db.query<PresenceRule>(`${PRESENCE_SELECT} WHERE user_id = $1 ORDER BY id`, [ownUser(req)])).rows);

  app.post('/api/me/presence', { config: { access: 'read' } }, async (req, reply) => {
    const body = parse(ruleInput, req.body);
    const { rows: [{ id }] } = await db.query<{ id: number }>(
      `INSERT INTO presence_rules (user_id, person_entity, zone, area_id, notify_service, include_undated, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ownUser(req), body.personEntity, body.zone, body.areaId, body.notifyService, body.includeUndated, body.enabled],
    );
    return reply.code(201).send((await db.query(`${PRESENCE_SELECT} WHERE id = $1`, [id])).rows[0]);
  });

  app.patch('/api/me/presence/:id', { config: { access: 'read' } }, async req => {
    const rule = await ownRule(req);
    const body = parse(ruleInput.partial(), req.body);
    const sets: string[] = [];
    const params: unknown[] = [rule.id];
    for (const [key, col] of Object.entries(COLUMNS)) {
      if (key in body) {
        params.push(body[key as keyof typeof body]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    // Another person or zone starts fresh, so the change itself does not count as an arrival.
    if ('personEntity' in body || 'zone' in body) sets.push('last_state = NULL');
    if (sets.length) await db.query(`UPDATE presence_rules SET ${sets.join(', ')} WHERE id = $1`, params);
    return (await db.query(`${PRESENCE_SELECT} WHERE id = $1`, [rule.id])).rows[0];
  });

  app.delete('/api/me/presence/:id', { config: { access: 'read' } }, async (req, reply) => {
    const rule = await ownRule(req);
    await db.query('DELETE FROM presence_rules WHERE id = $1', [rule.id]);
    return reply.code(204).send();
  });

  /** Sends the message now, as if the person had just arrived. */
  app.post('/api/me/presence/:id/test', { config: { access: 'read' } }, async req => {
    const sent = await sendArrival(ctx, await ownRule(req), { test: true });
    if (sent === null) throw new HttpError(502, 'Senden fehlgeschlagen – steht im Protokoll');
    return { tickets: sent };
  });
}
