import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { useApi } from '../../lib/api';
import type { Me, Ticket } from '../../lib/types';
import { useMyAreas } from '../areas';
import type { Timers } from '../timer';
import { AreaFilter } from './AreaFilter';
import { TicketRow } from './TicketRow';

type Filter = 'all' | 'mine' | 'ha' | 'mail' | 'done';

export function TicketList({ timers, canEdit, selectedId }: { timers: Timers; canEdit: boolean; selectedId?: number }) {
  const { t } = useTranslation();
  const tickets = useApi<Ticket[]>('/api/tickets');
  const me = useApi<Me>('/api/me');
  const areas = useMyAreas();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const chips: { value: Filter; label: React.ReactNode }[] = [
    { value: 'all', label: t('common.all') },
    { value: 'mine', label: <><Icon name="user" /> {t('app.assignee.mine')}</> },
    { value: 'ha', label: <><Icon name="house-line" /> HA</> },
    { value: 'mail', label: <><Icon name="envelope-simple" /> Mail</> },
    { value: 'done', label: t('status.done') },
  ];
  const rows = (tickets ?? []).filter(x => !areas?.isHidden(x.areaId) &&
    (filter === 'done' ? x.status === 'done' : x.status !== 'done') &&
    (filter === 'all' || filter === 'done' || (filter === 'mine' ? x.assigneeId === me?.id : x.source === filter)) &&
    x.title.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="pwa-screen pwa-list">
      <h1 className="pwa-h1">{t('app.tab.tickets')}</h1>
      <AreaFilter />
      <input className="input pwa-search" type="search" placeholder={t('tickets.search')} value={query} onChange={e => setQuery(e.target.value)} aria-label={t('tickets.search')} />
      <div className="pwa-chips" role="tablist">
        {chips.map(c => (
          <button key={String(c.value)} type="button" role="tab" aria-selected={filter === c.value} className={`pwa-chip${filter === c.value ? ' is-active' : ''}`} onClick={() => setFilter(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      {!tickets ? <Loading /> : rows.map(x => <TicketRow key={x.id} ticket={x} timers={timers} canEdit={canEdit} showStatus showDue selected={x.id === selectedId} />)}
      {tickets && rows.length === 0 && <div className="pwa-empty">{t('tickets.empty')}</div>}
    </div>
  );
}
