import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, LabeledSeg, Seg, Switch } from '../components/ui';
import { useStore } from '../lib/store';
import type { Rule } from '../lib/types';

export function Rules() {
  const { t } = useTranslation();
  const { state, update } = useStore();
  const [selected, setSelected] = useState(0);
  const [showTest, setShowTest] = useState(false);
  const rules = state.rules;
  const index = Math.min(selected, rules.length - 1);
  const rule = rules[index];

  const pick = (i: number) => { setSelected(i); setShowTest(false); };
  const patch = (p: Partial<Rule>) => {
    update(s => ({ rules: s.rules.map((r, i) => (i === index ? { ...r, ...p } : r)) }));
    setShowTest(false);
  };
  const addRule = () => {
    update(s => ({
      rules: [...s.rules, { name: t('rules.newName'), entity: 'sensor.beispiel', cond: '> 0', join: 'and', cond2: '', window: '00:00–23:59', title: t('rules.newTitle'), area: s.areas[s.areas.length - 1]?.name ?? '', prio: 'normal', onEnd: 'close', dedupe: true, enabled: false }],
    }));
    pick(rules.length);
  };
  const deleteRule = () => {
    if (rules.length <= 1) return;
    update(s => ({ rules: s.rules.filter((_, i) => i !== index) }));
    pick(0);
  };
  const text = (key: 'name' | 'entity' | 'cond' | 'cond2' | 'window' | 'title') => ({
    value: rule[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => patch({ [key]: e.target.value }),
  });

  return (
    <div className="rules-layout">
      <div className="card list-card" style={{ padding: '4px 16px' }}>
        {rules.map((r, i) => (
          <button key={i} type="button" className={`rule-item${i === index ? ' is-active' : ''}`} aria-pressed={i === index} onClick={() => pick(i)}>
            <span className="grow">
              <span className="row-title">{r.name}</span>
              <span className="rule-when mono" style={{ display: 'block' }}>{r.entity} {r.cond}</span>
            </span>
            <span className={`tag ${r.enabled ? 'tag-accent' : 'tag-neutral'}`}>{t(r.enabled ? 'rules.active' : 'rules.off')}</span>
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-block" style={{ margin: '14px 0' }} onClick={addRule}>
          <Icon name="plus" /> {t('rules.add')}
        </button>
      </div>

      <div className="card editor">
        <div className="kicker accent">{t('rules.edit')}</div>
        <Field label={t('rules.name')}><input className="input" {...text('name')} /></Field>

        <div className="kicker">{t('rules.when')}</div>
        <div className="grid-cond">
          <Field label={t('rules.entity')}><input className="input mono" {...text('entity')} /></Field>
          <Field label={t('rules.condition')}><input className="input" {...text('cond')} /></Field>
        </div>
        <div className="grid-join">
          <Seg options={[{ value: 'and' as const, label: t('rules.and') }, { value: 'or' as const, label: t('rules.or') }]} value={rule.join} onChange={join => patch({ join })} />
          <Field label={t('rules.extraCondition')}><input className="input" {...text('cond2')} /></Field>
        </div>
        <Field label={t('rules.window')}><input className="input" {...text('window')} /></Field>

        <div className="kicker">{t('rules.then')}</div>
        <Field label={t('rules.ticketTitle')}><input className="input" {...text('title')} /></Field>
        <div className="grid-2">
          <LabeledSeg title={t('rules.area')} options={state.areas.map(a => ({ value: a.name, label: a.name }))} value={rule.area} onChange={area => patch({ area })} />
          <LabeledSeg title={t('rules.prio')} options={[{ value: 'normal' as const, label: t('prio.normal') }, { value: 'high' as const, label: t('prio.high') }]} value={rule.prio} onChange={prio => patch({ prio })} />
        </div>
        <LabeledSeg title={t('rules.onEnd')} options={[{ value: 'close' as const, label: t('rules.close') }, { value: 'keepOpen' as const, label: t('rules.keepOpen') }]} value={rule.onEnd} onChange={onEnd => patch({ onEnd })} />

        <button type="button" role="switch" aria-checked={rule.dedupe} className="dedupe-row" onClick={() => patch({ dedupe: !rule.dedupe })}>
          {t('rules.dedupe')}
          <Switch on={rule.dedupe} />
        </button>

        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => patch({ enabled: !rule.enabled })}>{t(rule.enabled ? 'rules.deactivate' : 'rules.activate')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowTest(true)}><Icon name="flask" /> {t('rules.test')}</button>
          <button type="button" className="btn btn-ghost" onClick={deleteRule} disabled={rules.length <= 1}><Icon name="trash" /> {t('common.delete')}</button>
        </div>

        {showTest && (
          <div className="test-preview" aria-live="polite">
            <div className="kicker accent">{t('rules.testTitle')}</div>
            <div className="test-title">{rule.title}</div>
            <div className="test-meta">{t('rules.testMeta', { area: rule.area, prio: t(`prio.${rule.prio}`) })}</div>
          </div>
        )}
      </div>
    </div>
  );
}
