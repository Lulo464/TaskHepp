export type Role = 'admin' | 'member' | 'read';
export type TokenScope = 'read' | 'tickets:write' | 'admin';

/**
 * What a route needs:
 * - `public`: no authentication (webhook, monitor link, health)
 * - `read`: any signed-in user or token
 * - `member`: create and work on tickets and time
 * - `admin`: everything that changes configuration
 */
export type Access = 'public' | 'read' | 'member' | 'admin';

export interface UserPrincipal {
  kind: 'user';
  sessionId: string;
  user: { id: number; name: string; email: string; role: Role };
}

export interface TokenPrincipal {
  kind: 'token';
  tokenId: number;
  scope: TokenScope;
}

export type Principal = UserPrincipal | TokenPrincipal;

const roleRank: Record<Role, number> = { read: 1, member: 2, admin: 3 };
const accessRank: Record<Exclude<Access, 'public'>, number> = { read: 1, member: 2, admin: 3 };
const scopeRank: Record<TokenScope, number> = { read: 1, 'tickets:write': 2, admin: 3 };

export function allows(principal: Principal, access: Exclude<Access, 'public'>): boolean {
  const rank = principal.kind === 'user' ? roleRank[principal.user.role] : scopeRank[principal.scope];
  return rank >= accessRank[access];
}

/** Highest role among the user's groups, or null when no group is mapped. */
export function roleForGroups(groups: string[], mapping: Map<string, Role>): { role: Role; group: string } | null {
  let best: { role: Role; group: string } | null = null;
  for (const group of groups) {
    const role = mapping.get(group);
    if (role && (!best || roleRank[role] > roleRank[best.role])) best = { role, group };
  }
  return best;
}
