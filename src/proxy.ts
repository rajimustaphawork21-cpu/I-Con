import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getToken } from 'next-auth/jwt'

import { isSessionActive, readSessionClaims } from '../modules/auth/domain/session-policy'

/**
 * Authentication gate for every page navigation (including client-side RSC
 * navigations that skip layouts). It only checks that a valid, unexpired
 * session exists; it grants no administrative permission. The Dashboard layout
 * repeats the check as defense in depth.
 */
export async function proxy(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET
  const secureCookie = (process.env.NEXTAUTH_URL ?? '').startsWith('https://')

  const token = secret ? await getToken({ req: request, secret, secureCookie }).catch(() => null) : null
  const claims = readSessionClaims(token)

  if (claims && isSessionActive(claims, Date.now())) {
    return NextResponse.next()
  }

  const loginUrl = request.nextUrl.clone()

  loginUrl.pathname = '/login'
  loginUrl.search = ''

  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Users APIs own their JSON 401/403 responses; page requests keep redirects.
  matcher: ['/((?!api/auth|api/users|login|_next/static|_next/image|images|favicon.ico).*)']
}
