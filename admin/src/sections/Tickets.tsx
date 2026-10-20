import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Seg } from '../components/ui';
import { formatHours, nextStatus, ticketTag } from '../lib/format';
import { useStore } from '../lib/store';

const HA_FILTER = '__ha';
const ALL = '__all';

export function Tickets() {
  const { t } = useTranslation();
  const { state, update } = useStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(ALL);
  const [picked, setPicked] = useState<number[]>([]);

  const filters = [
    { value: ALL, label: t('common.all') },
    ...state.areas.map(a => ({ value: a.name, label: a.name })),
    { value: HA_FILTER, label: t('tickets.filterHa') },
  ];
  const rows = state.tickets.filter(x =>
    (filter === ALL || (filter === HA_FILTER ? x.fromHa : x.area === filter)) &&
    x.title.toLowerCase().includes(query.toLowerCase()));

  const togglePick = (id: number) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const bulkDone = () => {
    update(s => ({ tickets: s.tickets.map(x => (picked.includes(x.id) ? { ...x, status: 'done' as const } : x)) }));
    setPicked([]);
  };
  const bulkDelete = () => {
    update(s => ({ tickets: s.tickets.filter(x => !picked.includes(x.id)) }));
    setPicked([]);
  };
  const cycle = (id: number) => update(s => ({ tickets: s.tickets.map(x => (x.id === id ? { ...x, status: nextStatus[x.status] } : x)) }));

  return (
    <>
      <div className="toolbar">
        <input className="input" style={{ width: 240 }} placeholder={t('tickets.search')} value={query} onChange={e => setQuery(e.target.value)} aria-label={t('tickets.search')} />
        <Seg options={filters} value={filter} onChange={setFilter} />
        <div className="spacer" />
        {picked.length > 0 && (
          <>
            <span className="soft" style={{ fontSize: 13 }}>{t('tickets.selected', { count: picked.length })}</span>
            <button type="button" className="btn btn-secondary" onClick={bulkDone}><Icon name="check" /> {t('tickets.markDone')}</button>
            <button type="button" className="btn btn-ghost" onClick={bulkDelete}><Icon name="trash" /> {t('common.delete')}</button>
          </>
        )}
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
              <th className="right">{t('tickets.col.time')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(x => {
              const isPicked = picked.includes(x.id);
              return (
                <tr key={x.id}>
                  <td>
                    <button type="button" className="icon-btn" role="checkbox" aria-checked={isPicked} aria-label={t('tickets.select')} onClick={() => togglePick(x.id)}>
                      <Icon name={isPicked ? 'check-square' : 'square'} fill={isPicked} />
                    </button>
                  </td>
                  <td>
                    {x.title}{' '}
                    {x.fromHa && <i className="ph ph-house-line accent" title={t('tickets.fromHa')} />}
                  </td>
                  <td className="soft">{x.area} / {x.project}</td>
                  <td>
                    <button type="button" className={`tag ${ticketTag[x.status]}`} title={t('tickets.cycleStatus')} onClick={() => cycle(x.id)}>
                      {t(`status.${x.status}`)}
                    </button>
                  </td>
                  <td>{t(`prio.${x.prio}`)}</td>
                  <td>{x.assignee}</td>
                  <td>{x.due}</td>
                  <td className="right">{formatHours(x.hours)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="empty">{t('tickets.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
