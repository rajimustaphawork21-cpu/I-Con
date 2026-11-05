import 'server-only'

// Third-party Imports
import { createRemoteJWKSet, jwtVerify } from 'jose'

// Lib Imports
import { readRealmRoles } from '@/libs/auth/claims'
import type { Claims } from '@/libs/auth/claims'

export type RealmRoleSource = 'id_token' | 'access_token' | 'none'

const ACCESS_TOKEN_ALGORITHMS = ['RS256'] as const
const remoteJwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

/**
 * The JWKS transport must be HTTPS outside local development. The issuer is a trusted server-side
 * setting, never browser input. Keycloak rotates signing keys, so jose's remote JWKS cache is reused.
 */
const getRemoteJwks = (issuer: string) => {
  const issuerUrl = new URL(issuer)
  const localHttp = issuerUrl.protocol === 'http:' && isLoopbackHost(issuerUrl.hostname)

  if (issuerUrl.protocol !== 'https:' && !localHttp) {
    throw new Error('Keycloak issuer must use HTTPS outside loopback development')
  }

  const normalizedIssuer = issuer.replace(/\/+$/, '')
  const cached = remoteJwksByIssuer.get(normalizedIssuer)

  if (cached) return cached

  const remoteJwks = createRemoteJWKSet(new URL(`${normalizedIssuer}/protocol/openid-connect/certs`), {
    timeoutDuration: 5000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000
  })

  remoteJwksByIssuer.set(normalizedIssuer, remoteJwks)

  return remoteJwks
}

const verifyAccessTokenRoles = async (input: { accessToken: string; issuer: string; clientId: string }) => {
  const { payload } = await jwtVerify(input.accessToken, getRemoteJwks(input.issuer), {
    issuer: input.issuer,
    algorithms: [...ACCESS_TOKEN_ALGORITHMS],
    requiredClaims: ['iss', 'exp', 'azp']
  })

  // Keycloak's `azp` identifies the OAuth client to which the access token was issued.
  if (payload.azp !== input.clientId) return null

  return readRealmRoles(payload as Claims)
}

/**
 * Extracts Keycloak realm roles once, at sign-in, and defaults to no roles on every failure.
 *
 * 1. Prefer Auth.js-validated ID-token claims (`realm_access.roles`).
 * 2. If the ID-token mapper is absent, verify the access-token signature against Keycloak JWKS,
 *    then validate issuer, expiry, authorized party, and the same realm-role claim.
 *
 * Provider tokens never enter the Auth.js session and browser-supplied role values are never read.
 */
export const extractRealmRoles = async (input: {
  idTokenClaims: Claims | null | undefined
  accessToken: string | undefined
  issuer: string | undefined
  clientId: string | undefined
}): Promise<{ roles: string[]; source: RealmRoleSource }> => {
  const fromIdToken = readRealmRoles(input.idTokenClaims)

  if (fromIdToken !== null) return { roles: fromIdToken, source: 'id_token' }

  if (input.accessToken && input.issuer && input.clientId) {
    try {
      const fromAccessToken = await verifyAccessTokenRoles({
        accessToken: input.accessToken,
        issuer: input.issuer,
        clientId: input.clientId
      })

      if (fromAccessToken !== null) return { roles: fromAccessToken, source: 'access_token' }
    } catch {
      // Deliberately default-deny without logging token material or verification internals.
    }
  }

  return { roles: [], source: 'none' }
}
