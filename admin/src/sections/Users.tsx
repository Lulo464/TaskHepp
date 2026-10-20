import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui';
import { roles, roleTag } from '../lib/format';
import { groupMap } from '../lib/mockData';
import { useStore } from '../lib/store';

export function Users() {
  const { t } = useTranslation();
  const { state, update } = useStore();

  const cycleRole = (index: number) =>
    update(s => ({ users: s.users.map((u, i) => (i === index ? { ...u, role: roles[(roles.indexOf(u.role) + 1) % roles.length] } : u)) }));
  const revoke = (index: number) => update(s => ({ sessions: s.sessions.filter((_, i) => i !== index) }));

  return (
    <>
      <div className="table-wrap mb-28">
        <table className="table">
          <thead>
            <tr>
              <th>{t('users.col.user')}</th>
              <th>{t('users.col.group')}</th>
              <th>{t('users.col.role')}</th>
              <th>{t('users.col.seen')}</th>
            </tr>
          </thead>
          <tbody>
            {state.users.map((u, i) => (
              <tr key={u.mail}>
                <td>{u.name}<div className="user-mail">{u.mail}</div></td>
                <td className="mono" style={{ fontSize: 13 }}>{u.group}</td>
                <td>
                  <button type="button" className={`tag ${roleTag[u.role]}`} title={t('users.cycleRole')} onClick={() => cycleRole(i)}>
                    {t(`role.${u.role}`)}
                  </button>
                </td>
                <td className="soft">{u.seen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">{t('users.groupMap')}</div>
      <div className="card list-card mb-28">
        {groupMap.map(([group, role]) => (
          <div key={group} className="list-row">
            <span className="mono grow">{group}</span>
            <Icon name="arrow-right" className="muted" />
            <span className={`tag ${roleTag[role]}`}>{t(`role.${role}`)}</span>
          </div>
        ))}
      </div>

      <div className="section-title">{t('users.sessions')}</div>
      <div className="card list-card">
        {state.sessions.map((s, i) => (
          <div key={s.device} className="list-row">
            <Icon name={s.icon} className="lead" />
            <span className="grow">{s.device}<div className="user-mail">{s.where}</div></span>
            <button type="button" className="btn btn-ghost" onClick={() => revoke(i)}>{t('users.revoke')}</button>
          </div>
        ))}
      </div>
    </>
  );
}
