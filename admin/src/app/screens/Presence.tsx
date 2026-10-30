import { useTranslation } from 'react-i18next';
import { Icon, Loading, Switch } from '../../components/ui';
import { del, patch, post, useAction, useApi } from '../../lib/api';
import { useMyAreas } from '../areas';
import { href } from '../router';
import { showToast } from '../toast';

interface Rule {
  id: number;
  personEntity: string;
  zone: string;
  areaId: number | null;
  notifyService: string;
  includeUndated: boolean;
  enabled: boolean;
  lastState: string | null;
}

interface Options {
  configured: boolean;
  persons: { id: string; name: string; state: string }[];
  zones: { value: string; name: string }[];
  notify: string[];
}

/** "Bei Ankunft erinnern": when a Home Assistant person reaches a zone, its user gets what is due there. */
export function Presence() {
  const { t } = useTranslation();
  const rules = useApi<Rule[]>('/api/me/presence');
  const options = useApi<Options>('/api/me/presence/options');
  const areas = useMyAreas();
  const act = useAction();

  const back = <a className="btn btn-ghost pwa-back" href={href({ name: 'more' })}><Icon name="caret-left" /> {t('app.more.title')}</a>;
  if (!rules || !options || !areas) return <div className="pwa-screen">{back}<Loading /></div>;

  const update = (r: Rule, change: Partial<Rule>) => act(() => patch(`/api/me/presence/${r.id}`, change));
  const add = () => {
    const home = areas.all.find(a => /zuhause|daheim|haus/i.test(a.name));
    void act(() => post('/api/me/presence', {
      personEntity: options.persons[0].id,
      zone: 'home',
      areaId: home?.id ?? null,
      notifyService: options.notify[0] ?? 'notify',
      includeUndated: false,
      enabled: true,
    }));
  };
  const test = async (r: Rule) => {
    const res = await act(() => post<{ tickets: number }>(`/api/me/presence/${r.id}/test`));
    if (res) showToast(t('app.presence.tested', { count: res.tickets, service: r.notifyService }));
  };
  const zoneName = (v: string) => options.zones.find(z => z.value === v)?.name ?? v;
  const stateText = (state: string) => (state === 'home' ? t('app.presence.atHome') : state === 'not_home' ? t('app.presence.away') : state);

  return (
    <div className="pwa-screen">
      {back}
      <h1 className="pwa-h1" style={{ margin: '10px 0 6px' }}>{t('app.presence.title')}</h1>
      <p className="pwa-date" style={{ margin: '0 0 16px' }}>{t('app.presence.intro')}</p>

      {!options.configured && <div className="card pwa-card pwa-row-meta">{t('app.presence.noHa')}</div>}
      {options.configured && options.persons.length === 0 && <div className="card pwa-card pwa-row-meta">{t('app.presence.noPersons')}</div>}

      {rules.map(r => {
        // Persons, zones or services that were removed in Home Assistant stay selectable as they are.
        const persons = options.persons.some(p => p.id === r.personEntity) ? options.persons : [...options.persons, { id: r.personEntity, name: r.personEntity, state: '' }];
        const zones = options.zones.some(z => z.value === r.zone) ? options.zones : [...options.zones, { value: r.zone, name: r.zone }];
        const services = options.notify.includes(r.notifyService) ? options.notify : [...options.notify, r.notifyService];
        const person = persons.find(p => p.id === r.personEntity);
        return (
          <div key={r.id} className={`card pwa-card pwa-presence${r.enabled ? '' : ' is-off'}`} style={{ marginBottom: 12 }}>
            <button type="button" role="switch" aria-checked={r.enabled} className="pwa-rule pwa-presence-head" onClick={() => update(r, { enabled: !r.enabled })}>
              <span className="grow">
                <span className="pwa-rule-name">{t('app.presence.summary', { person: person?.name ?? r.personEntity, zone: zoneName(r.zone) })}</span>
                {person?.state && <span className="pwa-row-meta">{t('app.presence.now', { state: stateText(person.state) })}</span>}
              </span>
              <Switch on={r.enabled} />
            </button>
            <label className="pwa-presence-field">
              <span>{t('app.presence.person')}</span>
              <select className="input" value={r.personEntity} onChange={e => update(r, { personEntity: e.target.value })}>
                {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="pwa-presence-field">
              <span>{t('app.presence.zone')}</span>
              <select className="input" value={r.zone} onChange={e => update(r, { zone: e.target.value })}>
                {zones.map(z => <option key={z.value} value={z.value}>{z.name}</option>)}
              </select>
            </label>
            <label className="pwa-presence-field">
              <span>{t('app.presence.area')}</span>
              <select className="input" value={r.areaId ?? 0} onChange={e => update(r, { areaId: Number(e.target.value) || null })}>
                <option value={0}>{t('app.calendar.allAreas')}</option>
                {areas.all.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="pwa-presence-field">
              <span>{t('app.presence.notify')}</span>
              <select className="input mono" value={r.notifyService} onChange={e => update(r, { notifyService: e.target.value })}>
                {services.map(s => <option key={s} value={s}>notify.{s}</option>)}
              </select>
            </label>
            <label className="pwa-repeat-check">
              <input type="checkbox" checked={r.includeUndated} onChange={e => update(r, { includeUndated: e.target.checked })} />
              {t('app.presence.undated')}
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => void test(r)}><Icon name="paper-plane-tilt" /> {t('app.presence.test')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => window.confirm(t('app.presence.deleteConfirm')) && act(() => del(`/api/me/presence/${r.id}`))}>
                <Icon name="trash" /> {t('app.presence.delete')}
              </button>
            </div>
          </div>
        );
      })}

      {options.configured && options.persons.length > 0 && (
        <button type="button" className="btn btn-secondary btn-block" onClick={add}><Icon name="plus" /> {t('app.presence.add')}</button>
      )}
      <p className="pwa-label" style={{ marginTop: 16, lineHeight: 1.5 }}>{t('app.presence.how')}</p>
    </div>
  );
}
