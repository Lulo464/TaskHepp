import i18n from '../i18n';
import type { LogStatus, Role, TicketStatus } from './types';

/** 90 → "1:30 h" */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}

const dayDiff = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const today = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
};

/** Due date as "Heute", "Morgen", "Sa", "überfällig" … */
export function formatDue(iso: string | null): string {
  if (!iso) return '–';
  const diff = dayDiff(iso);
  if (diff < 0) return i18n.t('due.overdue');
  if (diff === 0) return i18n.t('due.today');
  if (diff === 1) return i18n.t('due.tomorrow');
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return diff < 7
    ? date.toLocaleDateString(i18n.language, { weekday: 'short' }).replace('.', '')
    : date.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' });
}

/** "jetzt", "vor 12 min", "gestern", "vor 3 Tagen" */
export function formatAgo(iso: string | null): string {
  if (!iso) return '–';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return i18n.t('ago.now');
  if (minutes < 60) return i18n.t('ago.minutes', { n: minutes });
  if (minutes < 24 * 60) return i18n.t('ago.hours', { n: Math.round(minutes / 60) });
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? i18n.t('ago.yesterday') : i18n.t('ago.days', { n: days });
}

export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

export const firstName = (name: string | null) => (name ? name.split(' ')[0] : '–');

export const nextStatus: Record<TicketStatus, TicketStatus> = { open: 'inProgress', inProgress: 'done', done: 'open' };

export const ticketTag: Record<TicketStatus, string> = { open: 'tag-outline', inProgress: 'tag-accent', done: 'tag-neutral' };

export const logTag: Record<LogStatus, string> = { sent: 'tag-accent', done: 'tag-accent', ignored: 'tag-neutral', rejected: 'tag-outline', error: 'tag-outline' };

export const roles: Role[] = ['admin', 'member', 'read'];

export const roleTag: Record<Role, string> = { admin: 'tag-accent', member: 'tag-outline', read: 'tag-neutral' };
