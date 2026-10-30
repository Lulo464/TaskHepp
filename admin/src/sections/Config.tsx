import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Loading, Seg } from '../components/ui';
import { useApi } from '../lib/api';

const FILES = { ha: '/api/config/homeassistant.yaml', tasklog: '/api/config/tasklog.yaml', dashboard: '/api/config/dashboard.yaml' } as const;

export function Config() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<keyof typeof FILES>('ha');
  const yaml = useApi<string>(FILES[tab], { text: true });
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(yaml ?? '');
    } catch {
      // Clipboard may be unavailable (insecure context); the text stays selectable.
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="config-bar">
        <Seg fill={false} options={[{ value: 'ha' as const, label: t('config.ha') }, { value: 'tasklog' as const, label: t('config.tasklog') }, { value: 'dashboard' as const, label: t('config.dashboard') }]} value={tab} onChange={setTab} />
        <div className="row">
          <a className="btn btn-ghost" style={{ height: 32 }} href={FILES[tab]} download><Icon name="download-simple" /> {t('config.download')}</a>
          <button type="button" className="btn btn-secondary" style={{ height: 32 }} onClick={copy}>
            <Icon name="copy" /> {t(copied ? 'config.copied' : 'config.copy')}
          </button>
        </div>
      </div>
      {yaml === undefined ? <Loading /> : <pre className="yaml">{yaml}</pre>}
      {tab === 'ha' && <div className="field-hint" style={{ maxWidth: 760, marginTop: 10 }}>{t('config.haHint')}</div>}
      {tab === 'dashboard' && (
        <div className="field-hint" style={{ maxWidth: 760, marginTop: 10 }}>
          <p style={{ margin: '0 0 6px' }}>{t('config.dashboardHint')}</p>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {(t('config.dashboardSteps', { returnObjects: true }) as string[]).map(step => <li key={step}>{step}</li>)}
          </ol>
        </div>
      )}
    </>
  );
}
