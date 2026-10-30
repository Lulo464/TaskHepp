import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { fromPreset, presetOf, PRESETS, type Preset } from '../../lib/recurrence';
import type { Recurrence } from '../../lib/types';

const UNITS: Recurrence['unit'][] = ['day', 'week', 'month', 'year'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** "Wiederholen": presets like weekly or monthly, or every n days/weeks/months/years on chosen weekdays. */
export function RepeatPicker({ value, due, onChange, disabled }: { value: Recurrence | null; due: string | null; onChange: (r: Recurrence | null) => void; disabled?: boolean }) {
  const { t, i18n } = useTranslation();
  // "Benutzerdefiniert" stays open even while the choice still matches a preset.
  const [custom, setCustom] = useState(() => presetOf(value) === 'custom');
  const preset = value && custom ? 'custom' : presetOf(value);
  const set = (patch: Partial<Recurrence>) => value && onChange({ ...value, ...patch });
  const dayName = (d: number) => new Date(2024, 0, d).toLocaleDateString(i18n.language, { weekday: 'short' }).replace('.', '');

  return (
    <div className="pwa-repeat">
      <div className="pwa-repeat-row">
        <Icon name="arrows-clockwise" />
        <select className="input" aria-label={t('repeat.label')} value={preset} disabled={disabled} onChange={e => { const p = e.target.value as Preset; setCustom(p === 'custom'); onChange(fromPreset(p, due, value)); }}>
          {PRESETS.map(p => <option key={p} value={p}>{t(`repeat.preset.${p}`)}</option>)}
        </select>
      </div>
      {value && preset === 'custom' && (
        <div className="pwa-repeat-custom">
          <div className="pwa-repeat-row">
            <span className="pwa-label">{t('repeat.every')}</span>
            <input className="input pwa-repeat-n" type="number" min={1} max={366} inputMode="numeric" aria-label={t('repeat.count')} value={value.every} disabled={disabled}
              onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 366) set({ every: n }); }} />
            <select className="input" aria-label={t('repeat.unit')} value={value.unit} disabled={disabled}
              onChange={e => { const unit = e.target.value as Recurrence['unit']; set({ unit, weekdays: unit === 'week' ? value.weekdays : undefined, monthDay: unit === 'month' ? value.monthDay : undefined }); }}>
              {UNITS.map(u => <option key={u} value={u}>{t(`repeat.unitName.${u}`, { count: value.every })}</option>)}
            </select>
          </div>
          {value.unit === 'week' && (
            <div className="pwa-repeat-days" role="group" aria-label={t('repeat.weekdays')}>
              {WEEKDAYS.map(d => {
                const on = value.weekdays?.includes(d) ?? false;
                return (
                  <button key={d} type="button" className={`pwa-chip${on ? ' is-active' : ''}`} aria-pressed={on} disabled={disabled}
                    onClick={() => set({ weekdays: on ? value.weekdays!.filter(x => x !== d) : [...(value.weekdays ?? []), d].sort((a, b) => a - b) })}>
                    {dayName(d)}
                  </button>
                );
              })}
            </div>
          )}
          <label className="pwa-repeat-check">
            <input type="checkbox" checked={value.fromDone ?? false} disabled={disabled} onChange={e => set({ fromDone: e.target.checked || undefined })} />
            {t('repeat.fromDone')}
          </label>
        </div>
      )}
    </div>
  );
}
