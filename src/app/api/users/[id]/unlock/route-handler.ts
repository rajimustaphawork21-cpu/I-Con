import 'server-only'

// Auth Imports
import type { TrustedOperatorContext } from '@/libs/auth/authorization-policy'

// User Imports
import { AccountVisibilityScopeUnavailableError } from '@/modules/users/application/list-users.usecase'
import type { ResolvedAccountVisibilityScope } from '@/modules/users/application/list-users.usecase'
import {
  UnlockUserAuditUnavailableError,
  UnlockUserAuthorizationError,
  UnlockUserConfirmationRequiredError,
  UnlockUserLockStatusUnavailableError,
  UnlockUserNotFoundError,
  UnlockUserOperationFailedError,
  UnlockUserProtectionUnavailableError
} from '@/modules/users/application/unlock-user.usecase'
import type { TrustedUnlockUserContext, UnlockUserRequest } from '@/modules/users/application/unlock-user.usecase'
import type { KeycloakAccountVisibilityScope } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'

type ServerSession = {
  user?: { id?: string | null } | null
  clientRoles?: readonly string[] | null
}

type UserUnlockRouteContext = {
  params: Promise<{ id: string }>
}

type UserUnlockRouteDependencies = {
  getSession: () => Promise<ServerSession | null>
  resolveVisibilityScope: (
    operator: TrustedOperatorContext
  ) =>
    | Promise<ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null>
    | ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope>
    | null
  executeUnlock: (
    accountId: unknown,
    request: UnlockUserRequest,
    trusted: TrustedUnlockUserContext<KeycloakAccountVisibilityScope>
  ) => Promise<{ id: string }>
  createCorrelationId?: () => string
}

const NO_STORE_HEADERS = {
  'cache-control': 'private, no-store, max-age=0, must-revalidate',
  expires: '0',
  pragma: 'no-cache'
}

const json = (body: unknown, status: number, correlationId: string) =>
  Response.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, 'x-correlation-id': correlationId }
  })

const toOperator = (session: ServerSession | null): TrustedOperatorContext | null => {
  const subject = session?.user?.id

  if (typeof subject !== 'string' || !subject) return null

  return {
    subject,
    roles: Array.isArray(session?.clientRoles) ? session.clientRoles : [],
    delegatedApplicationIds: [],
    delegableRoleIds: [],
    delegableGroupIds: [],
    modifiableProfileFields: []
  }
}

const readRequest = async (request: Request): Promise<UnlockUserRequest> => {
  try {
    const body: unknown = await request.json()

    if (!body || typeof body !== 'object' || Array.isArray(body)) return {}

    return { confirmed: (body as Record<string, unknown>).confirmed }
  } catch {
    return {}
  }
}

export const createUserUnlockPostHandler =
  (dependencies: UserUnlockRouteDependencies) => async (request: Request, context: UserUnlockRouteContext) => {
    const correlationId = dependencies.createCorrelationId?.() ?? crypto.randomUUID()
    let session: ServerSession | null

    try {
      session = await dependencies.getSession()
    } catch {
      return json({ error: 'AUTHENTICATION_UNAVAILABLE' }, 500, correlationId)
    }

    const operator = toOperator(session)
    let visibilityScope: ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null = null

    if (operator) {
      try {
        visibilityScope = await dependencies.resolveVisibilityScope(operator)
      } catch {
        visibilityScope = null
      }
    }

    let accountId: unknown

    try {
      accountId = (await context.params).id
    } catch {
      accountId = undefined
    }

    try {
      const result = await dependencies.executeUnlock(accountId, await readRequest(request), {
        operator,
        accountVisibilityScope: visibilityScope,
        correlationId
      })

      return json({ status: 'USER_UNLOCKED', id: result.id }, 200, correlationId)
    } catch (error) {
      if (error instanceof UnlockUserAuthorizationError) {
        if (error.reason === 'UNAUTHENTICATED') {
          return json({ error: 'UNAUTHENTICATED' }, 401, correlationId)
        }

        if (error.reason === 'ACCOUNT_NOT_LOCKED') {
          return json({ error: error.reason }, 409, correlationId)
        }

        return json({ error: 'FORBIDDEN' }, 403, correlationId)
      }

      if (error instanceof UnlockUserConfirmationRequiredError) {
        return json({ error: error.code }, 400, correlationId)
      }

      if (error instanceof AccountVisibilityScopeUnavailableError) {
        return json({ error: 'FORBIDDEN' }, 403, correlationId)
      }

      if (error instanceof UnlockUserNotFoundError) {
        return json({ error: error.code }, 404, correlationId)
      }

      if (
        error instanceof UnlockUserProtectionUnavailableError ||
        error instanceof UnlockUserLockStatusUnavailableError ||
        error instanceof UnlockUserAuditUnavailableError
      ) {
        return json({ error: error.code }, 503, correlationId)
      }

      if (error instanceof UnlockUserOperationFailedError) {
        return json({ error: error.code }, 502, correlationId)
      }

      return json({ error: 'INTERNAL_ERROR' }, 500, correlationId)
    }
  }
