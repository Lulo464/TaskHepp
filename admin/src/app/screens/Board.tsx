import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { patch, useAction, useApi } from '../../lib/api';
import { formatDue, isOverdue } from '../../lib/format';
import type { Me, Ticket, TicketStatus } from '../../lib/types';
import { useMyAreas } from '../areas';
import { usePointerDrag } from '../drag';
import { href, navigate } from '../router';
import { showToast } from '../toast';
import { AreaFilter } from './AreaFilter';

const COLUMNS: TicketStatus[] = ['open', 'inProgress', 'done'];
/** Done tickets stay on the board this long, so the column does not grow forever. */
const DONE_DAYS = 14;
const VIEW_KEY = 'tasklog-ticket-view';

/** Remembers whether "Tickets" opens the list or the board. */
export function rememberView(view: 'tickets' | 'board') {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode: fine */ }
}
export function preferredView(): 'tickets' | 'board' {
  try { return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'tickets'; } catch { return 'tickets'; }
}

function Card({ ticket, onPointerDown, dragging, justDropped }: {
  ticket: Ticket; onPointerDown?: (e: React.PointerEvent) => void; dragging: boolean; justDropped: React.MutableRefObject<boolean>;
}) {
  const { t } = useTranslation();
  const overdue = ticket.status !== 'done' && isOverdue(ticket.due, ticket.dueTime);
  const open = () => { if (!justDropped.current) navigate({ name: 'ticket', id: ticket.id }); };
  return (
    <div
      className={`pwa-card-ticket${dragging ? ' is-dragging' : ''}${ticket.prio === 'high' ? ' is-high' : ''}`}
      role="button" tabIndex={0} onPointerDown={onPointerDown} onClick={open} onKeyDown={e => e.key === 'Enter' && open()}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="pwa-card-title">
        {ticket.running && <span className="dot" aria-label={t('tickets.running')} />}
        {ticket.title}
      </div>
      <div className="pwa-card-meta">
        <span>{ticket.area}</span>
        {ticket.due && <span className={overdue ? 'is-overdue' : undefined}><Icon name="calendar-blank" /> {overdue ? t('due.overdue') : formatDue(ticket.due, ticket.dueTime)}</span>}
        {ticket.checkTotal > 0 && <span>☑ {ticket.checkDone}/{ticket.checkTotal}</span>}
        {ticket.prio === 'high' && <span className="is-high"><Icon name="flag" fill /> {t('prio.high')}</span>}
        <span className="grow" />
        {ticket.assignee && <span className="avatar pwa-card-avatar" title={ticket.assignee}>{ticket.assignee.charAt(0).toUpperCase()}</span>}
      </div>
    </div>
  );
}

/** Kanban: Offen · In Arbeit · Erledigt. Dragging a card to another column changes its status. */
export function Board({ me, canEdit }: { me: Me; canEdit: boolean }) {
  const { t } = useTranslation();
  const tickets = useApi<Ticket[]>('/api/tickets');
  const areas = useMyAreas();
  const act = useAction();
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState('');

  const move = (id: number, status: string) => {
    const ticket = tickets?.find(x => x.id === id);
    if (!ticket || ticket.status === status) return;
    const before = ticket.status;
    void act(() => patch(`/api/tickets/${id}`, { status })).then(ok => {
      if (ok) showToast(t('app.board.moved', { title: ticket.title, status: t(`status.${status}`) }), { label: t('snooze.undo'), run: () => void act(() => patch(`/api/tickets/${id}`, { status: before })) });
    });
  };
  const { drag, begin, justDropped } = usePointerDrag(['.pwa-content', '.pwa-board'], move);

  if (!tickets || !areas) return <div className="pwa-screen"><Loading /></div>;

  const since = Date.now() - DONE_DAYS * 86_400_000;
  const shown = tickets.filter(x => !areas.isHidden(x.areaId) &&
    (!mine || x.assigneeId === me.id) &&
    x.title.toLowerCase().includes(query.trim().toLowerCase()) &&
    (x.status !== 'done' || (x.doneAt !== null && Date.parse(x.doneAt) >= since)));
  const column = (status: TicketStatus) => {
    const list = shown.filter(x => x.status === status);
    return status === 'done' ? list.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')) : list;
  };

  return (
    <div className="pwa-screen pwa-board-screen">
      <div className="pwa-board-head">
        <h1 className="pwa-h1">{t('app.tab.tickets')}</h1>
        <a className="btn btn-ghost" href={href({ name: 'tickets' })} onClick={() => rememberView('tickets')}><Icon name="list-bullets" /> {t('app.board.list')}</a>
      </div>
      <AreaFilter />
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <input className="input pwa-search grow" style={{ margin: 0 }} type="search" placeholder={t('tickets.search')} value={query} onChange={e => setQuery(e.target.value)} aria-label={t('tickets.search')} />
        <button type="button" className={`pwa-chip${mine ? ' is-active' : ''}`} aria-pressed={mine} onClick={() => setMine(m => !m)}><Icon name="user" /> {t('app.assignee.mine')}</button>
      </div>
      <div className={`pwa-board${drag ? ' is-dragging' : ''}`} role="list">
        {COLUMNS.map(status => {
          const cards = column(status);
          return (
            <section key={status} role="listitem" aria-label={t(`status.${status}`)} data-drop={status}
              className={`pwa-board-col is-${status}${drag && drag.over === status ? ' is-drop' : ''}`}>
              <header className="pwa-board-col-head">
                <span>{t(`status.${status}`)}</span>
                <span className="pwa-num soft">{cards.length}</span>
              </header>
              <div className="pwa-board-cards">
                {cards.map(x => (
                  <Card key={x.id} ticket={x} dragging={drag?.id === x.id} justDropped={justDropped}
                    onPointerDown={canEdit ? e => begin(e, x.id, x.title) : undefined} />
                ))}
                {cards.length === 0 && <div className="pwa-board-empty">{canEdit ? t('app.board.dropHere') : t('app.board.empty')}</div>}
              </div>
              {status === 'done' && <footer className="pwa-row-meta pwa-board-foot">{t('app.board.doneHint', { days: DONE_DAYS })}</footer>}
            </section>
          );
        })}
      </div>
      {drag && <div className="pwa-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">{drag.title}</div>}
    </div>
  );
}
