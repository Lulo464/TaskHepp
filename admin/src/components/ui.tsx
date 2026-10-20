import type { ReactNode } from 'react';

/** Phosphor icon by name, e.g. <Icon name="house-line" />. */
export function Icon({ name, fill, className = '' }: { name: string; fill?: boolean; className?: string }) {
  return <i className={`${fill ? 'ph-fill' : 'ph'} ph-${name} ${className}`} aria-hidden="true" />;
}

export function Switch({ on }: { on: boolean }) {
  return (
    <span className={`switch${on ? ' is-on' : ''}`} aria-hidden="true">
      <span className="switch-knob" />
    </span>
  );
}

export interface SegOption<T> {
  value: T;
  label: string;
}

/** Segmented control. `fill` stretches the options to share the width. */
export function Seg<T extends string | number>({ options, value, onChange, fill = true, label }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; fill?: boolean; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`seg-opt seg-btn${fill ? ' seg-fill' : ''}${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LabeledSeg<T extends string | number>(props: { title: string; options: SegOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="control-label">{props.title}</div>
      <Seg options={props.options} value={props.value} onChange={props.onChange} label={props.title} />
    </div>
  );
}

export interface ToggleItem {
  title: string;
  desc?: string;
  on: boolean;
}

/** A card of rows that each flip a switch when clicked. */
export function ToggleList({ items, onToggle, mono, heading, children, className = '' }: { items: ToggleItem[]; onToggle: (index: number) => void; mono?: boolean; heading?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`card list-card ${className}`}>
      {heading && <div className="list-heading">{heading}</div>}
      {items.map((item, i) => (
        <ToggleRow key={item.title} {...item} mono={mono} onToggle={() => onToggle(i)} />
      ))}
      {children}
    </div>
  );
}

export function ToggleRow({ title, desc, on, mono, onToggle, last }: ToggleItem & { mono?: boolean; onToggle: () => void; last?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`list-row toggle-row${last ? ' no-rule' : ''}`} onClick={onToggle}>
      <span className="grow">
        <span className={`row-title${mono ? ' mono' : ''}`}>{title}</span>
        {desc && <span className="row-desc">{desc}</span>}
      </span>
      <Switch on={on} />
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
