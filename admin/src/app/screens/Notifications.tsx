import { useTranslation } from 'react-i18next';
import { Icon, Loading, Switch } from '../../components/ui';
import { post, put, useAction, useApi } from '../../lib/api';
import { href } from '../router';
import { showToast } from '../toast';

const KINDS = ['dueSoon', 'dueToday', 'dailyDigest', 'assigned', 'haCreated', 'longTimer'] as const;
type Kind = (typeof KINDS)[number];

interface Prefs {
  targets: string[];
  kinds: Record<Kind, boolean>;
  haConfigured: boolean;
  devices: { id: string; name: string }[];
  personalActive: boolean;
}

/** Own notifications through Home Assistant: which devices, which kinds, and a test message. */
export function Notifications() {
  const { t } = useTranslation();
  const prefs = useApi<Prefs>('/api/me/notifications');
  const act = useAction();

  const back = <a className="btn btn-ghost pwa-back" href={href({ name: 'more' })}><Icon name="caret-left" /> {t('app.more.title')}</a>;
  if (!prefs) return <div className="pwa-screen">{back}<Loading /></div>;

  const save = (change: Partial<Pick<Prefs, 'targets' | 'kinds'>>) => act(() => put('/api/me/notifications', { targets: prefs.targets, kinds: prefs.kinds, ...change }));
  const toggleDevice = (id: string) => save({ targets: prefs.targets.includes(id) ? prefs.targets.filter(x => x !== id) : [...prefs.targets, id] });
  const test = async () => {
    const res = await act(() => post<{ sent: number }>('/api/me/notifications/test'));
    if (res) showToast(t('app.notify.tested', { count: res.sent }));
  };
  // Devices that disappeared in Home Assistant stay listed so they can be switched off.
  const devices = [...prefs.devices, ...prefs.targets.filter(id => !prefs.devices.some(d => d.id === id)).map(id => ({ id, name: id }))];

  return (
    <div className="pwa-screen">
      {back}
      <h1 className="pwa-h1" style={{ margin: '10px 0 6px' }}>{t('app.notify.title')}</h1>
      <p className="pwa-date" style={{ margin: '0 0 16px' }}>{t('app.notify.intro')}</p>

      {!prefs.haConfigured && <div className="card pwa-card pwa-row-meta" style={{ marginBottom: 12 }}>{t('app.presence.noHa')}</div>}

      <div className="pwa-kicker" style={{ marginTop: 0 }}>{t('app.notify.devices')}</div>
      <div className="card pwa-card">
        {devices.length === 0 && <div className="pwa-row-meta">{t('app.notify.noDevices')}</div>}
        {devices.map(d => (
          <button key={d.id} type="button" role="switch" aria-checked={prefs.targets.includes(d.id)} className="pwa-rule" onClick={() => toggleDevice(d.id)}>
            <span className="grow">
              <span className="pwa-rule-name"><Icon name={d.id.startsWith('mobile_app_') ? 'device-mobile' : 'bell'} /> {d.id === 'notify' ? t('app.notify.allDevices') : d.name}</span>
              <span className="pwa-row-meta mono">notify.{d.id}</span>
            </span>
            <Switch on={prefs.targets.includes(d.id)} />
          </button>
        ))}
        {prefs.targets.length > 0 && (
          <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => void test()}>
            <Icon name="paper-plane-tilt" /> {t('app.notify.test')}
          </button>
        )}
      </div>

      <div className="pwa-kicker" style={{ marginTop: 22 }}>{t('app.notify.kinds')}</div>
      <div className={`card pwa-card${prefs.targets.length ? '' : ' is-muted'}`}>
        {KINDS.map(k => (
          <button key={k} type="button" role="switch" aria-checked={prefs.kinds[k]} className="pwa-rule" onClick={() => save({ kinds: { ...prefs.kinds, [k]: !prefs.kinds[k] } })}>
            <span className="grow">
              <span className="pwa-rule-name">{t(`app.notify.kind.${k}`)}</span>
              <span className="pwa-row-meta">{t(`app.notify.kindHint.${k}`)}</span>
            </span>
            <Switch on={prefs.kinds[k]} />
          </button>
        ))}
      </div>

      <p className="pwa-label" style={{ marginTop: 16, lineHeight: 1.5 }}>
        {prefs.targets.length ? t('app.notify.howOn') : prefs.personalActive ? t('app.notify.howOffPersonal') : t('app.notify.howOffGlobal')}
      </p>
    </div>
  );
}
