import type { SettingsStore } from './settings.js';

export interface HaCalendarEvent {
  summary: string;
  start: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  description?: string | null;
  uid?: string | null;
}

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
    if (!res.ok) {
      // HA often says why, e.g. "Entity todo.x not found".
      const why = await res.json().then((d: unknown) => {
        const message = (d as { message?: unknown } | null)?.message;
        return typeof message === 'string' ? `: ${message.slice(0, 200)}` : '';
      }, () => '');
      throw new Error(`Home Assistant antwortet mit ${res.status} ${res.statusText}${why}`);
    }
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

  /** All calendar entities, e.g. [{ entity_id: 'calendar.abfall_io', name: 'Abfall' }]. */
  listCalendars() {
    return this.request<{ entity_id: string; name: string }[]>('api/calendars');
  }

  /** Events between two instants. All-day events have `start.date`, timed ones `start.dateTime`. */
  calendarEvents(entityId: string, start: Date, end: Date) {
    const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    return this.request<HaCalendarEvent[]>(`api/calendars/${encodeURIComponent(entityId)}?${q}`);
  }

  /** All entity states, e.g. to list persons and zones. */
  listStates() {
    return this.request<{ entity_id: string; state: string; attributes: Record<string, unknown> }[]>('api/states');
  }

  /** Services per domain, e.g. the notify targets of the companion apps. */
  listServices() {
    return this.request<{ domain: string; services: Record<string, unknown> }[]>('api/services');
  }

  callService(domain: string, service: string, data: Record<string, unknown>) {
    return this.request(`api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, { method: 'POST', body: data });
  }

  /** A service that answers with data, e.g. todo.get_items (HA 2024.8 and later). */
  callServiceWithResponse<T>(domain: string, service: string, data: Record<string, unknown>) {
    return this.request<{ service_response?: T }>(`api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}?return_response`, { method: 'POST', body: data });
  }
}
