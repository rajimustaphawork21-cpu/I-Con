import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { loadAuthConfig } from '../../../../../modules/auth/infrastructure/auth-config'
import {
  AUTH_COOKIE_NAMES_TO_CLEAR,
  CSRF_COOKIE_NAMES,
  buildKeycloakLogoutUrl,
  isSameOriginRequest,
  verifyCsrfToken
} from '../../../../../modules/auth/infrastructure/logout-request'

export const dynamic = 'force-dynamic'

const forbidden = () => new NextResponse(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })

/**
 * Starts Keycloak SSO logout. Only reachable by a same-origin form POST that
 * carries a valid Auth.js CSRF token; a plain GET navigation is rejected (405).
 */
export async function POST(request: NextRequest) {
  const config = loadAuthConfig()

  const sameOrigin = isSameOriginRequest(
    {
      origin: request.headers.get('origin'),
      secFetchSite: request.headers.get('sec-fetch-site')
    },
    config.appUrl
  )

  if (!sameOrigin) {
    return forbidden()
  }

  const formData = await request.formData().catch(() => null)
  const submittedToken = formData?.get('csrfToken')

  const cookieValue = CSRF_COOKIE_NAMES.map(name => request.cookies.get(name)?.value).find(Boolean)

  const csrfValid = verifyCsrfToken({
    cookieValue,
    submittedToken: typeof submittedToken === 'string' ? submittedToken : undefined,
    secret: config.secret
  })

  if (!csrfValid) {
    return forbidden()
  }

  const response = NextResponse.redirect(buildKeycloakLogoutUrl(config), 303)
  const secure = config.appUrl.startsWith('https://')

  for (const name of AUTH_COOKIE_NAMES_TO_CLEAR) {
    response.cookies.set(name, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax', secure })
  }

  response.headers.set('Cache-Control', 'no-store')

  return response
}
