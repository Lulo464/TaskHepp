import type { LogStatus, Role, TicketStatus } from './types';

/** 1.5 → "1:30 h" */
export function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`;
}

export const nextStatus: Record<TicketStatus, TicketStatus> = { open: 'inProgress', inProgress: 'done', done: 'open' };

export const ticketTag: Record<TicketStatus, string> = { open: 'tag-outline', inProgress: 'tag-accent', done: 'tag-neutral' };

export const logTag: Record<LogStatus, string> = { sent: 'tag-accent', done: 'tag-accent', ignored: 'tag-neutral', rejected: 'tag-outline', error: 'tag-outline' };

export const isLogError = (s: LogStatus) => s === 'rejected' || s === 'error';

export const roles: Role[] = ['admin', 'member', 'read'];

export const roleTag: Record<Role, string> = { admin: 'tag-accent', member: 'tag-outline', read: 'tag-neutral' };
