import type { NextRequest } from 'next/server'

import { createUsersReadUseCases } from '../../../../lib/infrastructure/users-read.composition'
import { getAuthenticatedSubject } from '../../../../modules/auth/infrastructure/request-subject'
import { handleListUsersRequest } from './users-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return handleListUsersRequest(request, {
    getSubject: () => getAuthenticatedSubject(request),
    createUseCases: createUsersReadUseCases
  })
}
