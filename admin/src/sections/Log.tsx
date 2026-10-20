import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loading, Seg } from '../components/ui';
import { post, useAction, useApi } from '../lib/api';
import type { LogEntry } from '../lib/types';
import { LogTable } from './LogTable';

type Filter = 'all' | 'errors' | 'in' | 'out';

export function Log() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const logs = useApi<LogEntry[]>(`/api/logs?filter=${filter}&limit=200`, { refreshMs: 15000 });
  const act = useAction();

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
      {logs ? <LogTable withHeader entries={logs} onRetry={id => act(() => post(`/api/logs/${id}/retry`))} /> : <Loading />}
    </>
  );
}
