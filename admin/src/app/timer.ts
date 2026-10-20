import { useEffect, useState } from 'react';
import { post, useAction, useApi } from '../lib/api';
import type { RunningTimer } from '../lib/types';

/** Re-renders every second while `active`, for running clocks. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** "00:23:41" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
}

/** The signed-in user's running timers plus start/stop actions. */
export function useTimers() {
  const timers = useApi<RunningTimer[]>('/api/timer') ?? [];
  const act = useAction();
  const runningFor = (ticketId: number) => timers.find(x => x.ticketId === ticketId) ?? null;
  return {
    timers,
    runningFor,
    start: (ticketId: number) => act(() => post(`/api/tickets/${ticketId}/timer`)),
    stop: (ticketId?: number) => act(() => post('/api/timer/stop', ticketId ? { ticketId } : {})),
    toggle: (ticketId: number) =>
      runningFor(ticketId) ? act(() => post('/api/timer/stop', { ticketId })) : act(() => post(`/api/tickets/${ticketId}/timer`)),
  };
}

export type Timers = ReturnType<typeof useTimers>;
