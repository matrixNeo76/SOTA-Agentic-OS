/**
 * Fase 20: RBAC Engine — ruoli e permission matrix
 */
export type Role = 'admin' | 'operator' | 'viewer' | 'sovereign'

export const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 4,
  operator: 3,
  sovereign: 2,
  viewer: 1,
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  operator: 'Operator',
  sovereign: 'Sovereign',
  viewer: 'Viewer',
}

export type Permission =
  | 'read'          // tutte le fasi in read-only
  | 'write'         // eseguire azioni (registrar episodi, generare piani, ecc.)
  | 'approve'       // risolvere HITL gates e blocked actions
  | 'manage_users'  // gestire utenti e ruoli
  | 'manage_tools'  // installare/revocare tool
  | 'manage_ltl'    // modificare regole LTL
  | 'view_audit'    // visualizzare audit ledger completo

export const PERMISSION_MATRIX: Record<Role, Permission[]> = {
  admin: ['read', 'write', 'approve', 'manage_users', 'manage_tools', 'manage_ltl', 'view_audit'],
  operator: ['read', 'write', 'approve', 'view_audit'],
  sovereign: ['read', 'approve', 'view_audit'],
  viewer: ['read'],
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX[role]?.includes(permission) ?? false
}

export function hasRoleOrHigher(role: Role, required: Role): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required]
}
