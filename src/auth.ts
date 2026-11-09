// Third-party Imports
import NextAuth from 'next-auth'
import type { DefaultSession } from 'next-auth'
import Keycloak from 'next-auth/providers/keycloak'

// Lib Imports
import { PORTAL_CLIENT_ID, getPortalClientRoles, hasPortalAccess } from '@/libs/auth/claims'
import { captureLogoutIdToken } from '@/libs/auth/logout-context'
import { extractClientRoles } from '@/libs/auth/realm-roles'

declare module 'next-auth' {
  interface Session {
    clientRoles: string[] // Validated Keycloak client roles; provider tokens are never exposed on Session.
    user: { id: string; givenName?: string | null } & DefaultSession['user']
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    idToken?: string
    clientRoles?: string[]
    givenName?: string
  }
}

/**
 * Auth.js configuration (server-side only).
 *
 * The Keycloak provider reads its settings from the environment:
 * - AUTH_KEYCLOAK_ID      -> OIDC client ID (icon-bff)
 * - AUTH_KEYCLOAK_SECRET  -> confidential client secret (never sent to the browser)
 * - AUTH_KEYCLOAK_ISSUER  -> http://localhost:8080/realms/I-Con
 * - AUTH_SECRET           -> encrypts the session cookie (JWE)
 *
 * Flow: OIDC Authorization Code + PKCE (S256) + state. Auth.js validates the ID-token response.
 * Client roles prefer those validated ID-token claims; the access-token fallback independently
 * verifies its RS256 signature against Keycloak JWKS. Keycloak must use HTTPS outside loopback.
 *
 * AUTH_URL defines the canonical deployment origin. A reverse proxy may set AUTH_TRUST_HOST=true
 * only when it overwrites trusted forwarding headers and the Next.js server is not directly exposed.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      checks: ['pkce', 'state']
    })
  ],
  session: {
    // Encrypted, httpOnly session cookie. The ID token is retained only to send back to
    // Keycloak as an RP-initiated logout hint; it is never exposed by the session callback.
    strategy: 'jwt',
    maxAge: 8 * 60 * 60 // 8 hours
  },
  pages: {
    // Use the existing I-Con login page instead of Auth.js built-in pages.
    signIn: '/login',
    error: '/login'
  },
  events: {
    signOut(message) {
      if ('token' in message) captureLogoutIdToken(message.token)
    }
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      // Initial sign-in only: keep the minimal claims needed by the app. The ID token stays
      // inside Auth.js's encrypted cookie and is used only for Keycloak RP-initiated logout.
      if (account && profile) {
        // A mismatched OAuth Client is a deployment error and must not authorize roles from another Client.
        const clientId = process.env.AUTH_KEYCLOAK_ID === PORTAL_CLIENT_ID ? PORTAL_CLIENT_ID : undefined

        const { roles: claimedRoles, source } = await extractClientRoles({
          idTokenClaims: profile,
          accessToken: account.access_token,
          issuer: process.env.AUTH_KEYCLOAK_ISSUER,
          clientId
        })

        const clientRoles = getPortalClientRoles(claimedRoles)

        token.idToken = typeof account.id_token === 'string' ? account.id_token : undefined
        token.clientRoles = clientRoles
        token.givenName = typeof profile.given_name === 'string' ? profile.given_name : undefined

        if (process.env.NODE_ENV === 'development') {
          console.info(`[auth] client roles claim source: ${source}; portal access: ${hasPortalAccess(clientRoles)}`)
        }
      }

      return token
    },
    session({ session, token }) {
      session.clientRoles = getPortalClientRoles(token.clientRoles)
      session.user.id = token.sub ?? ''
      session.user.givenName = token.givenName ?? null

      return session
    }
  }
})
