import type { NextRequest } from 'next/server'

import NextAuth from 'next-auth'

import { getAuthOptions } from '../../../../../modules/auth/infrastructure/auth-options'

type RouteContext = { params: Promise<{ nextauth: string[] }> }

const handler = (request: NextRequest, context: RouteContext) => NextAuth(request, context, getAuthOptions())

export { handler as GET, handler as POST }
