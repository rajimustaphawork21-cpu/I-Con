'use client'

// Type Imports
import type { ReactNode } from 'react'

import type { Session } from 'next-auth'

// Third-party Imports
import { SessionProvider } from 'next-auth/react'

type Props = {
  children: ReactNode
  session: Session
}

// Background polling and focus refetching are disabled so they can never be mistaken for user activity.
const AuthSessionProvider = ({ children, session }: Props) => (
  <SessionProvider session={session} refetchInterval={0} refetchOnWindowFocus={false}>
    {children}
  </SessionProvider>
)

export default AuthSessionProvider
