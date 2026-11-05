import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './components/ui';
import { formatTracked, setExactTime } from './lib/format';
import type { MonitorData } from './lib/types';

/** Full-screen day view for a wall display or browser tab: /monitor?t=<token>[&area=<id>]. No login needed. */
export function MonitorDisplay() {
  const { t, i18n } = useTranslation();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t') ?? '';
  const area = params.get('area');
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number | undefined;
    const load = async () => {
      try {
        const res = await fetch(`/api/monitor/public?t=${encodeURIComponent(token)}${area ? `&area=${encodeURIComponent(area)}` : ''}`);
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
        const d = (await res.json()) as MonitorData;
        setData(d);
        setError(null);
        timer = window.setTimeout(load, d.interval * 1000);
      } catch (err) {
        setError((err as Error).message);
        timer = window.setTimeout(load, 30_000);
      }
    };
    void load();
    return () => window.clearTimeout(timer);
  }, [token, area]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!data) return <div className="monitor-screen"><div className="muted">{error ?? t('common.loading')}</div></div>;
  setExactTime(data.exactTime);

  const elapsed = data.timer ? Math.max(0, Math.floor((now.getTime() - new Date(data.timer.startedAt).getTime()) / 1000)) : 0;
  const hms = [Math.floor(elapsed / 3600), Math.floor((elapsed % 3600) / 60), elapsed % 60].map(n => String(n).padStart(2, '0')).join(':');

  return (
    <div className="monitor-screen">
      <div className="ms-head">
        {(data.widgets.clock || data.area) && (
          <div>
            {data.area && <div className="ms-area">{data.area}</div>}
            {data.widgets.clock && <>
            <div className="ms-date">{now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <div className="ms-clock">{now.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</div>
            </>}
          </div>
        )}
        <div className="ms-totals">
          <div><div className="ms-kicker">{t('display.trackedToday')}</div><div className="ms-total">{formatTracked({ minutes: data.todayMinutes, seconds: data.todaySeconds })}</div></div>
          <div><div className="ms-kicker">{t('display.stillOpen')}</div><div className="ms-total">{t('display.tickets', { count: data.openTickets })}</div></div>
        </div>
      </div>

      <div className="ms-grid">
        <div>
          {data.widgets.timer && (
            <>
              <div className="ms-kicker accent">{t('display.now')}</div>
              {data.timer ? (
                <div className="ms-now">
                  <div className="ms-now-title">{data.timer.title}</div>
                  <div className="ms-now-meta">
                    {data.timer.source === 'ha' && <><Icon name="house-line" /> </>}
                    {data.timer.area}{data.timer.source === 'ha' ? ' · Home Assistant' : ''}{data.timer.user ? ` · ${data.timer.user}` : ''}
                  </div>
                  <div className="ms-now-time">{hms}</div>
                </div>
              ) : <div className="ms-empty">{t('display.noTimer')}</div>}
            </>
          )}
          {data.widgets.haSensors && data.sensors.length > 0 && (
            <>
              <div className="ms-kicker" style={{ margin: '24px 0 8px' }}>{t('display.homeAssistant')}</div>
              <div className="ms-sensors">
                {data.sensors.map(s => (
                  <div key={s.entity}><Icon name="gauge" /> {s.name ?? s.entity} {s.state}{s.unit ? ` ${s.unit}` : ''}</div>
                ))}
              </div>
            </>
          )}
        </div>
        {data.widgets.next && (
          <div>
            <div className="ms-kicker">{t('display.next')}</div>
            {data.next.map(x => (
              <div key={x.id} className="ms-item">
                <div className="ms-item-at accent">{x.overdue ? t('due.overdue') : x.dueTime ?? (x.prio === 'high' ? t('prio.high') : t('due.today'))}</div>
                <div className="ms-item-title">{x.title}</div>
                <div className="ms-item-area">{x.area}</div>
              </div>
            ))}
            {data.next.length === 0 && <div className="ms-empty">{t('display.allDone')}</div>}
          </div>
        )}
        {data.widgets.later && (
          <div>
            <div className="ms-kicker">{t('display.later')}</div>
            {data.later.map(x => (
              <div key={x.id} className="ms-item">
                {x.dueTime && <div className="ms-item-at">{x.dueTime}</div>}
                <div className="ms-item-title soft">{x.title}</div>
                <div className="ms-item-area">{x.area}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <div className="ms-error">{t('display.offline')}</div>}
    </div>
  );
}
