import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { formatDue, formatMinutes, isOverdue } from '../../lib/format';
import type { Ticket } from '../../lib/types';
import { navigate } from '../router';
import type { Timers } from '../timer';

const dotColor = (t: Ticket) =>
  t.status === 'done' ? 'var(--color-neutral-600)' : t.status === 'inProgress' ? 'var(--color-accent)' : 'var(--color-neutral-400)';

/** One ticket with status dot, meta line and play/pause. */
export function TicketRow({ ticket, timers, canEdit, showStatus, showDue, showTime, selected }: { ticket: Ticket; timers: Timers; canEdit: boolean; showStatus?: boolean; showDue?: boolean; showTime?: boolean; selected?: boolean }) {
  const { t } = useTranslation();
  const running = Boolean(timers.runningFor(ticket.id));
  const meta = [
    ticket.area,
    showStatus && t(`status.${ticket.status}`),
    showDue && ticket.due && formatDue(ticket.due, ticket.dueTime),
    showTime && (isOverdue(ticket.due, ticket.dueTime) ? t('due.overdue') : ticket.dueTime),
    formatMinutes(ticket.minutes),
  ].filter(Boolean).join(' · ');

  return (
    <div className={`pwa-row${selected ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-current={selected || undefined} onClick={() => navigate({ name: 'ticket', id: ticket.id })} onKeyDown={e => e.key === 'Enter' && navigate({ name: 'ticket', id: ticket.id })}>
      <span className="dot" style={{ background: dotColor(ticket) }} />
      <div className="grow">
        <div className="pwa-row-title pwa-ellipsis">
          {ticket.source === 'ha' && <i className="ph ph-house-line accent" aria-label="Home Assistant" />}
          {ticket.source === 'mail' && <i className="ph ph-envelope-simple accent" aria-label="E-Mail" />} {ticket.title}
        </div>
        <div className="pwa-row-meta">{meta}</div>
      </div>
      {canEdit && ticket.status !== 'done' && (
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          aria-label={t(running ? 'app.stopTimer' : 'app.startTimer')}
          onClick={e => { e.stopPropagation(); void timers.toggle(ticket.id); }}
        >
          <Icon name={running ? 'pause' : 'play'} fill={running} />
        </button>
      )}
    </div>
  );
}
