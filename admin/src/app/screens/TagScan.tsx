import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { del, patch, post, useAction, useRefresh } from '../../lib/api';
import type { TagScan as Scan } from '../../lib/types';
import { href, navigate } from '../router';

const ICONS: Record<Scan['result'], string> = {
  done: 'check-circle', alreadyDone: 'check-circle', started: 'play-circle', stopped: 'stop-circle',
  created: 'plus-circle', exists: 'info', missing: 'warning-circle',
};

/** The phone read a tag and opened #/tag/<code>: run it once and say what happened. */
export function TagScan({ code }: { code: string }) {
  const { t } = useTranslation();
  const refresh = useRefresh();
  const act = useAction();
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // Reloading the page or coming back to it must not scan again.
    window.history.replaceState(null, '', href({ name: 'tags' }));
    post<Scan>(`/api/tags/scan/${encodeURIComponent(code)}`)
      .then(s => { setScan(s); navigator.vibrate?.(30); refresh(); })
      .catch((err: Error) => setError(err.message));
  }, [code, refresh]);

  const undo = async () => {
    if (!scan?.ticketId) return;
    const ok = await act(async () => {
      if (scan.result === 'done') {
        // The tag goes back to this ticket before the next one of the series disappears again.
        await patch(`/api/tags/${scan.tagId}`, { ticketId: scan.ticketId });
        if (scan.followupId) await del(`/api/tickets/${scan.followupId}`);
        await patch(`/api/tickets/${scan.ticketId}`, { status: 'open' });
      } else if (scan.result === 'started') {
        await post('/api/timer/stop', { ticketId: scan.ticketId });
      } else if (scan.result === 'created') {
        await del(`/api/tickets/${scan.ticketId}`);
      }
      return true;
    });
    if (ok) setUndone(true);
  };

  if (!scan && !error) return <div className="pwa-screen"><Loading /></div>;
  const canUndo = scan && !undone && (scan.result === 'done' || scan.result === 'started' || scan.result === 'created');

  return (
    <div className="pwa-screen pwa-scan">
      {error ? (
        <>
          <Icon name="warning-circle" className="pwa-scan-icon is-error" />
          <h1 className="pwa-h1">{t('app.tags.scanFailed')}</h1>
          <p className="pwa-date">{error}</p>
        </>
      ) : scan && (
        <>
          <Icon name={undone ? 'arrow-counter-clockwise' : ICONS[scan.result]} fill className={`pwa-scan-icon${scan.result === 'missing' ? ' is-error' : ''}`} />
          <div className="pwa-kicker">{scan.tag}</div>
          <h1 className="pwa-h1">{undone ? t('app.tags.undone') : t(`app.tags.result.${scan.result}`, { title: scan.title ?? '' })}</h1>
          {!undone && scan.result === 'done' && scan.followupId && <p className="pwa-date">{t('app.tags.nextCreated')}</p>}
        </>
      )}
      <div className="stack pwa-scan-actions">
        {scan?.ticketId && !(undone && scan.result === 'created') && (
          <a className="btn btn-secondary btn-block" href={href({ name: 'ticket', id: scan.ticketId })}>
            <Icon name="arrow-right" /> {t('app.tags.openTicket')}
          </a>
        )}
        {canUndo && <button type="button" className="btn btn-ghost btn-block" onClick={undo}><Icon name="arrow-counter-clockwise" /> {t('app.tags.undo')}</button>}
        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate({ name: 'today' })}><Icon name="check" /> {t('app.tags.close')}</button>
      </div>
    </div>
  );
}
