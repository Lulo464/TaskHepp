import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Seg } from '../components/ui';
import { isLogError } from '../lib/format';
import { useStore } from '../lib/store';
import type { LogEntry } from '../lib/types';
import { LogTable } from './LogTable';

type Filter = 'all' | 'errors' | 'in' | 'out';

const matches: Record<Filter, (e: LogEntry) => boolean> = {
  all: () => true,
  errors: e => isLogError(e.status),
  in: e => e.dir === 'in',
  out: e => e.dir === 'out',
};

export function Log() {
  const { t } = useTranslation();
  const { state, update } = useStore();
  const [filter, setFilter] = useState<Filter>('all');

  // Placeholder: the real retry re-sends the event through the backend.
  const retry = (index: number) =>
    update(s => ({ logs: s.logs.map((e, i) => (i === index ? { ...e, status: 'sent' as const } : e)) }));

  const options = [
    { value: 'all' as const, label: t('common.all') },
    { value: 'errors' as const, label: t('log.errors') },
    { value: 'in' as const, label: t('log.in') },
    { value: 'out' as const, label: t('log.out') },
  ];

  return (
    <>
      <div style={{ marginBottom: 14, maxWidth: 420 }}>
        <Seg options={options} value={filter} onChange={setFilter} />
      </div>
      <LogTable
        withHeader
        onRetry={retry}
        entries={state.logs.map((entry, index) => ({ entry, index })).filter(({ entry }) => matches[filter](entry))}
      />
    </>
  );
}
