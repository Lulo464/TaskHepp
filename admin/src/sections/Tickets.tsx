import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading, Seg } from '../components/ui';
import { patch, post, useAction, useApi } from '../lib/api';
import { firstName, formatDue, formatTracked, nextStatus, ticketTag } from '../lib/format';
import type { Area, Me, Ticket } from '../lib/types';
import { formatDay, TicketTime } from './TicketTime';

const HA_FILTER = '__ha';
const ALL = '__all';
const today = () => new Date().toLocaleDateString('sv-SE');

export function Tickets() {
  const { t } = useTranslation();
  // A day shows only the tickets worked on that day, with that day's time ("" = all tickets, all time).
  const [day, setDay] = useState('');
  const tickets = useApi<Ticket[]>(day ? `/api/tickets?day=${day}` : '/api/tickets');
  const all = useApi<Ticket[]>(day ? '/api/tickets' : null);
  const areas = useApi<Area[]>('/api/areas');
  const me = useApi<Me>('/api/me');
  const act = useAction();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(ALL);
  const [picked, setPicked] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  if (!tickets) return <Loading />;

  const filters = [
    { value: ALL, label: t('common.all') },
    ...(areas ?? []).map(a => ({ value: String(a.id), label: a.name })),
    { value: HA_FILTER, label: t('tickets.filterHa') },
  ];
  const rows = tickets.filter(x =>
    (filter === ALL || (filter === HA_FILTER ? x.source === 'ha' : String(x.areaId) === filter)) &&
    x.title.toLowerCase().includes(query.toLowerCase()));
  const timeOf = (x: Ticket) => (day ? { minutes: x.dayMinutes ?? 0, seconds: x.daySeconds ?? 0 } : x);
  const daySum = rows.reduce((s, x) => s + (x.daySeconds ?? 0), 0);

  const togglePick = (id: number) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const bulk = (action: 'setStatus' | 'delete') => act(async () => {
    await post('/api/tickets/bulk', { ids: picked, action, status: 'done' });
    setPicked([]);
  });
  const cycle = (x: Ticket) => act(() => patch(`/api/tickets/${x.id}`, { status: nextStatus[x.status] }));

  return (
    <>
      <div className="toolbar">
        <input className="input" style={{ width: 240 }} placeholder={t('tickets.search')} value={query} onChange={e => setQuery(e.target.value)} aria-label={t('tickets.search')} />
        <Seg options={filters} value={filter} onChange={setFilter} />
        <div className="spacer" />
        {picked.length > 0 && (
          <>
            <span className="soft" style={{ fontSize: 13 }}>{t('tickets.selected', { count: picked.length })}</span>
            <button type="button" className="btn btn-secondary" onClick={() => bulk('setStatus')}><Icon name="check" /> {t('tickets.markDone')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => bulk('delete')}><Icon name="trash" /> {t('common.delete')}</button>
          </>
        )}
      </div>
      <div className="toolbar time-day-bar">
        <span className="soft"><Icon name="calendar-dots" /> {t('time.show')}</span>
        <Seg
          options={[{ value: '', label: t('time.allTime') }, { value: today(), label: t('time.today') }]}
          value={day === '' || day === today() ? day : '__other'}
          onChange={setDay}
        />
        <input className="input" type="date" aria-label={t('time.pickDay')} value={day} max={today()} onChange={e => setDay(e.target.value)} />
        {day && <span className="soft">{t('time.dayTotal', { day: formatDay(day), total: formatTracked({ minutes: Math.round(daySum / 60), seconds: daySum }), count: rows.length })}</span>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>{t('tickets.col.title')}</th>
              <th>{t('tickets.col.where')}</th>
              <th>{t('tickets.col.status')}</th>
              <th>{t('tickets.col.prio')}</th>
              <th>{t('tickets.col.assignee')}</th>
              <th>{t('tickets.col.due')}</th>
              <th className="right">{day ? t('time.onDay', { day: formatDay(day) }) : t('tickets.col.time')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(x => {
              const isPicked = picked.includes(x.id);
              const isOpen = open === x.id;
              return (
                <Fragment key={x.id}>
                  <tr className={isOpen ? 'is-open' : undefined}>
                    <td>
                      <button type="button" className="icon-btn" role="checkbox" aria-checked={isPicked} aria-label={t('tickets.select')} onClick={() => togglePick(x.id)}>
                        <Icon name={isPicked ? 'check-square' : 'square'} fill={isPicked} />
                      </button>
                    </td>
                    <td>
                      {x.title}{' '}
                      {x.source === 'ha' && <i className="ph ph-house-line accent" title={t('tickets.fromHa')} />}
                      {x.source === 'mail' && <i className="ph ph-envelope-simple accent" title={t('tickets.fromMail')} />}
                      {x.running && <i className="ph-fill ph-timer accent" title={t('tickets.running')} />}
                    </td>
                    <td className="soft">{x.area}{x.project ? ` / ${x.project}` : ''}</td>
                    <td>
                      <button type="button" className={`tag ${ticketTag[x.status]}`} title={t('tickets.cycleStatus')} onClick={() => cycle(x)}>
                        {t(`status.${x.status}`)}
                      </button>
                    </td>
                    <td>{t(`prio.${x.prio}`)}</td>
                    <td>{firstName(x.assignee)}</td>
                    <td>{formatDue(x.due, x.dueTime)}</td>
                    <td className="right">
                      <button type="button" className="time-toggle" aria-expanded={isOpen} title={t('time.perDayTitle')} onClick={() => setOpen(isOpen ? null : x.id)}>
                        {formatTracked(timeOf(x))} <Icon name={isOpen ? 'caret-up' : 'caret-down'} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="ticket-time-row">
                      <td colSpan={8}><TicketTime ticket={x} tickets={all ?? tickets} me={me?.id ?? null} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="empty">{day ? t('time.nothingOnDay') : t('tickets.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
