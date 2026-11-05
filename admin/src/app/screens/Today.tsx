import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../../components/ui';
import { useApi } from '../../lib/api';
import { firstName, formatTime, formatTracked } from '../../lib/format';
import type { Me, MyTime, Ticket } from '../../lib/types';
import { href, navigate } from '../router';
import type { Timers } from '../timer';
import { useMyAreas } from '../areas';
import { AreaFilter } from './AreaFilter';
import { TicketRow } from './TicketRow';

const isoToday = () => new Date().toLocaleDateString('sv-SE');

export function Today({ me, timers, canEdit }: { me: Me; timers: Timers; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const tickets = useApi<Ticket[]>('/api/tickets?open=true');
  const time = useApi<MyTime>('/api/me/time');
  const areas = useMyAreas();
  const today = isoToday();

  // Overdue days first, then by time of day; tickets without a time after the timed ones.
  const due = (tickets?.filter(x => x.due && x.due <= today && !areas?.isHidden(x.areaId)) ?? [])
    .sort((a, b) => a.due!.localeCompare(b.due!) || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'));
  // Newest ticket Home Assistant created today, as in the design's HA card.
  const fromHa = tickets?.filter(x => x.source === 'ha' && !areas?.isHidden(x.areaId) && new Date(x.createdAt).toLocaleDateString('sv-SE') >= today).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return (
    <div className="pwa-screen pwa-wide">
      <div className="pwa-date">{new Date().toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1 className="pwa-h1" style={{ marginBottom: 12 }}>{t('app.today.hello', { name: firstName(me.name ?? null) })}</h1>
      <AreaFilter />

      <div className="pwa-today">
        <div className="pwa-hero">
          <div className="pwa-hero-top">
            <span>{t('app.today.tracked')}</span>
            {timers.timers.length > 0 && <span>{t('app.today.running')}</span>}
          </div>
          <div className="pwa-hero-value">{time ? formatTracked({ minutes: time.today.total, seconds: time.today.totalSeconds }) : '–'}</div>
          <div className="pwa-hero-areas">
            {time?.today.byArea.map(a => <span key={a.name}><Icon name={a.icon} /> {a.name} {formatTracked(a).replace(' h', '')}</span>)}
            {time && time.today.byArea.length === 0 && <span>{t('app.today.nothingTracked')}</span>}
          </div>
        </div>

        <div className="pwa-today-due">
          <div className="pwa-section-head">
            <span>{t('app.today.due')}</span>
            <a href={href({ name: 'tickets' })}>{t('app.today.allTickets')}</a>
          </div>
          {!tickets ? <Loading /> : due.map(x => <TicketRow key={x.id} ticket={x} timers={timers} canEdit={canEdit} showTime />)}
          {tickets && due.length === 0 && <div className="pwa-empty">{t('app.today.nothingDue')}</div>}
        </div>

        {fromHa && (
          <div className="pwa-ha-card" role="button" tabIndex={0} onClick={() => navigate({ name: 'ticket', id: fromHa.id })} onKeyDown={e => e.key === 'Enter' && navigate({ name: 'ticket', id: fromHa.id })}>
            <Icon name="house-line" />
            <div>
              <div className="pwa-ha-title">{t('app.today.fromHa')}</div>
              <div className="pwa-ha-text">{t('app.today.fromHaText', { title: fromHa.title, time: formatTime(fromHa.createdAt) })}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
