import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../components/ui';
import { del, patch, post, useAction, useApi } from '../lib/api';
import { formatTracked } from '../lib/format';
import i18n from '../i18n';
import type { Person, Ticket, TicketDay, TimeEntry } from '../lib/types';

/** "1:30", "90" (minutes) or "1,5h" → minutes; null when it cannot be read. */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  let m: RegExpMatchArray | null;
  let minutes: number | null = null;
  if ((m = s.match(/^(\d{1,2}):([0-5]\d)h?$/))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = s.match(/^(\d+(?:[.,]\d+)?)h$/))) minutes = Math.round(Number(m[1].replace(',', '.')) * 60);
  else if ((m = s.match(/^(\d+)(?:min|m)?$/))) minutes = Number(m[1]);
  return minutes && minutes >= 1 && minutes <= 24 * 60 ? minutes : null;
}

const today = () => new Date().toLocaleDateString('sv-SE');
export const formatDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(i18n.language, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
};
const asDuration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

interface Draft { date: string; start: string; duration: string; userId: number | null; ticketId: number }

/** Date, start, length and (when editing) the ticket the time belongs to. */
function EntryForm({ initial, tickets, people, withPerson, onlyMove = false, onSave, onCancel }: {
  initial: Draft; tickets?: Ticket[]; people?: Person[]; withPerson: boolean; onlyMove?: boolean;
  onSave: (d: Draft & { minutes: number }) => Promise<unknown>; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState(initial);
  const minutes = onlyMove ? 1 : parseDuration(d.duration);
  const set = (change: Partial<Draft>) => setD(x => ({ ...x, ...change }));
  return (
    <form className="time-entry-form" onSubmit={e => { e.preventDefault(); if (minutes) void onSave({ ...d, minutes }); }}>
      {/* A running timer can only move to another ticket. */}
      {!onlyMove && (
        <>
          <input className="input" type="date" aria-label={t('time.date')} value={d.date} max={today()} onChange={e => set({ date: e.target.value })} />
          <input className="input" type="time" aria-label={t('time.start')} value={d.start} onChange={e => set({ start: e.target.value })} />
          <input className="input" aria-label={t('time.duration')} placeholder="1:30" value={d.duration} style={{ width: 80 }}
            aria-invalid={d.duration !== '' && !minutes} onChange={e => set({ duration: e.target.value })} />
        </>
      )}
      {withPerson && people && (
        <select className="input" aria-label={t('time.person')} value={d.userId ?? ''} onChange={e => set({ userId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t('time.nobody')}</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {tickets && (
        <select className="input" aria-label={t('time.ticket')} value={d.ticketId} onChange={e => set({ ticketId: Number(e.target.value) })} style={{ maxWidth: 260 }}>
          {tickets.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select>
      )}
      <button type="submit" className="btn btn-primary" disabled={!minutes || !d.date}><Icon name="check" /> {t('common.save')}</button>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
    </form>
  );
}

/** Below a ticket in the admin list: its time day by day, each entry editable; time can be booked on any day. */
export function TicketTime({ ticket, tickets, me }: { ticket: Ticket; tickets: Ticket[]; me: number | null }) {
  const { t } = useTranslation();
  const days = useApi<TicketDay[]>(`/api/tickets/${ticket.id}/days`);
  const people = useApi<Person[]>('/api/people');
  const act = useAction();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  if (!days) return <Loading />;

  const remove = (e: TimeEntry) => window.confirm(t('time.deleteConfirm')) && act(() => del(`/api/time/${e.id}`));
  const total = days.reduce((s, d) => s + d.seconds, 0);

  return (
    <div className="ticket-time">
      <div className="ticket-time-head">
        <span className="soft">{t('time.perDay', { count: days.length, total: formatTracked({ minutes: Math.round(total / 60), seconds: total }) })}</span>
        {editing !== 'new' && <button type="button" className="btn btn-secondary" onClick={() => setEditing('new')}><Icon name="plus" /> {t('time.book')}</button>}
      </div>
      {editing === 'new' && (
        <EntryForm
          initial={{ date: today(), start: '09:00', duration: '', userId: ticket.assigneeId ?? me, ticketId: ticket.id }}
          people={people} withPerson
          onCancel={() => setEditing(null)}
          onSave={async d => {
            if (await act(() => post(`/api/tickets/${ticket.id}/time`, { minutes: d.minutes, date: d.date, start: d.start, userId: d.userId }))) setEditing(null);
          }}
        />
      )}
      {days.length === 0 && editing !== 'new' && <div className="muted">{t('time.none')}</div>}
      {days.map(day => (
        <div key={day.date} className="ticket-day">
          <div className="ticket-day-head">
            <span>{formatDay(day.date)}</span>
            <span className="mono">{formatTracked(day)}</span>
          </div>
          {day.entries.map(e => editing === e.id ? (
            <EntryForm
              key={e.id}
              initial={{ date: e.startDay, start: e.startTime, duration: asDuration(Math.round((Date.parse(e.endedAt ?? new Date().toISOString()) - Date.parse(e.startedAt)) / 60000)), userId: e.userId, ticketId: ticket.id }}
              tickets={tickets} withPerson={false} onlyMove={!e.endedAt}
              onCancel={() => setEditing(null)}
              onSave={async d => {
                const change: Record<string, unknown> = d.ticketId !== ticket.id ? { ticketId: d.ticketId } : {};
                if (e.endedAt) Object.assign(change, { date: d.date, start: d.start, minutes: d.minutes });
                if (await act(() => patch(`/api/time/${e.id}`, change))) setEditing(null);
              }}
            />
          ) : (
            <div key={`${e.id}-${day.date}`} className="ticket-day-entry">
              <span className="grow">
                {e.user ?? t('time.nobody')} · {e.startTime}–{e.endTime ?? t('time.running')}
                {e.manual && <span className="muted"> · {t('time.manual')}</span>}
                {e.startDay !== day.date && <span className="muted"> · {t('time.fromDayBefore')}</span>}
              </span>
              <span className="mono">{formatTracked({ minutes: Math.round(e.seconds / 60), seconds: e.seconds })}</span>
              <button type="button" className="icon-btn" aria-label={t('time.edit')} title={e.endedAt ? t('time.edit') : t('time.move')} onClick={() => setEditing(e.id)}><Icon name="pencil-simple" /></button>
              <button type="button" className="icon-btn" aria-label={t('time.delete')} onClick={() => remove(e)}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
