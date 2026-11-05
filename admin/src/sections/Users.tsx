import { useTranslation } from 'react-i18next';
import { Icon, Loading } from '../components/ui';
import { del, patch, put, useAction, useApi } from '../lib/api';
import { formatAgo, roles, roleTag } from '../lib/format';
import type { Role, Session, User } from '../lib/types';

const nextRole = (r: Role) => roles[(roles.indexOf(r) + 1) % roles.length];

export function Users() {
  const { t } = useTranslation();
  const users = useApi<User[]>('/api/users');
  const groups = useApi<{ group: string; role: Role }[]>('/api/group-roles');
  const sessions = useApi<Session[]>('/api/sessions');
  const act = useAction();
  if (!users || !groups || !sessions) return <Loading />;

  const cycleGroup = (index: number) =>
    act(() => put('/api/group-roles', groups.map((g, i) => (i === index ? { ...g, role: nextRole(g.role) } : g))));
  const addGroup = () => {
    const name = window.prompt(t('users.groupName'))?.trim();
    if (name) void act(() => put('/api/group-roles', [...groups, { group: name, role: 'read' }]));
  };

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
              <th aria-label={t('users.delete')} />
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.name}<div className="user-mail">{u.email}</div></td>
                <td className="mono" style={{ fontSize: 13 }}>{u.group ?? '–'}</td>
                <td>
                  <button type="button" className={`tag ${roleTag[u.role]}`} title={t('users.cycleRole')} onClick={() => act(() => patch(`/api/users/${u.id}`, { role: nextRole(u.role) }))}>
                    {t(`role.${u.role}`)}
                  </button>
                  {u.roleOverride && (
                    <button type="button" className="icon-btn" style={{ marginLeft: 8, fontSize: 14 }} title={t('users.followGroups')} onClick={() => act(() => patch(`/api/users/${u.id}`, { role: u.role, followGroups: true }))}>
                      <Icon name="push-pin" />
                    </button>
                  )}
                </td>
                <td className="soft">{formatAgo(u.lastSeenAt)}</td>
                <td>
                  <button type="button" className="icon-btn" title={t('users.delete')} aria-label={t('users.deleteNamed', { name: u.name })}
                    onClick={() => window.confirm(t('users.deleteConfirm', { name: u.name, email: u.email })) && act(() => del(`/api/users/${u.id}`))}>
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">{t('users.groupMap')}</div>
      <div className="card list-card mb-28">
        {groups.map((g, i) => (
          <div key={g.group} className="list-row">
            <span className="mono grow">{g.group}</span>
            <Icon name="arrow-right" className="muted" />
            <button type="button" className={`tag ${roleTag[g.role]}`} title={t('users.cycleRole')} onClick={() => cycleGroup(i)}>{t(`role.${g.role}`)}</button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label={t('common.delete')} onClick={() => act(() => put('/api/group-roles', groups.filter((_, j) => j !== i)))}><Icon name="x" /></button>
          </div>
        ))}
        <div className="list-row"><button type="button" className="btn btn-ghost" onClick={addGroup}><Icon name="plus" /> {t('users.addGroup')}</button></div>
      </div>

      <div className="section-title">{t('users.sessions')}</div>
      <div className="card list-card">
        {sessions.map(s => (
          <div key={s.id} className="list-row">
            <Icon name={/iPhone|Android|App/.test(s.device) ? 'device-mobile' : 'desktop'} className="lead" />
            <span className="grow">{s.device}<div className="user-mail">{s.user} · {formatAgo(s.lastSeenAt)}{s.current ? ` · ${t('users.thisSession')}` : ''}</div></span>
            {!s.current && <button type="button" className="btn btn-ghost" onClick={() => act(() => del(`/api/sessions/${s.id}`))}>{t('users.revoke')}</button>}
          </div>
        ))}
      </div>
    </>
  );
}
