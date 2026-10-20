import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { LogTable } from './LogTable';

export function Overview() {
  const { t } = useTranslation();
  const { state } = useStore();
  const open = state.tickets.filter(x => x.status !== 'done');
  const activeRules = state.rules.filter(r => r.enabled).length;

  const stats = [
    { label: t('overview.openTickets'), value: String(open.length), note: t('overview.dueToday', { count: open.filter(x => x.due === 'Heute').length }) },
    { label: t('overview.fromHa'), value: '27', note: t('overview.last30Days') },
    { label: t('overview.activeRules'), value: String(activeRules), note: t('overview.ofTotal', { total: state.rules.length }) },
    { label: t('overview.webhook'), value: t('overview.webhookOk'), note: t('overview.lastCall', { time: '07:12' }) },
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
      <LogTable entries={state.logs.slice(0, 5).map((entry, index) => ({ entry, index }))} />
    </>
  );
}
