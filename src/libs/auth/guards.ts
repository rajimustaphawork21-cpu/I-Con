import 'server-only'

// Next Imports
import { forbidden, redirect } from 'next/navigation'

// Auth Imports
import { auth } from '@/auth'

// Lib Imports
import { PORTAL_CLIENT_ROLES, hasAnyClientRole } from '@/libs/auth/claims'
import type { PortalClientRole } from '@/libs/auth/claims'

/**
 * Server-side role guard for protected I-Con pages (default deny).
 * - No session                         -> redirect to /login
 * - No exact allowed icon-bff role     -> 403 (app/forbidden.tsx)
 *
 * Feature routes can pass the role subset allowed by their CDCF/CDCT policy.
 */
export const requireAnyPortalRole = async (allowedRoles: readonly PortalClientRole[]) => {
  const session = await auth()

  if (!session?.user) redirect('/login')

  if (!hasAnyClientRole(session.clientRoles, allowedRoles)) forbidden()

  return session
}

export const requirePortalAccess = () => requireAnyPortalRole(PORTAL_CLIENT_ROLES)

