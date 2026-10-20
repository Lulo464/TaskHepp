import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Seg } from '../components/ui';
import { formatHours } from '../lib/format';
import { useStore } from '../lib/store';
import type { Ticket } from '../lib/types';

type GroupBy = 'area' | 'project' | 'assignee';
type Range = 'week' | 'month';

// Sample scaling until real time entries exist: ticket hours stand for one week.
const RANGE_FACTOR: Record<Range, number> = { week: 1, month: 4.2 };

function downloadCsv(rows: [string, number][], groupLabel: string) {
  const csv = [`${groupLabel};Stunden`, ...rows.map(([name, h]) => `"${name.replace(/"/g, '""')}";${h.toFixed(2)}`)].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'zeitbericht.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const { t } = useTranslation();
  const { state } = useStore();
  const [groupBy, setGroupBy] = useState<GroupBy>('area');
  const [range, setRange] = useState<Range>('week');

  const totals = new Map<string, number>();
  state.tickets.forEach((x: Ticket) => totals.set(x[groupBy], (totals.get(x[groupBy]) ?? 0) + x.hours * RANGE_FACTOR[range]));
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  const total = rows.reduce((sum, r) => sum + r[1], 0);

  const groupOptions = [
    { value: 'area' as const, label: t('reports.byArea') },
    { value: 'project' as const, label: t('reports.byProject') },
    { value: 'assignee' as const, label: t('reports.byPerson') },
  ];

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 22 }}>
        <Seg options={groupOptions} value={groupBy} onChange={setGroupBy} />
        <Seg options={[{ value: 'week' as const, label: t('reports.week') }, { value: 'month' as const, label: t('reports.month') }]} value={range} onChange={setRange} />
        <div className="spacer" />
        <button type="button" className="btn btn-secondary" onClick={() => downloadCsv(rows, groupOptions.find(o => o.value === groupBy)!.label)}>
          <Icon name="download-simple" /> {t('reports.export')}
        </button>
      </div>
      <div className="card" style={{ padding: 22, gap: 0 }}>
        <div className="stat-label" style={{ marginBottom: 4 }}>{t('reports.total')}</div>
        <div className="report-total">{formatHours(total)}</div>
        {rows.map(([name, hours]) => (
          <div key={name} className="bar-row">
            <span>{name}</span>
            <span className="bar"><span className="bar-fill" style={{ width: `${Math.round((hours / max) * 100)}%` }} /></span>
            <span className="soft" style={{ textAlign: 'right' }}>{formatHours(hours)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
