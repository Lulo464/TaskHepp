import { useTranslation } from 'react-i18next';
import { Loading } from '../components/ui';
import { useApi } from '../lib/api';
import { formatTime } from '../lib/format';
import type { LogEntry, Overview as OverviewData } from '../lib/types';
import { LogTable } from './LogTable';

export function Overview() {
  const { t } = useTranslation();
  const data = useApi<OverviewData>('/api/overview');
  const logs = useApi<LogEntry[]>('/api/logs?limit=5');
  if (!data) return <Loading />;

  const stats = [
    { label: t('overview.openTickets'), value: String(data.openTickets), note: t('overview.dueToday', { count: data.dueToday }) },
    { label: t('overview.fromHa'), value: String(data.fromHa30d), note: t('overview.last30Days') },
    { label: t('overview.activeRules'), value: String(data.activeRules), note: t('overview.ofTotal', { total: data.totalRules }) },
    {
      label: t('overview.webhook'),
      value: data.webhook ? t(data.webhook.ok ? 'overview.webhookOk' : 'overview.webhookError') : '–',
      note: data.webhook ? t('overview.lastCall', { time: formatTime(data.webhook.lastAt) }) : t('overview.noCalls'),
    },
  ];

  return (
    <>
      <div className="stat-grid">
        {stats.map(s => (
          <div key={s.label} className="card pad">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-note">{s.note}</div>
          </div>
        ))}
      </div>
      <div className="section-title">{t('overview.recent')}</div>
      <LogTable entries={logs ?? []} />
    </>
  );
}
