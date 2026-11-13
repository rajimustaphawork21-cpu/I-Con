/** Pure, unit-testable helpers for Keycloak client-role and display claims. */

export const PORTAL_CLIENT_ID = 'icon-bff'
export const PORTAL_CLIENT_ROLES = ['OPS-N1', 'ADM-APP', 'AUD', 'ADM-CONSOLE'] as const
export const ICON_CLIENT_PERMISSIONS = ['audit:unlock:reconcile'] as const

export type PortalClientRole = (typeof PORTAL_CLIENT_ROLES)[number]
export type IconClientPermission = (typeof ICON_CLIENT_PERMISSIONS)[number]

const PROFILE_LABELS: Readonly<Record<PortalClientRole, string>> = {
  'OPS-N1': 'OPS-N1 — Support',
  'ADM-APP': 'ADM-APP — Administration applicative',
  AUD: 'AUD — Audit',
  'ADM-CONSOLE': 'ADM-CONSOLE — Administration console'
}

export type Claims = Record<string, unknown>

// Reads exact roles from `resource_access[clientId].roles`. Missing and malformed claims fail closed.
export const readClientRoles = (
  claims: Claims | null | undefined,
  clientId: string | null | undefined
): string[] | null => {
  if (!clientId) return null

  const resourceAccess = claims?.resource_access

  if (!resourceAccess || typeof resourceAccess !== 'object' || Array.isArray(resourceAccess)) return null

  const clientAccess = (resourceAccess as Record<string, unknown>)[clientId]

  if (!clientAccess || typeof clientAccess !== 'object' || Array.isArray(clientAccess)) return null

  const roles = (clientAccess as { roles?: unknown }).roles

  if (!Array.isArray(roles) || !roles.every((role): role is string => typeof role === 'string')) return null

  return [...new Set(roles)]
}

export const hasClientRole = (roles: readonly string[] | null | undefined, role: string): boolean =>
  Array.isArray(roles) && roles.includes(role)

export const hasAnyClientRole = (
  roles: readonly string[] | null | undefined,
  allowedRoles: readonly string[]
): boolean => allowedRoles.length > 0 && allowedRoles.some(role => hasClientRole(roles, role))

export const hasPortalAccess = (roles: readonly string[] | null | undefined): boolean =>
  hasAnyClientRole(roles, PORTAL_CLIENT_ROLES)

export const getPortalClientRoles = (roles: readonly string[] | null | undefined): PortalClientRole[] =>
  PORTAL_CLIENT_ROLES.filter(role => hasClientRole(roles, role))

export const getIconClientPermissions = (roles: readonly string[] | null | undefined): IconClientPermission[] =>
  ICON_CLIENT_PERMISSIONS.filter(permission => hasClientRole(roles, permission))

export const getProfileLabel = (roles: readonly string[] | null | undefined): string | null => {
  const role = PORTAL_CLIENT_ROLES.find(known => hasClientRole(roles, known))

  return role ? PROFILE_LABELS[role] : null
}

// First name from the authenticated identity: `given_name` claim, otherwise first word of `name`.
export const getFirstName = (user: { givenName?: string | null; name?: string | null } | null | undefined) =>
  user?.givenName?.trim() || user?.name?.trim().split(/\s+/)[0] || null
