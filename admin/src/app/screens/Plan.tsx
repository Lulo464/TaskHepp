import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { patch, useAction, useApi } from '../../lib/api';
import { describeRecurrence } from '../../lib/recurrence';
import type { Me, Ticket } from '../../lib/types';
import { useMyAreas } from '../areas';
import { usePointerDrag } from '../drag';
import { AreaFilter } from './AreaFilter';
import { Snooze } from './Snooze';
import { navigate } from '../router';

const DAYS = 7;
const UNPLANNED = 'none';
const iso = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** Timed tickets first by time, then high priority, then the rest. */
const byTime = (a: Ticket, b: Ticket) =>
  (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') || Number(b.prio === 'high') - Number(a.prio === 'high') || a.id - b.id;

/** Planning: open tickets by day for the next days, overdue ones above, unplanned ones beside. Drag or pick a date to move. */
export function Plan({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const tickets = useApi<Ticket[]>('/api/tickets?open=true');
  const areas = useMyAreas();
  const act = useAction();
  const [page, setPage] = useState(0);
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState('');
  const [poolOpen, setPoolOpen] = useState(true);

  const move = (id: number, due: string | null) => {
    const ticket = tickets?.find(x => x.id === id);
    if (!ticket || ticket.due === due) return;
    // Without a date a time makes no sense.
    void act(() => patch(`/api/tickets/${id}`, due ? { due } : { due: null, dueTime: null }));
  };
  const { drag, begin, justDropped } = usePointerDrag('.pwa-content', (id, target) => move(id, target === UNPLANNED ? null : target));

  if (!tickets || !areas) return <div className="pwa-screen"><Loading /></div>;

  const now = new Date();
  const today = iso(now);
  const days = Array.from({ length: DAYS }, (_, i) => iso(addDays(now, page * DAYS + i)));
  const shown = tickets.filter(x => !areas.isHidden(x.areaId) && (!mine || x.assigneeId === me.id));
  const overdue = shown.filter(x => x.due && x.due < today).sort((a, b) => a.due!.localeCompare(b.due!) || byTime(a, b));
  const undated = shown.filter(x => !x.due).sort(byTime);
  const pool = undated.filter(x => x.title.toLowerCase().includes(query.trim().toLowerCase()));
  const later = shown.filter(x => x.due && x.due > days[DAYS - 1]).length;
  const canEdit = me.role !== 'read';

  const zone = (key: string) => ({ 'data-drop': key, className: drag?.over === key ? ' is-drop' : '' });
  const item = (x: Ticket, showDate = false) => (
    <PlanItem key={x.id} ticket={x} showDate={showDate} canEdit={canEdit} onMove={move}
      onPointerDown={canEdit ? e => begin(e, x.id, x.title) : undefined} dragging={drag?.id === x.id} justDropped={justDropped} />
  );
  const dayLabel = (d: string) => {
    const diff = Math.round((parse(d).getTime() - parse(today).getTime()) / 86_400_000);
    return diff === 0 ? t('due.today') : diff === 1 ? t('due.tomorrow') : parse(d).toLocaleDateString(i18n.language, { weekday: 'long' });
  };

  return (
    <div className={`pwa-screen pwa-wide pwa-plan${drag ? ' is-dragging' : ''}`}>
      <h1 className="pwa-h1" style={{ marginBottom: 4 }}>{t('app.plan.title')}</h1>
      <div className="pwa-plan-nav">
        <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.plan.earlier')} disabled={page === 0} onClick={() => setPage(p => p - 1)}><Icon name="caret-left" /></button>
        <span className="pwa-date">
          {page === 0 ? t('app.plan.nextDays', { n: DAYS }) : `${parse(days[0]).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })} – ${parse(days[DAYS - 1]).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}`}
        </span>
        <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.plan.later')} onClick={() => setPage(p => p + 1)}><Icon name="caret-right" /></button>
        {page > 0 && <button type="button" className="btn btn-ghost" onClick={() => setPage(0)}>{t('due.today')}</button>}
        <span className="grow" />
        <div className="pwa-chips" role="tablist" style={{ margin: 0 }}>
          <button type="button" role="tab" aria-selected={!mine} className={`pwa-chip${!mine ? ' is-active' : ''}`} onClick={() => setMine(false)}>{t('common.all')}</button>
          <button type="button" role="tab" aria-selected={mine} className={`pwa-chip${mine ? ' is-active' : ''}`} onClick={() => setMine(true)}><Icon name="user" /> {t('app.assignee.mine')}</button>
        </div>
      </div>
      <AreaFilter />
      {canEdit && <p className="pwa-label pwa-plan-hint">{t('app.plan.hint')}</p>}

      <div className="pwa-plan-layout">
        <aside className={`pwa-plan-day pwa-plan-pool${zone(UNPLANNED).className}`} data-drop={UNPLANNED} aria-label={t('app.plan.undated')}>
          <button type="button" className="pwa-plan-head pwa-plan-pool-toggle" aria-expanded={poolOpen} onClick={() => setPoolOpen(o => !o)}>
            <span><Icon name="tray" /> {t('app.plan.undated')}</span>
            <span className="pwa-label">{undated.length || ''} <Icon name={poolOpen ? 'caret-up' : 'caret-down'} className="pwa-plan-pool-caret" /></span>
          </button>
          <div className={`pwa-plan-pool-body${poolOpen ? '' : ' is-closed'}`}>
            {undated.length > 5 && (
              <input className="input pwa-plan-search" type="search" placeholder={t('tickets.search')} aria-label={t('tickets.search')} value={query} onChange={e => setQuery(e.target.value)} />
            )}
            <div className="pwa-plan-pool-list">
              {pool.map(x => item(x))}
              {undated.length === 0 && <div className="pwa-plan-free">{t('app.plan.allPlanned')}</div>}
            </div>
          </div>
        </aside>

        <div className="pwa-plan-main">
          {page === 0 && overdue.length > 0 && (
            <section className="pwa-plan-day is-overdue">
              <div className="pwa-plan-head"><span>{t('due.overdue')}</span><span className="pwa-label">{overdue.length}</span></div>
              {overdue.map(x => item(x, true))}
            </section>
          )}
          <div className="pwa-plan-grid">
            {days.map(d => {
              const list = shown.filter(x => x.due === d).sort(byTime);
              return (
                <section key={d} data-drop={d} className={`pwa-plan-day${d === today ? ' is-today' : ''}${zone(d).className}`}>
                  <div className="pwa-plan-head">
                    <span>{dayLabel(d)} <span className="pwa-label">{parse(d).toLocaleDateString(i18n.language, { day: 'numeric', month: 'numeric' })}</span></span>
                    <span className="pwa-label">{list.length || ''}</span>
                  </div>
                  {list.map(x => item(x))}
                  {list.length === 0 && <div className="pwa-plan-free">{t(drag ? 'app.plan.dropHere' : 'app.plan.free')}</div>}
                </section>
              );
            })}
          </div>
          {later > 0 && <p className="pwa-label" style={{ marginTop: 8 }}>{t('app.plan.laterCount', { count: later })}</p>}
        </div>
      </div>

      {drag && <div className="pwa-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">{drag.title}</div>}
    </div>
  );
}

function PlanItem({ ticket, showDate, canEdit, onMove, onPointerDown, dragging, justDropped }: {
  ticket: Ticket; showDate: boolean; canEdit: boolean; onMove: (id: number, due: string | null) => void;
  onPointerDown?: (e: React.PointerEvent) => void; dragging: boolean; justDropped: React.RefObject<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  const open = () => { if (!justDropped.current) navigate({ name: 'ticket', id: ticket.id }); };
  const when = [
    showDate && ticket.due && parse(ticket.due).toLocaleDateString(i18n.language, { day: 'numeric', month: 'numeric' }),
    ticket.dueTime,
  ].filter(Boolean).join(' ');

  return (
    <div className={`pwa-plan-item${dragging ? ' is-dragging' : ''}${canEdit ? ' can-drag' : ''}`}>
      <div className="grow" role="button" tabIndex={0} onClick={open} onKeyDown={e => e.key === 'Enter' && open()}
        onPointerDown={onPointerDown} onContextMenu={canEdit ? e => e.preventDefault() : undefined}>
        <div className="pwa-row-title pwa-wrap">
          {when && <span className="accent pwa-num">{when} </span>}
          {ticket.prio === 'high' && <Icon name="arrow-up" className="accent" />} {ticket.recurrence && <i className="ph ph-arrows-clockwise accent" aria-label={describeRecurrence(ticket.recurrence)} title={describeRecurrence(ticket.recurrence)} />} {ticket.title}
        </div>
        <div className="pwa-row-meta pwa-wrap">{ticket.area}{ticket.assignee ? ` · ${ticket.assignee}` : ''}{ticket.checkTotal ? ` · ☑ ${ticket.checkDone}/${ticket.checkTotal}` : ''}</div>
      </div>
      {canEdit && <Snooze ticket={ticket} />}
      {canEdit && (
        <span className="pwa-plan-move">
          <button type="button" className="btn btn-icon btn-ghost" aria-label={t('app.plan.move', { title: ticket.title })} title={t('app.plan.move', { title: ticket.title })}
            onClick={() => { try { picker.current?.showPicker(); } catch { picker.current?.focus(); } }}>
            <Icon name="calendar-dots" />
          </button>
          <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" value={ticket.due ?? ''} onChange={e => onMove(ticket.id, e.target.value || null)} />
        </span>
      )}
    </div>
  );
}
