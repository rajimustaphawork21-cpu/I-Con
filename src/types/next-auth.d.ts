import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {

  /** Public session: display name and enforced expiry only; no tokens, email or roles. */
  interface Session extends DefaultSession {
    user: { name: string }
    expires: string
  }
}
