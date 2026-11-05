/** Pure, unit-testable helpers for Keycloak realm-role and display claims. */

// Realm Role (not a Client Role) required to access the I-Con portal.
export const PORTAL_REALM_ROLE = 'portal-ops-n1'

// Display labels for known realm roles.
const PROFILE_LABELS: Readonly<Record<string, string>> = {
  [PORTAL_REALM_ROLE]: 'OPS-N1 — Support'
}

export type Claims = Record<string, unknown>

// Reads Keycloak's `realm_access.roles` claim. Returns null when the claim is absent or malformed.
export const readRealmRoles = (claims: Claims | null | undefined): string[] | null => {
  const realmAccess = claims?.realm_access

  if (!realmAccess || typeof realmAccess !== 'object') return null

  const roles = (realmAccess as { roles?: unknown }).roles

  if (!Array.isArray(roles)) return null

  return roles.filter((role): role is string => typeof role === 'string')
}

export const hasRealmRole = (roles: readonly string[] | null | undefined, role: string): boolean =>
  Array.isArray(roles) && roles.includes(role)

export const getProfileLabel = (roles: readonly string[] | null | undefined): string | null => {
  const role = Object.keys(PROFILE_LABELS).find(known => hasRealmRole(roles, known))

  return role ? PROFILE_LABELS[role] : null
}

// First name from the authenticated identity: `given_name` claim, otherwise first word of `name`.
export const getFirstName = (user: { givenName?: string | null; name?: string | null } | null | undefined) =>
  user?.givenName?.trim() || user?.name?.trim().split(/\s+/)[0] || null

