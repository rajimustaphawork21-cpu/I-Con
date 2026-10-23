// Next Imports
import { redirect } from 'next/navigation'

import type { Metadata } from 'next'

// Component Imports
import Login from '@views/Login'

// Server Action Imports
import { getServerMode } from '@core/utils/serverHelpers'

// Auth Imports
import { getAuthenticatedSession } from '../../../../modules/auth/infrastructure/server-session'

export const metadata: Metadata = {
  title: 'Login',
  description: 'Login to your account'
}

type Props = {
  searchParams: Promise<{ error?: string }>
}

const LoginPage = async ({ searchParams }: Props) => {
  // A valid session never needs the login page.
  if (await getAuthenticatedSession()) {
    redirect('/home')
  }

  // Vars
  const mode = await getServerMode()
  const { error } = await searchParams

  // Provider error details are never shown to the user.
  return <Login mode={mode} hasError={Boolean(error)} />
}

export default LoginPage
