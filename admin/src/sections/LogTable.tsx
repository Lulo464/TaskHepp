import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui';
import { formatTime, logTag } from '../lib/format';
import type { LogEntry } from '../lib/types';

/** Event rows shared by the overview and the log section. */
export function LogTable({ entries, withHeader, onRetry }: { entries: LogEntry[]; withHeader?: boolean; onRetry?: (id: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="table-wrap">
      <table className="table">
        {withHeader && (
          <thead>
            <tr>
              <th>{t('log.col.time')}</th>
              <th>{t('log.col.dir')}</th>
              <th>{t('log.col.event')}</th>
              <th>{t('log.col.status')}</th>
              {onRetry && <th />}
            </tr>
          </thead>
        )}
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td>{formatTime(e.at)}</td>
              <td className="dir">
                <Icon name={e.direction === 'in' ? 'arrow-right' : 'arrow-left'} />
                {t(e.direction === 'in' ? 'common.dirIn' : 'common.dirOut')}
              </td>
              <td>{e.message}</td>
              <td><span className={`tag ${logTag[e.status]}`}>{t(`logStatus.${e.status}`)}</span></td>
              {onRetry && (
                <td className="right">
                  {e.retryable && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRetry(e.id)}>
                      <Icon name="arrow-clockwise" /> {t('log.retry')}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {entries.length === 0 && <tr><td colSpan={5} className="empty">{t('log.empty')}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
