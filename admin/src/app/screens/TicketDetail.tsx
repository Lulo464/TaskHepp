import { useTranslation } from 'react-i18next';
import { Assignee } from './Assignee';
import { Icon, Loading } from '../../components/ui';
import { del, patch, post, useAction, useApi } from '../../lib/api';
import { formatDue, formatMinutes, formatTime, isOverdue } from '../../lib/format';
import type { HistoryEvent, Me, Ticket, TicketStatus } from '../../lib/types';
import { href, navigate } from '../router';
import { clock, useNow, type Timers } from '../timer';
import { TicketNotes } from './TicketNotes';

const STATUSES: TicketStatus[] = ['open', 'inProgress', 'done'];

export function TicketDetail({ id, me, timers, canEdit }: { id: number; me: Me; timers: Timers; canEdit: boolean }) {
  const { t } = useTranslation();
  const ticket = useApi<Ticket>(`/api/tickets/${id}`);
  const history = useApi<HistoryEvent[]>(`/api/tickets/${id}/history`);
  const act = useAction();
  const running = timers.runningFor(id);
  const now = useNow(Boolean(running));

  if (!ticket) return <div className="pwa-screen"><Loading /></div>;

  const addTime = (minutes: number) => act(() => post(`/api/tickets/${id}/time`, { minutes }));
  const setStatus = (status: TicketStatus) => act(() => patch(`/api/tickets/${id}`, { status }));
  const setDue = (body: { due?: string | null; dueTime?: string | null }) => act(() => patch(`/api/tickets/${id}`, body));
  const remove = () => window.confirm(t('app.detail.deleteConfirm')) && act(async () => {
    await del(`/api/tickets/${id}`);
    navigate({ name: 'tickets' }, true);
  });

  return (
    <div className="pwa-screen">
      <a className="btn btn-ghost pwa-back" href={href({ name: 'tickets' })} onClick={e => { if (window.history.length > 1) { e.preventDefault(); window.history.back(); } }}>
        <Icon name="caret-left" /> {t('app.tab.tickets')}
      </a>
      <div className="row" style={{ margin: '10px 0' }}>
        <span className="tag tag-accent">{ticket.area}{ticket.project ? ` · ${ticket.project}` : ''}</span>
        {ticket.source === 'ha' && <span className="tag tag-outline"><Icon name="house-line" />&nbsp;Home Assistant</span>}
        {ticket.source === 'mail' && <span className="tag tag-outline"><Icon name="envelope-simple" />&nbsp;E-Mail</span>}
        {ticket.prio === 'high' && <span className="tag tag-outline">{t('prio.high')}</span>}
      </div>
      <h1 className="pwa-h1 pwa-detail-title">{ticket.title}</h1>
      <p className="pwa-desc">{ticket.description || t('app.detail.noDescription')}</p>
      {canEdit ? (
        <div className="pwa-due-edit">
          <Icon name="calendar-blank" />
          <input className="input" type="date" aria-label={t('tickets.col.due')} value={ticket.due ?? ''} onChange={e => setDue({ due: e.target.value || null, ...(e.target.value ? {} : { dueTime: null }) })} />
          <input className="input" type="time" aria-label={t('app.new.time')} key={ticket.dueTime ?? ''} defaultValue={ticket.dueTime ?? ''} disabled={!ticket.due}
            onBlur={e => (e.target.value || null) !== ticket.dueTime && setDue({ dueTime: e.target.value || null })} />
          {isOverdue(ticket.due, ticket.dueTime) && <span className="tag tag-outline">{t('due.overdue')}</span>}
        </div>
      ) : ticket.due && (
        <p className="pwa-row-meta" style={{ margin: '-10px 0 18px' }}><Icon name="calendar-blank" /> {t('app.detail.due', { when: formatDue(ticket.due, ticket.dueTime) })}</p>
      )}
      <Assignee ticket={ticket} canEdit={canEdit} />

      <div className="seg pwa-seg" role="radiogroup" aria-label={t('tickets.col.status')}>
        {STATUSES.map(s => (
          <button key={s} type="button" role="radio" aria-checked={ticket.status === s} disabled={!canEdit} className={`seg-opt seg-btn seg-fill${ticket.status === s ? ' is-active' : ''}`} onClick={() => setStatus(s)}>
            {t(`status.${s}`)}
          </button>
        ))}
      </div>

      <div className="pwa-time-card">
        {running ? (
          <>
            {/* The total from the server already includes the running session up to the last load. */}
            <div className="pwa-label">{t('app.detail.trackedRunning', { total: formatMinutes(ticket.minutes) })}</div>
            <div className="pwa-time-value pwa-num">{clock(now - Date.parse(running.startedAt))}</div>
          </>
        ) : (
          <>
            <div className="pwa-label">{t('app.detail.tracked')}</div>
            <div className="pwa-time-value pwa-num">{formatMinutes(ticket.minutes)}</div>
          </>
        )}
        {canEdit && (
          <>
            <button type="button" className="btn btn-primary btn-block" onClick={() => timers.toggle(id)} disabled={ticket.status === 'done' && !running}>
              <Icon name={running ? 'pause' : 'play'} fill={Boolean(running)} /> {t(running ? 'app.stopTimer' : 'app.startTimer')}
            </button>
            <div className="row pwa-add-time">
              <button type="button" className="btn btn-secondary" onClick={() => addTime(15)}>+ 15 min</button>
              <button type="button" className="btn btn-secondary" onClick={() => addTime(30)}>+ 30 min</button>
              <button type="button" className="btn btn-secondary" onClick={() => addTime(60)}>+ 1 h</button>
            </div>
          </>
        )}
      </div>

      <TicketNotes ticketId={id} me={me} canEdit={canEdit} />

      {history && history.length > 0 && (
        <>
          <div className="pwa-kicker">{t('app.detail.history')}</div>
          <div className="pwa-history">
            {history.map((h, i) => (
              <div key={i}>
                <span className="pwa-num">{formatTime(h.at)}</span> {t(`app.history.${h.kind}`, { minutes: h.minutes, user: h.user ?? '' })}
              </div>
            ))}
          </div>
        </>
      )}

      {canEdit && <button type="button" className="btn btn-ghost pwa-delete" onClick={remove}><Icon name="trash" /> {t('app.detail.delete')}</button>}
    </div>
  );
}
