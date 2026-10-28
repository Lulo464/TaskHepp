import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Icon, LabeledSeg, Loading, Note, Seg, ToggleRow } from '../components/ui';
import { api, del, patch, post, put, useAction, useApi } from '../lib/api';
import { formatAgo, formatTime } from '../lib/format';
import type { Area, MailAccount, MailImportEntry, MailPlan, MailPreview, MailRule } from '../lib/types';

type Tab = 'account' | 'rules' | 'preview';
type AccountDraft = Omit<MailAccount, 'id' | 'hasPassword' | 'lastPollAt' | 'lastError'> & { password: string };

const NEW_ACCOUNT: AccountDraft = {
  name: '', host: '', port: 993, tls: 'tls', username: '', password: '', mailbox: 'INBOX', pollMinutes: 5,
  onlyUnseen: true, afterImport: 'seen', moveTo: '', enabled: true,
};
const DEFAULT_PORT = { tls: 993, starttls: 143, none: 143 } as const;

/** Mailboxes polled via IMAP, with rules that turn mails into tickets. */
export function Mail() {
  const { t } = useTranslation();
  const accounts = useApi<MailAccount[]>('/api/mail/accounts');
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [tab, setTab] = useState<Tab>('account');

  if (!accounts) return <Loading />;
  const selected = selectedId === 'new' ? null : accounts.find(a => a.id === selectedId) ?? (selectedId === null ? accounts[0] : undefined) ?? null;
  const creating = selectedId === 'new' || accounts.length === 0;

  return (
    <div className="rules-layout mail-layout">
      <div className="card list-card" style={{ padding: '4px 16px', alignSelf: 'start' }}>
        {accounts.map(a => (
          <button key={a.id} type="button" className={`rule-item${!creating && a.id === selected?.id ? ' is-active' : ''}`} onClick={() => setSelectedId(a.id)}>
            <span className="grow">
              <span className="row-title">{a.name}</span>
              <span className="rule-when mono" style={{ display: 'block' }}>{a.username} · {a.mailbox}</span>
            </span>
            <span className={`tag ${a.lastError ? 'tag-outline' : a.enabled ? 'tag-accent' : 'tag-neutral'}`}>
              {t(a.lastError ? 'calendars.error' : a.enabled ? 'rules.active' : 'rules.off')}
            </span>
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-block" style={{ margin: '14px 0' }} onClick={() => { setSelectedId('new'); setTab('account'); }}>
          <Icon name="plus" /> {t('mail.addAccount')}
        </button>
      </div>

      <div className="stack">
        {!creating && selected && (
          <Seg fill={false} value={tab} onChange={setTab} options={[
            { value: 'account' as const, label: t('mail.tab.account') },
            { value: 'rules' as const, label: t('mail.tab.rules') },
            { value: 'preview' as const, label: t('mail.tab.preview') },
          ]} />
        )}
        {creating && <AccountForm key="new" onCreated={id => { setSelectedId(id); setTab('rules'); }} />}
        {!creating && selected && tab === 'account' && <AccountForm key={selected.id} account={selected} onDeleted={() => setSelectedId(null)} />}
        {!creating && selected && tab === 'rules' && <Rules key={selected.id} account={selected} />}
        {!creating && selected && tab === 'preview' && <Preview key={selected.id} account={selected} />}
      </div>
    </div>
  );
}

function AccountForm({ account, onCreated, onDeleted }: { account?: MailAccount; onCreated?: (id: number) => void; onDeleted?: () => void }) {
  const { t } = useTranslation();
  const act = useAction();
  const [draft, setDraft] = useState<AccountDraft>(() => (account ? { ...account, password: '' } : NEW_ACCOUNT));
  const [folders, setFolders] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const set = (p: Partial<AccountDraft>) => setDraft(d => ({ ...d, ...p }));

  const valid = draft.name.trim() && draft.host.trim() && draft.username.trim() && (account?.hasPassword || draft.password);
  const body = () => {
    const { password, ...rest } = draft;
    return { ...rest, password }; // empty password keeps the stored one
  };

  const save = () => act(async () => {
    if (account) {
      await patch(`/api/mail/accounts/${account.id}`, body());
      setDraft(d => ({ ...d, password: '' }));
      setInfo(t('mail.saved'));
    } else {
      const created = await post<MailAccount>('/api/mail/accounts', body());
      onCreated?.(created.id);
    }
  });
  const test = () => account && act(async () => {
    setInfo(t('mail.testing'));
    const r = await post<{ folders: string[]; mailboxExists: boolean; messages: number; unseen: number }>(`/api/mail/accounts/${account.id}/test`);
    setFolders(r.folders);
    setInfo(r.mailboxExists ? t('mail.testOk', { messages: r.messages, unseen: r.unseen }) : t('mail.testNoFolder', { folder: draft.mailbox }));
    return true;
  }).then(ok => { if (!ok) setInfo(null); });
  const poll = () => account && act(async () => {
    const r = await post<{ messages: number; tickets: number }>(`/api/mail/accounts/${account.id}/poll`);
    setInfo(t('mail.pollResult', { messages: r.messages, tickets: r.tickets }));
  });
  const remove = () => account && window.confirm(t('mail.deleteConfirm', { name: account.name })) && act(async () => {
    await del(`/api/mail/accounts/${account.id}`);
    onDeleted?.();
  });

  return (
    <div className="card editor">
      <div className="kicker accent">{t(account ? 'mail.editAccount' : 'mail.newAccount')}</div>
      <Field label={t('rules.name')}><input className="input" value={draft.name} placeholder={t('mail.namePlaceholder')} onChange={e => set({ name: e.target.value })} /></Field>
      <div className="grid-cond">
        <Field label={t('mail.host')}><input className="input mono" value={draft.host} placeholder="imap.example.com" onChange={e => set({ host: e.target.value })} /></Field>
        <Field label={t('mail.port')}><input className="input mono" type="number" min={1} max={65535} value={draft.port} onChange={e => set({ port: Number(e.target.value) })} /></Field>
      </div>
      <LabeledSeg title={t('mail.security')} value={draft.tls} onChange={tls => set({ tls, port: draft.port === DEFAULT_PORT[draft.tls] ? DEFAULT_PORT[tls] : draft.port })}
        options={[{ value: 'tls' as const, label: 'SSL/TLS' }, { value: 'starttls' as const, label: 'STARTTLS' }, { value: 'none' as const, label: t('mail.noTls') }]} />
      {draft.tls === 'none' && <Note>{t('mail.noTlsWarning')}</Note>}
      <div className="grid-2">
        <Field label={t('mail.username')}><input className="input" autoComplete="off" value={draft.username} onChange={e => set({ username: e.target.value })} /></Field>
        <Field label={t('mail.password')}>
          <input className="input" type="password" autoComplete="new-password" value={draft.password} placeholder={account?.hasPassword ? '••••••••' : ''} onChange={e => set({ password: e.target.value })} />
        </Field>
      </div>
      <datalist id="mail-folders">{folders.map(f => <option key={f} value={f} />)}</datalist>
      <Field label={t('mail.folder')}><input className="input" list="mail-folders" value={draft.mailbox} onChange={e => set({ mailbox: e.target.value })} /></Field>
      <LabeledSeg title={t('mail.interval')} value={draft.pollMinutes} onChange={pollMinutes => set({ pollMinutes })}
        options={[1, 5, 15, 60].map(n => ({ value: n, label: t('mail.minutes', { n }) }))} />
      <LabeledSeg title={t('mail.afterImport')} value={draft.afterImport} onChange={afterImport => set({ afterImport })}
        options={(['seen', 'move', 'delete', 'none'] as const).map(v => ({ value: v, label: t(`mail.after.${v}`) }))} />
      {draft.afterImport === 'move' && (
        <Field label={t('mail.moveTo')}><input className="input" list="mail-folders" value={draft.moveTo} placeholder="Archiv" onChange={e => set({ moveTo: e.target.value })} /></Field>
      )}
      <div className="list-card" style={{ padding: 0 }}>
        <ToggleRow title={t('mail.onlyUnseen')} desc={t('mail.onlyUnseenDesc')} on={draft.onlyUnseen} onToggle={() => set({ onlyUnseen: !draft.onlyUnseen })} />
        <ToggleRow last title={t('mail.enabled')} desc={t('mail.enabledDesc', { n: draft.pollMinutes })} on={draft.enabled} onToggle={() => set({ enabled: !draft.enabled })} />
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!valid || (draft.afterImport === 'move' && !draft.moveTo.trim())} onClick={save}>
          {t(account ? 'common.save' : 'mail.create')}
        </button>
        {account && <button type="button" className="btn btn-secondary" onClick={test}><Icon name="plugs-connected" /> {t('mail.test')}</button>}
        {account && <button type="button" className="btn btn-secondary" onClick={poll}><Icon name="tray-arrow-down" /> {t('mail.pollNow')}</button>}
        {account && <button type="button" className="btn btn-ghost" onClick={remove}><Icon name="trash" /> {t('common.delete')}</button>}
      </div>
      {info && <div className="field-hint" style={{ marginTop: 0 }} aria-live="polite">{info}</div>}
      {account && !info && (
        <div className="field-hint" style={{ marginTop: 0 }}>
          {account.lastPollAt ? t('mail.lastPoll', { when: formatAgo(account.lastPollAt) }) : t('mail.neverPolled')}
        </div>
      )}
      {account?.lastError && <Note>{account.lastError}</Note>}
      {!account && <Note>{t('mail.createHint')}</Note>}
    </div>
  );
}

const NEW_RULE: Omit<MailRule, 'id'> = {
  name: '', enabled: true, fromContains: '', subjectContains: '', bodyContains: '', subjectPattern: '', action: 'ticket',
  split: 'none', splitPattern: '', splitExclude: '', titleTemplate: '{subject}', descriptionTemplate: 'Von {from} am {date}:\n\n{body}', areaId: null,
  prio: 'normal', dueMode: 'none', dueDays: 1, dueTime: null, continueAfter: false,
};

function Rules({ account }: { account: MailAccount }) {
  const { t } = useTranslation();
  const rules = useApi<MailRule[]>(`/api/mail/accounts/${account.id}/rules`);
  const areas = useApi<Area[]>('/api/areas');
  const act = useAction();
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Omit<MailRule, 'id'> | null>(null);
  const [sample, setSample] = useState({ from: '', subject: '', body: '' });
  const [tried, setTried] = useState<MailPlan | null>(null);

  const selected = selectedId === 'new' ? null : rules?.find(r => r.id === selectedId) ?? rules?.[0] ?? null;
  const key = selectedId === 'new' ? 'new' : selected?.id;
  useEffect(() => {
    if (selectedId === 'new') setDraft({ ...NEW_RULE, name: t('mail.newRule'), areaId: areas?.[0]?.id ?? null });
    else if (selected) { const { id: _id, ...rest } = selected; setDraft(rest); }
    setTried(null);
  }, [key]); // reload the draft only when switching rules

  if (!rules || !areas) return <Loading />;
  const set = (p: Partial<MailRule>) => setDraft(d => (d ? { ...d, ...p } : d));

  const save = () => draft && act(async () => {
    if (selectedId === 'new') setSelectedId((await post<MailRule>(`/api/mail/accounts/${account.id}/rules`, draft)).id);
    else if (selected) await patch(`/api/mail/rules/${selected.id}`, draft);
  });
  const remove = () => selected && window.confirm(t('mail.deleteRuleConfirm', { name: selected.name })) && act(async () => {
    await del(`/api/mail/rules/${selected.id}`);
    setSelectedId(null);
  });
  const move = (index: number, by: number) => {
    const ids = rules.map(r => r.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id);
    void act(() => put(`/api/mail/accounts/${account.id}/rules/order`, ids));
  };
  const tryIt = () => act(async () => setTried(await post<MailPlan>(`/api/mail/accounts/${account.id}/try`, sample)));
  const ruleName = (id: number) => rules.find(r => r.id === id)?.name ?? `#${id}`;

  const summary = (r: MailRule) => [
    r.fromContains && t('mail.sum.from', { v: r.fromContains }),
    r.subjectContains && t('mail.sum.subject', { v: r.subjectContains }),
    r.bodyContains && t('mail.sum.body', { v: r.bodyContains }),
    r.subjectPattern && t('mail.sum.pattern', { v: r.subjectPattern }),
  ].filter(Boolean).join(' · ') || t('mail.sum.all');

  return (
    <>
      <div className="mail-rules">
        <div className="card list-card" style={{ padding: '4px 16px', alignSelf: 'start' }}>
          {rules.map((r, i) => (
            <div key={r.id} className={`rule-item mail-rule-item${selectedId !== 'new' && r.id === selected?.id ? ' is-active' : ''}`}>
              <button type="button" className="grow mail-rule-pick" onClick={() => setSelectedId(r.id)}>
                <span className="row-title"><span className="muted">{i + 1}.</span> {r.name}</span>
                <span className="rule-when" style={{ display: 'block' }}>{summary(r)}</span>
              </button>
              <span className={`tag ${!r.enabled ? 'tag-neutral' : r.action === 'ignore' ? 'tag-outline' : 'tag-accent'}`}>
                {t(!r.enabled ? 'rules.off' : r.action === 'ignore' ? 'mail.ignore' : r.split === 'none' ? 'mail.ticket' : 'mail.tickets')}
              </span>
              <span className="mail-order">
                <button type="button" className="icon-btn" aria-label={t('mail.up')} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="caret-up" /></button>
                <button type="button" className="icon-btn" aria-label={t('mail.down')} disabled={i === rules.length - 1} onClick={() => move(i, 1)}><Icon name="caret-down" /></button>
              </span>
            </div>
          ))}
          {rules.length === 0 && <div className="muted" style={{ padding: '14px 0' }}>{t('mail.noRules')}</div>}
          <button type="button" className="btn btn-secondary btn-block" style={{ margin: '14px 0' }} onClick={() => setSelectedId('new')}>
            <Icon name="plus" /> {t('rules.add')}
          </button>
          <div className="field-hint" style={{ marginBottom: 14 }}>{t('mail.orderHint')}</div>
        </div>

        {draft && (
          <div className="card editor">
            <div className="kicker accent">{t(selectedId === 'new' ? 'mail.newRule' : 'rules.edit')}</div>
            <Field label={t('rules.name')}><input className="input" value={draft.name} onChange={e => set({ name: e.target.value })} /></Field>

            <div className="kicker">{t('mail.when')}</div>
            <div className="grid-2">
              <Field label={t('mail.fromContains')}><input className="input" value={draft.fromContains} placeholder="z. B. @firma.de" onChange={e => set({ fromContains: e.target.value })} /></Field>
              <Field label={t('mail.subjectContains')}><input className="input" value={draft.subjectContains} placeholder="z. B. Rechnung" onChange={e => set({ subjectContains: e.target.value })} /></Field>
            </div>
            <Field label={t('mail.bodyContains')}><input className="input" value={draft.bodyContains} onChange={e => set({ bodyContains: e.target.value })} /></Field>
            <Field label={t('mail.subjectPattern')}><input className="input mono" value={draft.subjectPattern} placeholder="Auftrag (\d+): (.+)" onChange={e => set({ subjectPattern: e.target.value })} /></Field>
            <div className="field-hint" style={{ marginTop: -8 }}>{t('mail.conditionsHint')}</div>

            <div className="kicker">{t('mail.then')}</div>
            <LabeledSeg title={t('mail.action')} value={draft.action} onChange={action => set({ action })}
              options={[{ value: 'ticket' as const, label: t('mail.actionTicket') }, { value: 'ignore' as const, label: t('mail.actionIgnore') }]} />
            {draft.action === 'ticket' && (
              <>
                <LabeledSeg title={t('mail.split')} value={draft.split} onChange={split => set({ split, ...(split !== 'none' && draft.titleTemplate === '{subject}' ? { titleTemplate: '{item}' } : {}) })}
                  options={(['none', 'lines', 'bullets', 'pattern'] as const).map(v => ({ value: v, label: t(`mail.splitOpt.${v}`) }))} />
                {draft.split === 'pattern' && (
                  <Field label={t('mail.splitPattern')}><input className="input mono" value={draft.splitPattern} placeholder="Termin: (\S+) (.+)" onChange={e => set({ splitPattern: e.target.value })} /></Field>
                )}
                {draft.split !== 'none' && <div className="field-hint" style={{ marginTop: -8 }}>{t(`mail.splitHint.${draft.split}`)}</div>}
                {draft.split !== 'none' && (
                  <Field label={t('mail.splitExclude')}><input className="input" value={draft.splitExclude} placeholder="herbrand.de, abmelden" onChange={e => set({ splitExclude: e.target.value })} /></Field>
                )}
                <Field label={t('mail.titleTemplate')}><input className="input" value={draft.titleTemplate} onChange={e => set({ titleTemplate: e.target.value })} /></Field>
                <Field label={t('mail.descriptionTemplate')}><textarea className="input" rows={3} value={draft.descriptionTemplate} onChange={e => set({ descriptionTemplate: e.target.value })} /></Field>
                <div className="field-hint" style={{ marginTop: -8 }}>{t('mail.placeholders')}</div>
                <div className="grid-2">
                  <LabeledSeg title={t('rules.area')} value={draft.areaId ?? areas[0]?.id ?? 0} onChange={areaId => set({ areaId })} options={areas.map(a => ({ value: a.id, label: a.name }))} />
                  <LabeledSeg title={t('rules.prio')} value={draft.prio} onChange={prio => set({ prio })} options={[{ value: 'normal' as const, label: t('prio.normal') }, { value: 'high' as const, label: t('prio.high') }]} />
                </div>
                <LabeledSeg title={t('tickets.col.due')} value={draft.dueMode} onChange={dueMode => set({ dueMode })}
                  options={(['none', 'days', 'detect'] as const).map(v => ({ value: v, label: t(`mail.due.${v}`) }))} />
                {draft.dueMode !== 'none' && (
                  <div className="grid-2">
                    {draft.dueMode === 'days'
                      ? <Field label={t('mail.dueDays')}><input className="input" type="number" min={0} max={365} value={draft.dueDays} onChange={e => set({ dueDays: Number(e.target.value) })} /></Field>
                      : <div className="field-hint">{t('mail.detectHint')}</div>}
                    <Field label={t('calendars.time')}><input className="input" type="time" value={draft.dueTime ?? ''} onChange={e => set({ dueTime: e.target.value || null })} /></Field>
                  </div>
                )}
              </>
            )}
            <div className="list-card" style={{ padding: 0 }}>
              <ToggleRow title={t('mail.continueAfter')} desc={t('mail.continueAfterDesc')} on={draft.continueAfter} onToggle={() => set({ continueAfter: !draft.continueAfter })} />
              <ToggleRow last title={t('mail.ruleEnabled')} on={draft.enabled} onToggle={() => set({ enabled: !draft.enabled })} />
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={!draft.name.trim() || !draft.titleTemplate.trim()} onClick={save}>{t('common.save')}</button>
              {selectedId !== 'new' && <button type="button" className="btn btn-ghost" onClick={remove}><Icon name="trash" /> {t('common.delete')}</button>}
            </div>
          </div>
        )}
      </div>

      <div className="card editor">
        <div className="kicker accent">{t('mail.try')}</div>
        <div className="field-hint" style={{ marginTop: -8 }}>{t('mail.tryHint')}</div>
        <div className="grid-2">
          <Field label={t('mail.from')}><input className="input" value={sample.from} placeholder="Anna <anna@example.com>" onChange={e => setSample({ ...sample, from: e.target.value })} /></Field>
          <Field label={t('mail.subject')}><input className="input" value={sample.subject} onChange={e => setSample({ ...sample, subject: e.target.value })} /></Field>
        </div>
        <Field label={t('mail.body')}><textarea className="input" rows={4} value={sample.body} placeholder={'- Milch kaufen\n- Müll rausbringen'} onChange={e => setSample({ ...sample, body: e.target.value })} /></Field>
        <div><button type="button" className="btn btn-secondary" onClick={tryIt}><Icon name="flask" /> {t('rules.test')}</button></div>
        {tried && <PlanView plan={tried} ruleName={ruleName} />}
      </div>
    </>
  );
}

function PlanView({ plan, ruleName }: { plan: MailPlan; ruleName: (id: number) => string }) {
  const { t } = useTranslation();
  return (
    <div className="test-preview">
      <div className="kicker accent">
        {t(`mail.result.${plan.result}`, { count: plan.tickets.length })}
        {plan.ruleIds.length > 0 && ` · ${plan.ruleIds.map(ruleName).join(', ')}`}
      </div>
      {plan.tickets.map((x, i) => (
        <div key={i} className="mail-plan-ticket">
          <div className="test-title">{x.title}</div>
          <div className="test-meta">
            {x.due ? t('mail.dueOn', { date: x.due.split('-').reverse().join('.') + (x.dueTime ? ` ${x.dueTime}` : '') }) : t('mail.noDue')}
            {x.prio === 'high' ? ` · ${t('prio.high')}` : ''}
            {x.description ? ` · ${x.description.slice(0, 120)}${x.description.length > 120 ? '…' : ''}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function Preview({ account }: { account: MailAccount }) {
  const { t } = useTranslation();
  const [mails, setMails] = useState<MailPreview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const imports = useApi<MailImportEntry[]>(`/api/mail/accounts/${account.id}/imports`);
  const rules = useApi<MailRule[]>(`/api/mail/accounts/${account.id}/rules`);
  const act = useAction();
  const ruleName = (id: number) => rules?.find(r => r.id === id)?.name ?? `#${id}`;

  const load = () => act(async () => {
    setLoading(true);
    try {
      setMails(await api<MailPreview[]>(`/api/mail/accounts/${account.id}/preview`));
    } finally {
      setLoading(false);
    }
  });

  return (
    <>
      <div className="card editor">
        <div className="kicker accent">{t('mail.previewTitle')}</div>
        <div className="field-hint" style={{ marginTop: -8 }}>{t('mail.previewHint')}</div>
        <div><button type="button" className="btn btn-secondary" disabled={loading} onClick={load}><Icon name="eye" /> {t(loading ? 'common.loading' : 'mail.loadPreview')}</button></div>
        {mails?.map((m, i) => (
          <div key={i} className="mail-preview-row">
            <div className="mail-preview-head">
              <span className="grow">
                <span className="row-title">{m.subject || t('mail.noSubject')}</span>
                <span className="user-mail">{m.fromName || m.fromAddress} · {formatAgo(m.date)}{m.seen ? '' : ` · ${t('mail.unread')}`}</span>
              </span>
              {m.imported && <span className="tag tag-neutral">{t('mail.alreadyImported')}</span>}
            </div>
            <PlanView plan={m.plan} ruleName={ruleName} />
          </div>
        ))}
        {mails?.length === 0 && <div className="muted">{t('mail.empty')}</div>}
      </div>

      <div>
        <div className="section-title">{t('mail.log')}</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('log.col.time')}</th><th>{t('mail.from')}</th><th>{t('mail.subject')}</th><th>{t('mail.ruleCol')}</th><th>{t('log.col.status')}</th></tr></thead>
            <tbody>
              {imports?.map(e => (
                <tr key={e.id}>
                  <td>{formatTime(e.createdAt)}</td>
                  <td className="soft">{e.from}</td>
                  <td>{e.subject}</td>
                  <td className="soft">{e.rules.join(', ') || '–'}</td>
                  <td><span className={`tag ${e.result === 'created' ? 'tag-accent' : e.result === 'nomatch' ? 'tag-outline' : 'tag-neutral'}`}>{t(`mail.logResult.${e.result}`, { count: e.ticketIds.length })}</span></td>
                </tr>
              ))}
              {imports?.length === 0 && <tr><td colSpan={5} className="empty">{t('mail.noImports')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
