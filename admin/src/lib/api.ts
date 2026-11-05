import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { enqueue, flush, localAnswer, mustWait, offlineEnabled, overlay, queueable, realPath, remember, setOffline } from './offline';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function redirectToLogin() {
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  window.location.href = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** What happens on 401. The admin UI goes straight to the login; the app shows its own login screen. */
let onUnauthorized: () => void = redirectToLogin;
export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}

/** How long a change may take before the app treats Tasklog as unreachable and keeps it for later. */
const CHANGE_TIMEOUT_MS = 10_000;

/**
 * JSON (or text) request against the Tasklog API. A 401 sends the browser to the login.
 * In the app, changes made without a connection wait in the outbox (see offline.ts).
 */
export async function api<T>(rawPath: string, init: { method?: string; body?: unknown; text?: boolean; noLoginRedirect?: boolean } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const path = realPath(rawPath);
  if (method === 'GET' && !init.text) {
    const local = localAnswer(path);
    if (local.found) return local.data as T;
  }
  if (method !== 'GET' && mustWait(method, path)) {
    const answer = enqueue(method, path, init.body);
    void flush();
    return answer as T;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: method === 'GET' || !offlineEnabled() ? undefined : AbortSignal.timeout(CHANGE_TIMEOUT_MS),
    });
  } catch {
    if (!offlineEnabled()) throw new ApiError(0, 'Tasklog ist nicht erreichbar');
    setOffline(true);
    if (queueable(method, path)) return enqueue(method, path, init.body) as T;
    throw new ApiError(0, method === 'GET' ? 'Offline – diese Daten sind auf dem Gerät noch nicht gespeichert' : 'Offline – das geht erst wieder mit Verbindung');
  }
  const cachedCopy = res.headers.get('X-Tasklog-Offline') === '1';
  if (offlineEnabled()) setOffline(cachedCopy, res.headers.get('X-Tasklog-Cached-At'));
  if (res.status === 401 && !init.noLoginRedirect) {
    onUnauthorized();
    throw new ApiError(401, 'Nicht angemeldet');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(cachedCopy ? 0 : res.status, data?.error ?? `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  if (init.text) return res.text() as Promise<T>;
  const data = (await res.json()) as T;
  if (method === 'GET') {
    remember(path, data);
    return overlay(path, data);
  }
  return data;
}

interface ApiState {
  /** Bumped after every change; all `useApi` hooks refetch. */
  version: number;
  invalidate: () => void;
  error: string | null;
  setError: (message: string | null) => void;
}

const ApiContext = createContext<ApiState | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const invalidate = useCallback(() => setVersion(v => v + 1), []);
  const value = useMemo(() => ({ version, invalidate, error, setError }), [version, invalidate, error]);
  return createElement(ApiContext.Provider, { value }, children);
}

function useApiState(): ApiState {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used inside <ApiProvider>');
  return ctx;
}

/** Loads `path` (null = skip) and reloads whenever something changed. */
export function useApi<T>(path: string | null, opts: { text?: boolean; refreshMs?: number } = {}) {
  const { version, setError } = useApiState();
  const [data, setData] = useState<T | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!opts.refreshMs) return;
    const id = setInterval(() => setTick(t => t + 1), opts.refreshMs);
    return () => clearInterval(id);
  }, [opts.refreshMs]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api<T>(path, { text: opts.text })
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled && err.status !== 401) setError(err.message); });
    return () => { cancelled = true; };
  }, [path, version, tick, opts.text, setError]);

  return data;
}

/** Wraps a change: shows errors in the banner and refreshes all data afterwards. */
export function useAction() {
  const { invalidate, setError } = useApiState();
  return useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch (err) {
      if ((err as ApiError).status !== 401) setError((err as Error).message);
      return undefined;
    } finally {
      invalidate();
    }
  }, [invalidate, setError]);
}

/** Reload all data, e.g. when the app comes back to the foreground. */
export function useRefresh() {
  return useApiState().invalidate;
}

export function useApiError() {
  const { error, setError } = useApiState();
  return { error, setError, clear: () => setError(null) };
}

/** JSON helpers for changes. */
export const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = (path: string) => api<void>(path, { method: 'DELETE' });
