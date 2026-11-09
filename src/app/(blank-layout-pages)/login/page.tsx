// Next Imports
import { redirect } from 'next/navigation'

import type { Metadata } from 'next'

// Component Imports
import Login from '@views/Login'

// Server Action Imports
import { getServerMode } from '@core/utils/serverHelpers'

// Auth Imports
import { auth } from '@/auth'
import { hasPortalAccess } from '@/libs/auth/claims'

export const metadata: Metadata = {
  title: 'Connexion | I-Con',
  description: 'Connectez-vous au portail professionnel I-Con.'
}

type Props = {
  searchParams: Promise<{ error?: string | string[]; logout?: string | string[] }>
}

const LoginPage = async ({ searchParams }: Props) => {
  // Vars
  const mode = await getServerMode()
  const session = await auth()
  const { error, logout } = await searchParams

  // Authorized users go straight to the protected Welcome page.
  if (session?.user && hasPortalAccess(session.clientRoles)) redirect('/welcome')

  // Authenticated but unauthorized users stay here (no redirect loop) and see an access notice.
  // Only non-sensitive display fields are passed to the client component.
  const user = session?.user ? { name: session.user.name ?? null, email: session.user.email ?? null } : null

  return (
    <Login
      mode={mode}
      user={user}
      authError={typeof error === 'string' ? error : undefined}
      logoutIncomplete={logout === 'partial'}
    />
  )
}

export default LoginPage
