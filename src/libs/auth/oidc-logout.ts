import 'server-only'

type OidcDiscovery = {
  issuer?: unknown
  end_session_endpoint?: unknown
}

export type OidcLogoutConfiguration = {
  clientId: string
  endSessionEndpoint: string
  postLogoutRedirectUri: string
}

const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

const parseTrustedUrl = (value: string, label: string) => {
  const url = new URL(value)
  const localHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname)

  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error(`${label} must use HTTPS outside loopback development`)
  }

  if (url.username || url.password || url.hash) throw new Error(`${label} is malformed`)

  return url
}

export const getCanonicalLoginUrl = () => {
  const authUrl = process.env.AUTH_URL

  if (!authUrl) throw new Error('AUTH_URL is required for OIDC logout')

  const canonicalUrl = parseTrustedUrl(authUrl, 'AUTH_URL')

  if (canonicalUrl.pathname !== '/' || canonicalUrl.search) {
    throw new Error('AUTH_URL must be an origin without a path or query')
  }

  const loginUrl = new URL('/login', canonicalUrl.origin)

  return loginUrl
}

/** Resolves and strictly validates Keycloak's official RP-initiated logout endpoint. */
export const discoverOidcLogoutConfiguration = async (): Promise<OidcLogoutConfiguration> => {
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER
  const clientId = process.env.AUTH_KEYCLOAK_ID

  if (!issuer || !clientId) throw new Error('Keycloak logout configuration is incomplete')

  const issuerUrl = parseTrustedUrl(issuer, 'Keycloak issuer')

  if (issuerUrl.search) throw new Error('Keycloak issuer must not include a query')

  const normalizedIssuer = issuer.replace(/\/+$/, '')
  const discoveryUrl = new URL(`${normalizedIssuer}/.well-known/openid-configuration`)

  const response = await fetch(discoveryUrl, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000)
  })

  if (!response.ok) throw new Error('Keycloak discovery request failed')

  const discovery = (await response.json()) as OidcDiscovery

  if (discovery.issuer !== normalizedIssuer || typeof discovery.end_session_endpoint !== 'string') {
    throw new Error('Keycloak discovery response is invalid')
  }

  const endSessionEndpoint = parseTrustedUrl(discovery.end_session_endpoint, 'Keycloak end-session endpoint')
  const expectedPath = `${issuerUrl.pathname.replace(/\/+$/, '')}/protocol/openid-connect/logout`

  if (
    endSessionEndpoint.origin !== issuerUrl.origin ||
    endSessionEndpoint.pathname !== expectedPath ||
    endSessionEndpoint.search
  ) {
    throw new Error('Keycloak end-session endpoint is not trusted')
  }

  return {
    clientId,
    endSessionEndpoint: endSessionEndpoint.toString(),
    postLogoutRedirectUri: getCanonicalLoginUrl().toString()
  }
}

export const buildOidcLogoutUrl = (configuration: OidcLogoutConfiguration, idToken: string) => {
  if (!idToken) throw new Error('An ID token is required for complete OIDC logout')

  const logoutUrl = new URL(configuration.endSessionEndpoint)

  logoutUrl.searchParams.set('id_token_hint', idToken)
  logoutUrl.searchParams.set('post_logout_redirect_uri', configuration.postLogoutRedirectUri)
  logoutUrl.searchParams.set('client_id', configuration.clientId)

  return logoutUrl
}

export const getPartialLogoutReturnUrl = () => {
  try {
    const loginUrl = getCanonicalLoginUrl()

    loginUrl.searchParams.set('logout', 'partial')

    return loginUrl.toString()
  } catch {
    // The Auth.js session has already been cleared. Keep the failure local and explicit
    // even if the deployment origin itself is misconfigured.
    return '/login?logout=partial'
  }
}
