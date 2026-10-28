import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { patch, useAction, useApi } from '../../lib/api';
import type { Me, Person, Ticket } from '../../lib/types';

/** Who works on the ticket; members pick someone else, themselves or nobody. */
export function Assignee({ ticket, canEdit }: { ticket: Ticket; canEdit: boolean }) {
  const { t } = useTranslation();
  const people = useApi<Person[]>(canEdit ? '/api/people' : null);
  const me = useApi<Me>('/api/me');
  const act = useAction();

  if (!canEdit || !people) {
    return ticket.assignee ? <p className="pwa-row-meta" style={{ margin: '-10px 0 18px' }}><Icon name="user" /> {ticket.assignee}</p> : null;
  }
  const assign = (assigneeId: number | null) => act(() => patch(`/api/tickets/${ticket.id}`, { assigneeId }));
  // Keep a former member that can no longer be picked visible as the current value.
  const options = ticket.assigneeId && !people.some(p => p.id === ticket.assigneeId)
    ? [...people, { id: ticket.assigneeId, name: ticket.assignee ?? `#${ticket.assigneeId}` }]
    : people;

  return (
    <div className="pwa-assignee">
      <Icon name="user" />
      <select className="input" aria-label={t('app.assignee.label')} value={ticket.assigneeId ?? ''} onChange={e => assign(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{t('app.assignee.nobody')}</option>
        {options.map(p => <option key={p.id} value={p.id}>{p.id === me?.id ? t('app.assignee.me', { name: p.name }) : p.name}</option>)}
      </select>
      {me?.id && ticket.assigneeId !== me.id && (
        <button type="button" className="btn btn-ghost" onClick={() => assign(me.id!)}>{t('app.assignee.takeOver')}</button>
      )}
    </div>
  );
}
