import { useTranslation } from 'react-i18next';
import { Field, LabeledSeg, Loading, Note, ToggleList } from '../components/ui';
import { patch, useAction, useApi } from '../lib/api';
import type { Settings } from '../lib/types';

const KEYS = ['dueSoon', 'haCreated', 'weeklyReport', 'dailyDigest'] as const;

export function Notifications() {
  const { t } = useTranslation();
  const settings = useApi<Settings>('/api/settings');
  const act = useAction();
  if (!settings) return <Loading />;
  const save = (body: object) => act(() => patch('/api/settings', body));

  return (
    <>
      <ToggleList
        className="mb-20"
        items={KEYS.map(k => ({ title: t(`notify.${k}.title`), desc: t(`notify.${k}.desc`), on: settings.notifications[k] }))}
        onToggle={i => save({ notifications: { [KEYS[i]]: !settings.notifications[KEYS[i]] } })}
      />
      <div className="notify-controls">
        <LabeledSeg
          title={t('notify.channel')}
          options={(['push', 'haNotify', 'email'] as const).map(value => ({ value, label: t(`notify.${value}`) }))}
          value={settings.channel}
          onChange={channel => save({ channel })}
        />
        <Field label={t('notify.quietFrom')}>
          <input type="time" className="input time-input" defaultValue={settings.quietFrom} onBlur={e => e.target.value !== settings.quietFrom && save({ quietFrom: e.target.value })} />
        </Field>
        <Field label={t('notify.quietTo')}>
          <input type="time" className="input time-input" defaultValue={settings.quietTo} onBlur={e => e.target.value !== settings.quietTo && save({ quietTo: e.target.value })} />
        </Field>
      </div>
      {settings.channel !== 'haNotify' && <Note>{t('notify.channelPending')}</Note>}
      <Note>{t('notify.personalHint')}</Note>
    </>
  );
}
