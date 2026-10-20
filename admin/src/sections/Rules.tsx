import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, LabeledSeg, Loading, Note, Seg, Switch } from '../components/ui';
import { del, patch, post, useAction, useApi } from '../lib/api';
import type { Area, Rule, RuleTest } from '../lib/types';

type Editable = Omit<Rule, 'id' | 'area' | 'translatable'>;
const TEXT_SAVE_DELAY = 600;

export function Rules() {
  const { t } = useTranslation();
  const rules = useApi<Rule[]>('/api/rules');
  const areas = useApi<Area[]>('/api/areas');
  const act = useAction();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [test, setTest] = useState<RuleTest | null>(null);
  const pending = useRef<{ id: number; fields: Partial<Editable>; timer?: number }>({ id: 0, fields: {} });

  const selected = rules?.find(r => r.id === selectedId) ?? rules?.[0] ?? null;

  // Load the draft only when switching rules, so refetches don't overwrite what is being typed.
  useEffect(() => {
    if (selected && selected.id !== draft?.id) setDraft(selected);
  }, [selected?.id]);

  // Keep the server-derived flag current.
  useEffect(() => {
    if (selected && draft && selected.id === draft.id && selected.translatable !== draft.translatable) setDraft({ ...draft, translatable: selected.translatable });
  }, [selected?.translatable]);

  const flush = () => {
    const p = pending.current;
    window.clearTimeout(p.timer);
    if (!Object.keys(p.fields).length) return;
    const fields = p.fields;
    p.fields = {};
    void act(() => patch(`/api/rules/${p.id}`, fields));
  };
  useEffect(() => flush, []);

  if (!rules || !areas) return <Loading />;

  const pick = (id: number) => { flush(); setSelectedId(id); setTest(null); };

  /** Text edits save after a pause; choices save at once. */
  const change = (fields: Partial<Editable>, immediate = false) => {
    if (!draft) return;
    setDraft({ ...draft, ...fields });
    setTest(null);
    const p = pending.current;
    if (p.id !== draft.id) flush();
    p.id = draft.id;
    p.fields = { ...p.fields, ...fields };
    window.clearTimeout(p.timer);
    if (immediate) flush();
    else p.timer = window.setTimeout(flush, TEXT_SAVE_DELAY);
  };

  const addRule = () => act(async () => {
    const created = await post<Rule>('/api/rules', {
      name: t('rules.newName'), entity: 'sensor.beispiel', cond: '> 0', join: 'and', cond2: '', window: '00:00–23:59',
      title: t('rules.newTitle'), areaId: areas[areas.length - 1]?.id, prio: 'normal', onEnd: 'close', dedupe: true, enabled: false,
    });
    setSelectedId(created.id);
  });
  const deleteRule = () => draft && act(async () => {
    await del(`/api/rules/${draft.id}`);
    setSelectedId(null);
    setDraft(null);
  });
  const runTest = () => draft && act(async () => {
    flush();
    setTest(await post<RuleTest>(`/api/rules/${draft.id}/test`));
  });

  const text = (key: 'name' | 'entity' | 'cond' | 'cond2' | 'window' | 'title') => ({
    value: draft?.[key] ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement>) => change({ [key]: e.target.value }),
    onBlur: flush,
  });

  return (
    <div className="rules-layout">
      <div className="card list-card" style={{ padding: '4px 16px' }}>
        {rules.map(r => (
          <button key={r.id} type="button" className={`rule-item${r.id === draft?.id ? ' is-active' : ''}`} aria-pressed={r.id === draft?.id} onClick={() => pick(r.id)}>
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

      {draft && (
        <div className="card editor">
          <div className="kicker accent">{t('rules.edit')}</div>
          <Field label={t('rules.name')}><input className="input" {...text('name')} /></Field>

          <div className="kicker">{t('rules.when')}</div>
          <div className="grid-cond">
            <Field label={t('rules.entity')}><input className="input mono" {...text('entity')} /></Field>
            <Field label={t('rules.condition')}><input className="input" placeholder="> 1.8 · = on · on > 2 h" {...text('cond')} /></Field>
          </div>
          <div className="grid-join">
            <Seg options={[{ value: 'and' as const, label: t('rules.and') }, { value: 'or' as const, label: t('rules.or') }]} value={draft.join} onChange={join => change({ join }, true)} />
            <Field label={t('rules.extraCondition')}><input className="input" placeholder="sensor.aussen_temp < 5" {...text('cond2')} /></Field>
          </div>
          {!draft.translatable && <Note>{t('rules.notTranslatable')}</Note>}
          <Field label={t('rules.window')}><input className="input" {...text('window')} /></Field>

          <div className="kicker">{t('rules.then')}</div>
          <Field label={t('rules.ticketTitle')}><input className="input" {...text('title')} /></Field>
          <div className="grid-2">
            <LabeledSeg title={t('rules.area')} options={areas.map(a => ({ value: a.id, label: a.name }))} value={draft.areaId} onChange={areaId => change({ areaId }, true)} />
            <LabeledSeg title={t('rules.prio')} options={[{ value: 'normal' as const, label: t('prio.normal') }, { value: 'high' as const, label: t('prio.high') }]} value={draft.prio} onChange={prio => change({ prio }, true)} />
          </div>
          <LabeledSeg title={t('rules.onEnd')} options={[{ value: 'close' as const, label: t('rules.close') }, { value: 'keepOpen' as const, label: t('rules.keepOpen') }]} value={draft.onEnd} onChange={onEnd => change({ onEnd }, true)} />

          <button type="button" role="switch" aria-checked={draft.dedupe} className="dedupe-row" onClick={() => change({ dedupe: !draft.dedupe }, true)}>
            {t('rules.dedupe')}
            <Switch on={draft.dedupe} />
          </button>

          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => change({ enabled: !draft.enabled }, true)}>{t(draft.enabled ? 'rules.deactivate' : 'rules.activate')}</button>
            <button type="button" className="btn btn-secondary" onClick={runTest}><Icon name="flask" /> {t('rules.test')}</button>
            <button type="button" className="btn btn-ghost" onClick={deleteRule}><Icon name="trash" /> {t('common.delete')}</button>
          </div>

          {test && (
            <div className="test-preview" aria-live="polite">
              <div className="kicker accent">{t('rules.testTitle')}</div>
              <div className="test-title">{test.ticket.title}</div>
              <div className="test-meta">{t('rules.testMeta', { area: test.ticket.area, prio: t(`prio.${test.ticket.prio}`) })}</div>
              {!test.enabled && <div className="test-meta">{t('rules.testDisabled')}</div>}
              {test.duplicateOf && <div className="test-meta">{t('rules.testDuplicate', { title: test.duplicateOf.title })}</div>}
              {test.haTemplate && <div className="test-meta mono">{test.haTemplate}{test.holdFor ? ` · for ${test.holdFor}` : ''}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
