import 'server-only'

// Next Imports
import { forbidden, redirect } from 'next/navigation'

// Auth Imports
import { auth } from '@/auth'

// Lib Imports
import { PORTAL_REALM_ROLE, hasRealmRole } from '@/libs/auth/claims'

/**
 * Server-side guard for protected I-Con pages (default deny).
 * - No session                      -> redirect to /login
 * - Session without portal-ops-n1   -> 403 (app/forbidden.tsx)
 */
export const requirePortalAccess = async () => {
  const session = await auth()

  if (!session?.user) redirect('/login')

  if (!hasRealmRole(session.realmRoles, PORTAL_REALM_ROLE)) forbidden()

  return session
}

