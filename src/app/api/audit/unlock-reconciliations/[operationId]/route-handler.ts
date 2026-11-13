import 'server-only'

// Auth Imports
import { authorizeUnlockAuditReconciliation } from '@/libs/auth/authorization-policy'
import type { TrustedAuditReviewerContext } from '@/libs/auth/authorization-policy'

// Audit Imports
import type {
  UnlockReconciliationEvidenceKind,
  UnlockReconciliationInput
} from '@/modules/users/infrastructure/postgres-user-unlock-audit.coordinator'

type ServerSession = {
  user?: { id?: string | null } | null
  clientRoles?: readonly string[] | null
  clientPermissions?: readonly string[] | null
}

type RouteContext = {
  params: Promise<{ operationId: string }>
}

type ReconciliationResult = {
  reconciliationId: string
}

type RouteDependencies = {
  getSession: () => Promise<ServerSession | null>
  getGracePeriodMilliseconds: () => number
  recordReconciliation: (input: UnlockReconciliationInput) => Promise<ReconciliationResult>
}

class ReconciliationRequestError extends Error {}

const EVIDENCE_KINDS = new Set<UnlockReconciliationEvidenceKind>([
  'KEYCLOAK_ADMIN_EVENT',
  'KEYCLOAK_SERVER_LOG',
  'BACKEND_LOG',
  'OTHER_AUTHORITATIVE'
])

const NO_STORE_HEADERS = {
  'cache-control': 'private, no-store, max-age=0, must-revalidate',
  expires: '0',
  pragma: 'no-cache'
}

const json = (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE_HEADERS })

const toReviewer = (session: ServerSession | null): TrustedAuditReviewerContext | null => {
  const subject = session?.user?.id

  if (typeof subject !== 'string' || !subject) return null

  return {
    subject,
    roles: Array.isArray(session?.clientRoles) ? session.clientRoles : [],
    permissions: Array.isArray(session?.clientPermissions) ? session.clientPermissions : []
  }
}

const readString = (body: Record<string, unknown>, name: string, minimum: number, maximum: number) => {
  const value = body[name]

  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new ReconciliationRequestError()
  }

  return value
}

const readRequest = async (
  request: Request,
  operationId: string,
  reviewerSubject: string,
  gracePeriodMilliseconds: number
): Promise<UnlockReconciliationInput> => {
  if (!/^[1-9][0-9]*$/.test(operationId)) throw new ReconciliationRequestError()

  let body: unknown

  try {
    body = await request.json()
  } catch {
    throw new ReconciliationRequestError()
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReconciliationRequestError()

  const values = body as Record<string, unknown>

  // Reviewer identity is a trusted Auth.js-session fact, never request input.
  if ('reviewer' in values || 'reviewerSubject' in values || 'reviewer_subject' in values) {
    throw new ReconciliationRequestError()
  }

  const status = values.status
  const evidenceKind = values.evidenceKind
  const evidenceReference = readString(values, 'evidenceReference', 1, 1000)
  const rationale = readString(values, 'rationale', 10, 4000)

  if (typeof evidenceKind !== 'string' || !EVIDENCE_KINDS.has(evidenceKind as UnlockReconciliationEvidenceKind)) {
    throw new ReconciliationRequestError()
  }

  if (status === 'PENDING') {
    if (values.outcome !== undefined && values.outcome !== null) throw new ReconciliationRequestError()
    if (values.evidenceConfirmed === true) throw new ReconciliationRequestError()

    return {
      operationId,
      resolvedOutcome: null,
      reviewerSubject,
      evidenceKind: evidenceKind as UnlockReconciliationEvidenceKind,
      evidenceReference,
      rationale,
      evidenceIsDefinitive: false,
      gracePeriodMilliseconds
    }
  }

  if (
    status !== 'RESOLVED' ||
    (values.outcome !== 'SUCCESS' && values.outcome !== 'FAILURE') ||
    values.evidenceConfirmed !== true
  ) {
    throw new ReconciliationRequestError()
  }

  return {
    operationId,
    resolvedOutcome: values.outcome,
    reviewerSubject,
    evidenceKind: evidenceKind as UnlockReconciliationEvidenceKind,
    evidenceReference,
    rationale,
    evidenceIsDefinitive: true,
    gracePeriodMilliseconds
  }
}

const postgresError = (error: unknown) =>
  error && typeof error === 'object'
    ? (error as { code?: unknown; constraint?: unknown })
    : { code: undefined, constraint: undefined }

export const createUnlockAuditReconciliationPostHandler =
  (dependencies: RouteDependencies) => async (request: Request, context: RouteContext) => {
    let session: ServerSession | null

    try {
      session = await dependencies.getSession()
    } catch {
      return json({ error: 'AUTHENTICATION_UNAVAILABLE' }, 500)
    }

    const reviewer = toReviewer(session)
    const authorization = authorizeUnlockAuditReconciliation(reviewer)

    if (!authorization.allowed) {
      return json(
        { error: authorization.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' },
        authorization.reason === 'UNAUTHENTICATED' ? 401 : 403
      )
    }

    let input: UnlockReconciliationInput

    try {
      const operationId = (await context.params).operationId

      input = await readRequest(request, operationId, reviewer!.subject, dependencies.getGracePeriodMilliseconds())
    } catch {
      return json({ error: 'INVALID_RECONCILIATION_REQUEST' }, 400)
    }

    try {
      const result = await dependencies.recordReconciliation(input)

      return json(
        {
          status: input.evidenceIsDefinitive ? 'RESOLVED' : 'PENDING',
          operationId: input.operationId,
          reconciliationId: result.reconciliationId
        },
        201
      )
    } catch (error) {
      const databaseError = postgresError(error)

      if (databaseError.code === '42501' && databaseError.constraint === 'unlock_reconciliation_distinct_reviewer') {
        return json({ error: 'REVIEWER_MUST_DIFFER_FROM_UNLOCK_OPERATOR' }, 403)
      }

      if (databaseError.code === '23505') {
        return json({ error: 'RECONCILIATION_ALREADY_RESOLVED' }, 409)
      }

      if (databaseError.code === '23503' || databaseError.code === '23514') {
        return json({ error: 'RECONCILIATION_NOT_ALLOWED' }, 409)
      }

      return json({ error: 'RECONCILIATION_UNAVAILABLE' }, 503)
    }
  }
