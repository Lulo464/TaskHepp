import { useTranslation } from 'react-i18next';
import { Field, LabeledSeg, ToggleList } from '../components/ui';
import { flipAt, useStore } from '../lib/store';

export function Notifications() {
  const { t } = useTranslation();
  const { state, update } = useStore();

  return (
    <>
      <ToggleList
        className="mb-20"
        items={state.notifications.map(n => ({ title: t(`notify.${n.key}.title`), desc: t(`notify.${n.key}.desc`), on: n.enabled }))}
        onToggle={i => update(s => ({ notifications: flipAt(s.notifications, i) }))}
      />
      <div className="notify-controls">
        <LabeledSeg
          title={t('notify.channel')}
          options={(['push', 'haNotify', 'email'] as const).map(value => ({ value, label: t(`notify.${value}`) }))}
          value={state.channel}
          onChange={channel => update({ channel })}
        />
        <Field label={t('notify.quietFrom')}>
          <input type="time" className="input time-input" value={state.quietFrom} onChange={e => update({ quietFrom: e.target.value })} />
        </Field>
        <Field label={t('notify.quietTo')}>
          <input type="time" className="input time-input" value={state.quietTo} onChange={e => update({ quietTo: e.target.value })} />
        </Field>
      </div>
    </>
  );
}
