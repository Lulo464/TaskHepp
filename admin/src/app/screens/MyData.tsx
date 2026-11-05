import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { del, useAction } from '../../lib/api';
import type { Me } from '../../lib/types';
import { href } from '../router';

/** "Meine Daten": download everything Tasklog keeps about you, or delete your account. */
export function MyData({ me }: { me: Me }) {
  const { t } = useTranslation();
  const act = useAction();
  const [confirm, setConfirm] = useState('');
  const word = t('app.mydata.confirmWord');

  const remove = () => act(async () => {
    await del('/api/me');
    window.location.href = '/';
  });

  return (
    <div className="pwa-screen">
      <a className="btn btn-ghost pwa-back" href={href({ name: 'more' })}><Icon name="caret-left" /> {t('app.more.title')}</a>
      <h1 className="pwa-h1" style={{ margin: '10px 0 6px' }}>{t('app.mydata.title')}</h1>
      <p className="pwa-date" style={{ margin: '0 0 16px' }}>{t('app.mydata.intro')}</p>

      <div className="pwa-kicker" style={{ marginTop: 0 }}>{t('app.mydata.exportTitle')}</div>
      <div className="card pwa-card">
        <div className="pwa-row-meta">{t('app.mydata.exportText')}</div>
        <a className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} href="/api/me/export" download><Icon name="download-simple" /> {t('app.mydata.export')}</a>
      </div>

      <div className="pwa-kicker" style={{ marginTop: 22 }}>{t('app.mydata.deleteTitle')}</div>
      <div className="card pwa-card pwa-danger">
        <div className="pwa-row-meta">{t('app.mydata.deleteText', { email: me.email })}</div>
        <label className="field">
          <span className="field-label">{t('app.mydata.confirm', { word })}</span>
          <input className="input" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" />
        </label>
        <button type="button" className="btn btn-secondary pwa-danger-btn" style={{ alignSelf: 'flex-start' }} disabled={confirm.trim().toUpperCase() !== word.toUpperCase()} onClick={() => void remove()}>
          <Icon name="trash" /> {t('app.mydata.delete')}
        </button>
      </div>
      <p className="pwa-label" style={{ marginTop: 16, lineHeight: 1.5 }}>{t('app.mydata.oidcHint')}</p>
    </div>
  );
}
