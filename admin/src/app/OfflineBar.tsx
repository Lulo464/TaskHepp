import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui';
import { useRefresh } from '../lib/api';
import { formatTime } from '../lib/format';
import { flush, getOfflineState, onSynced, subscribeOffline } from '../lib/offline';
import { showToast } from './toast';

const RETRY_MS = 20_000;

export const useOffline = () => useSyncExternalStore(subscribeOffline, getOfflineState);

/** Says when the app is offline or changes are still waiting, and sends them once Tasklog answers again. */
export function OfflineBar() {
  const { t } = useTranslation();
  const state = useOffline();
  const refresh = useRefresh();

  useEffect(() => {
    const stop = onSynced(({ sent, failed }) => {
      refresh();
      if (failed.length) showToast(t('app.offline.failed', { count: failed.length, error: failed[0] }));
      else if (sent) showToast(t('app.offline.synced', { count: sent }));
    });
    const sync = () => { if (getOfflineState().pending) void flush(); };
    const onOnline = () => { refresh(); sync(); };
    const onVisible = () => document.visibilityState === 'visible' && sync();
    sync();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(sync, RETRY_MS);
    return () => {
      stop();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [refresh, t]);

  // Back online: send what waited.
  useEffect(() => {
    if (!state.offline && state.pending) void flush();
  }, [state.offline, state.pending]);

  if (!state.offline && !state.pending) return null;
  const waiting = state.pending ? t('app.offline.pending', { count: state.pending }) : '';
  return (
    <div className={`pwa-offline${state.offline ? ' is-offline' : ''}`} role="status">
      <Icon name={state.offline ? 'cloud-slash' : 'cloud-arrow-up'} />
      <span className="grow">
        {state.offline
          ? [t('app.offline.offline'), state.dataFrom ? t('app.offline.dataFrom', { time: formatTime(state.dataFrom) }) : '', waiting].filter(Boolean).join(' · ')
          : state.syncing ? t('app.offline.syncing', { count: state.pending }) : waiting}
      </span>
      {!state.syncing && state.pending > 0 && (
        <button type="button" className="btn btn-ghost" onClick={() => { refresh(); void flush(); }}>{t('app.offline.retry')}</button>
      )}
    </div>
  );
}
