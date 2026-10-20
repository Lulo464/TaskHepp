import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui';
import { isLogError, logTag } from '../lib/format';
import type { LogEntry } from '../lib/types';

/** Event rows shared by the overview and the log section. */
export function LogTable({ entries, withHeader, onRetry }: { entries: { entry: LogEntry; index: number }[]; withHeader?: boolean; onRetry?: (index: number) => void }) {
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
          {entries.map(({ entry: e, index }) => (
            <tr key={index}>
              <td>{e.time}</td>
              <td className="dir">
                <Icon name={e.dir === 'in' ? 'arrow-right' : 'arrow-left'} />
                {t(e.dir === 'in' ? 'common.dirIn' : 'common.dirOut')}
              </td>
              <td>{e.what}</td>
              <td><span className={`tag ${logTag[e.status]}`}>{t(`logStatus.${e.status}`)}</span></td>
              {onRetry && (
                <td className="right">
                  {isLogError(e.status) && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRetry(index)}>
                      <Icon name="arrow-clockwise" /> {t('log.retry')}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
