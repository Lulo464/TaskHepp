import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Seg } from '../components/ui';
import { useStore } from '../lib/store';
import { homeAssistantYaml, tasklogYaml } from '../lib/yaml';

export function Config() {
  const { t } = useTranslation();
  const { state } = useStore();
  const [tab, setTab] = useState<'ha' | 'tasklog'>('ha');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const yaml = tab === 'ha' ? homeAssistantYaml(state.rules) : tasklogYaml(state.rules, state.entities);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
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
        <Seg fill={false} options={[{ value: 'ha' as const, label: t('config.ha') }, { value: 'tasklog' as const, label: t('config.tasklog') }]} value={tab} onChange={setTab} />
        <button type="button" className="btn btn-secondary" style={{ height: 32 }} onClick={copy}>
          <Icon name="copy" /> {t(copied ? 'config.copied' : 'config.copy')}
        </button>
      </div>
      <pre className="yaml">{yaml}</pre>
    </>
  );
}
