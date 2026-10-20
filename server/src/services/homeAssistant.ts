import type { SettingsStore } from './settings.js';

export class HaNotConfigured extends Error {
  constructor() {
    super('Home Assistant ist nicht eingerichtet (URL und Token fehlen)');
  }
}

/** Thin client for the Home Assistant REST API. URL and token come from the settings on every call. */
export class HomeAssistant {
  constructor(private settings: SettingsStore, private timeoutMs = 5000) {}

  async isConfigured(): Promise<boolean> {
    const { ha } = await this.settings.get();
    return Boolean(ha.url && ha.token);
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const { ha } = await this.settings.get();
    if (!ha.url || !ha.token) throw new HaNotConfigured();
    const res = await fetch(new URL(path, ha.url.endsWith('/') ? ha.url : ha.url + '/'), {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${ha.token}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Home Assistant antwortet mit ${res.status} ${res.statusText}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Connection test: API reachable and token valid. */
  async check(): Promise<{ ok: boolean; version?: string; message: string }> {
    try {
      const config = await this.request<{ version: string; location_name?: string }>('api/config');
      return { ok: true, version: config.version, message: 'Verbindung OK' };
    } catch (err) {
      return { ok: false, message: err instanceof Error && err.name === 'TimeoutError' ? 'Zeitüberschreitung' : (err as Error).message };
    }
  }

  /** Creates or updates an entity state (not persisted by HA across restarts; the publisher re-sends regularly). */
  setState(entityId: string, state: string, attributes: Record<string, unknown>) {
    return this.request(`api/states/${encodeURIComponent(entityId)}`, { method: 'POST', body: { state, attributes } });
  }

  getState(entityId: string) {
    return this.request<{ state: string; attributes: Record<string, unknown> }>(`api/states/${encodeURIComponent(entityId)}`);
  }

  callService(domain: string, service: string, data: Record<string, unknown>) {
    return this.request(`api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, { method: 'POST', body: data });
  }
}
