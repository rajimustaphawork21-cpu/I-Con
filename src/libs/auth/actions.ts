'use server'

// Next Imports
import { redirect } from 'next/navigation'

// Auth Imports
import { signIn, signOut } from '@/auth'

// Lib Imports
import { captureIdTokenDuringSignOut } from '@/libs/auth/logout-context'
import {
  buildOidcLogoutUrl,
  discoverOidcLogoutConfiguration,
  getPartialLogoutReturnUrl
} from '@/libs/auth/oidc-logout'
import type { OidcLogoutConfiguration } from '@/libs/auth/oidc-logout'

// Starts the OIDC Authorization Code + PKCE flow and redirects the browser to Keycloak.
// After the callback, /welcome performs the server-side realm role check.
export const signInWithKeycloak = async () => {
  await signIn('keycloak', { redirectTo: '/welcome' })
}

/**
 * Clears the local Auth.js session and redirects the browser to Keycloak RP-initiated logout.
 * The form-backed Server Action supplies same-origin POST/CSRF protection; no redirect is user-provided.
 */
export const signOutWithKeycloak = async () => {
  let logoutConfiguration: OidcLogoutConfiguration | null = null

  try {
    logoutConfiguration = await discoverOidcLogoutConfiguration()
  } catch {
    // Local sign-out still proceeds, but the login page explicitly reports incomplete SSO logout.
  }

  const idToken = await captureIdTokenDuringSignOut(async () => {
    await signOut({ redirect: false, redirectTo: '/login' })
  })

  if (!logoutConfiguration || !idToken) redirect(getPartialLogoutReturnUrl())

  let keycloakLogoutUrl: URL | null = null

  try {
    keycloakLogoutUrl = buildOidcLogoutUrl(logoutConfiguration, idToken)
  } catch {
    // The local session is already closed; do not claim complete SSO logout.
  }

  if (!keycloakLogoutUrl) redirect(getPartialLogoutReturnUrl())

  redirect(keycloakLogoutUrl.toString())
}
