import type { Queryable } from '../db.js';
import { enabledEntities, entityCalculators } from './entities.js';
import type { EventLog } from './eventLog.js';
import type { HomeAssistant } from './homeAssistant.js';

/**
 * Pushes Tasklog's sensors to Home Assistant. Every run sends all enabled entities
 * (HA forgets API-set states on restart) but only logs changes and new failures.
 */
export class Publisher {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private lastError = new Map<string, string>();

  constructor(private db: Queryable, private ha: HomeAssistant, private log: EventLog, private debounceMs = 2000) {}

  private changeListeners: (() => Promise<void>)[] = [];

  /** Also run after data changed, e.g. to bring linked to-do lists in step without waiting for the next minute. */
  onChange(listener: () => Promise<void>) {
    this.changeListeners.push(listener);
  }

  /** Debounced publish after data changed. */
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.publishAll().catch(() => {});
      for (const l of this.changeListeners) void l().catch(() => {});
    }, this.debounceMs);
    this.timer.unref?.();
  }

  stop() {
    clearTimeout(this.timer);
  }

  async publishAll(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async run() {
    if (!(await this.ha.isConfigured())) return;
    for (const entityId of await enabledEntities(this.db)) {
      const { state, attributes } = await entityCalculators[entityId](this.db);
      await this.send(entityId, state, attributes);
    }
  }

  /** Sends one state; returns whether it succeeded. Also used by "Wiederholen". */
  async send(entityId: string, state: string, attributes: Record<string, unknown>, logAlways = false): Promise<boolean> {
    const { rows } = await this.db.query<{ last_state: string | null }>('SELECT last_state FROM published_entities WHERE entity_id = $1', [entityId]);
    const changed = rows[0]?.last_state !== state;
    try {
      await this.ha.setState(entityId, state, attributes);
      await this.db.query('UPDATE published_entities SET last_state = $2 WHERE entity_id = $1', [entityId, state]);
      if (changed || logAlways || this.lastError.has(entityId)) {
        await this.log.add('out', `${entityId} = ${state}`, 'sent', { kind: 'state', entityId, state, attributes });
      }
      this.lastError.delete(entityId);
      return true;
    } catch (err) {
      const message = err instanceof Error && err.name === 'TimeoutError' ? 'Zeitüberschreitung' : (err as Error).message;
      if (logAlways || this.lastError.get(entityId) !== message) {
        await this.log.add('out', `${entityId}: ${message}`, 'error', { kind: 'state', entityId, state, attributes });
      }
      this.lastError.set(entityId, message);
      return false;
    }
  }
}
