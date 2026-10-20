import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { redirectToLogin, useApi } from '../../lib/api';
import type { AuthInfo } from '../../lib/types';

export function Login() {
  const { t } = useTranslation();
  const info = useApi<AuthInfo>('/api/auth/info');

  return (
    <div className="pwa-login">
      <div className="pwa-logo"><Icon name="check-square-offset" /></div>
      <h1 className="pwa-login-title">{t('brand.name')}</h1>
      <p className="pwa-login-text">{t('app.tagline')}</p>
      <div className="grow" />
      {info?.issuer && (
        <label className="field">
          <span className="field-label">{t('app.login.provider')}</span>
          <input className="input" value={info.issuer} readOnly />
        </label>
      )}
      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={redirectToLogin}>
        <Icon name="key" /> {t('app.login.button')}
      </button>
      <p className="pwa-login-hint">{t(info?.mode === 'dev' ? 'app.login.devHint' : 'app.login.hint')}</p>
    </div>
  );
}
