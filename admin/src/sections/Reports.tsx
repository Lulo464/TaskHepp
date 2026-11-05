import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading, Seg } from '../components/ui';
import { useApi } from '../lib/api';
import { formatTracked } from '../lib/format';

type GroupBy = 'area' | 'project' | 'person';
type Range = 'week' | 'month';

export function Reports() {
  const { t } = useTranslation();
  const [groupBy, setGroupBy] = useState<GroupBy>('area');
  const [range, setRange] = useState<Range>('week');
  const query = `groupBy=${groupBy}&range=${range}`;
  const report = useApi<{ rows: { name: string; minutes: number; seconds: number }[]; total: number; totalSeconds: number }>(`/api/reports/time?${query}`);

  const max = report?.rows[0]?.minutes || 1;

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 22 }}>
        <Seg options={[{ value: 'area' as const, label: t('reports.byArea') }, { value: 'project' as const, label: t('reports.byProject') }, { value: 'person' as const, label: t('reports.byPerson') }]} value={groupBy} onChange={setGroupBy} />
        <Seg options={[{ value: 'week' as const, label: t('reports.week') }, { value: 'month' as const, label: t('reports.month') }]} value={range} onChange={setRange} />
        <div className="spacer" />
        <a className="btn btn-secondary" href={`/api/reports/time?${query}&format=csv`} download>
          <Icon name="download-simple" /> {t('reports.export')}
        </a>
      </div>
      {!report ? <Loading /> : (
        <div className="card" style={{ padding: 22, gap: 0 }}>
          <div className="stat-label" style={{ marginBottom: 4 }}>{t(range === 'week' ? 'reports.totalWeek' : 'reports.totalMonth')}</div>
          <div className="report-total">{formatTracked({ minutes: report.total, seconds: report.totalSeconds })}</div>
          {report.rows.map(r => (
            <div key={r.name} className="bar-row">
              <span>{r.name}</span>
              <span className="bar"><span className="bar-fill" style={{ width: `${Math.round((r.minutes / max) * 100)}%` }} /></span>
              <span className="soft" style={{ textAlign: 'right' }}>{formatTracked(r)}</span>
            </div>
          ))}
          {report.rows.length === 0 && <div className="muted">{t('reports.empty')}</div>}
        </div>
      )}
    </>
  );
}
