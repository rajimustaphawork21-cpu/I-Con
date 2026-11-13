import 'server-only'

// Auth Imports
import { LOT1_ACTIONS, authorizeLot1, authorizeLot1Operation } from '@/libs/auth/authorization-policy'
import type { TrustedOperatorContext, TrustedUserProtectionFacts } from '@/libs/auth/authorization-policy'

// User Imports
import type { ResolvedUserProtection, UserIdentity } from '@/modules/users/application/get-user-detail.usecase'
import { AccountVisibilityScopeUnavailableError } from '@/modules/users/application/list-users.usecase'
import type { ResolvedAccountVisibilityScope } from '@/modules/users/application/list-users.usecase'
import {
  UnlockUserAuditUnavailableError,
  UnlockUserAuthorizationError,
  UnlockUserConfirmationRequiredError,
  UnlockUserLockStatusUnavailableError,
  UnlockUserNotFoundError,
  UnlockUserOperationFailedError,
  UnlockUserOutcomeUnknownError,
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

export type LocalDevelopmentUnlockConfiguration =
  | { enabled: false }
  | {
      enabled: true
      accountId: string
    }

export type UserUnlockStatusDto = {
  enabled: boolean
  eligible: boolean
  locked: boolean | null
}

type UserUnlockGetRouteDependencies = {
  getSession: () => Promise<ServerSession | null>
  resolveVisibilityScope: (
    operator: TrustedOperatorContext
  ) =>
    | Promise<ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null>
    | ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope>
    | null
  isAccountIdInScope: (scope: KeycloakAccountVisibilityScope, accountId: string) => boolean | null
  getUserById: (accountId: string) => Promise<UserIdentity | null>
  resolveProtection: (user: UserIdentity) => Promise<ResolvedUserProtection | null>
  isLocked: (accountId: string) => Promise<boolean>
  readConfiguration?: () => LocalDevelopmentUnlockConfiguration
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

const json = (body: unknown, status: number, correlationId?: string) =>
  Response.json(body, {
    status,
    headers: correlationId ? { ...NO_STORE_HEADERS, 'x-correlation-id': correlationId } : NO_STORE_HEADERS
  })

const unlockStatus = (enabled: boolean, eligible = false, locked: boolean | null = null): UserUnlockStatusDto => ({
  enabled,
  eligible,
  locked
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

const readProtection = (value: ResolvedUserProtection | null): TrustedUserProtectionFacts | null => {
  const protection = value?.value

  if (
    value?.resolution !== 'resolved' ||
    !protection ||
    typeof protection.hasRealmManagementRole !== 'boolean' ||
    typeof protection.hasRealmAdministrationRole !== 'boolean' ||
    typeof protection.isSsoAdministratorsGroupMember !== 'boolean' ||
    typeof protection.hasProtectedAttribute !== 'boolean' ||
    typeof protection.isServiceAccount !== 'boolean'
  ) {
    return null
  }

  return protection
}

export const readLocalDevelopmentUnlockConfiguration = (
  environment: NodeJS.ProcessEnv = process.env
): LocalDevelopmentUnlockConfiguration => {
  if (environment.NODE_ENV !== 'development') return { enabled: false }
  if (environment.ICON_DEV_LIVE_UNLOCK_ENABLED !== 'true') return { enabled: false }

  const accountId = environment.ICON_DEV_LIVE_UNLOCK_ACCOUNT_ID?.trim()
  const adminUrl = environment.ICON_KEYCLOAK_ADMIN_URL?.trim()
  const realm = environment.ICON_KEYCLOAK_REALM?.trim()
  const unlockClientId = environment.ICON_KEYCLOAK_USER_UNLOCK_CLIENT_ID?.trim()
  const unlockClientSecret = environment.ICON_KEYCLOAK_USER_UNLOCK_CLIENT_SECRET?.trim()
  const directoryClientId = environment.ICON_KEYCLOAK_DIRECTORY_CLIENT_ID?.trim()

  if (
    !accountId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) ||
    !adminUrl ||
    realm !== 'I-Con' ||
    !unlockClientId ||
    !unlockClientSecret ||
    unlockClientId === directoryClientId
  ) {
    return { enabled: false }
  }

  try {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(adminUrl).hostname)) {
      return { enabled: false }
    }
  } catch {
    return { enabled: false }
  }

  return {
    enabled: true,
    accountId
  }
}

export const createUserUnlockGetHandler =
  (dependencies: UserUnlockGetRouteDependencies) => async (_request: Request, context: UserUnlockRouteContext) => {
    const configuration = dependencies.readConfiguration?.() ?? readLocalDevelopmentUnlockConfiguration()

    if (!configuration.enabled) return json(unlockStatus(false), 200)

    let session: ServerSession | null

    try {
      session = await dependencies.getSession()
    } catch {
      return json({ error: 'AUTHENTICATION_UNAVAILABLE' }, 500)
    }

    if (!session) return json({ error: 'UNAUTHENTICATED' }, 401)

    const operator = toOperator(session)

    if (!operator) return json({ error: 'UNAUTHENTICATED' }, 401)

    const operationDecision = authorizeLot1Operation({
      operator,
      action: LOT1_ACTIONS.userUnlock
    })

    if (!operationDecision.allowed) return json(unlockStatus(true), 200)

    let accountId: string

    try {
      accountId = (await context.params).id
    } catch {
      return json(unlockStatus(false), 200)
    }

    if (accountId !== configuration.accountId || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
      return json(unlockStatus(false), 200)
    }

    let visibilityScope: ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null

    try {
      visibilityScope = await dependencies.resolveVisibilityScope(operator)
    } catch {
      visibilityScope = null
    }

    if (!visibilityScope || visibilityScope.resolution !== 'approved') return json(unlockStatus(true), 200)

    const inScope = dependencies.isAccountIdInScope(visibilityScope.value, accountId)

    if (inScope !== true) return json(unlockStatus(true), 200)

    let user: UserIdentity | null

    try {
      user = await dependencies.getUserById(accountId)
    } catch {
      return json(unlockStatus(true), 200)
    }

    if (!user || user.id !== accountId) return json(unlockStatus(true), 200)

    let resolvedProtection: ResolvedUserProtection | null

    try {
      resolvedProtection = await dependencies.resolveProtection(user)
    } catch {
      resolvedProtection = null
    }

    const protection = readProtection(resolvedProtection)

    if (!protection) return json(unlockStatus(true), 200)

    const targetDecision = authorizeLot1({
      operator,
      action: LOT1_ACTIONS.userUnlock,
      target: {
        user: {
          id: user.id,
          username: user.username,
          isLocked: true,
          protection
        }
      }
    })

    if (!targetDecision.allowed) return json(unlockStatus(true), 200)

    let isLocked: boolean

    try {
      isLocked = await dependencies.isLocked(user.id)
    } catch {
      return json(unlockStatus(true), 200)
    }

    const authorization = authorizeLot1({
      operator,
      action: LOT1_ACTIONS.userUnlock,
      target: {
        user: {
          id: user.id,
          username: user.username,
          isLocked,
          protection
        }
      }
    })

    return json(unlockStatus(true, authorization.allowed, isLocked), 200)
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

      if (error instanceof UnlockUserOutcomeUnknownError) {
        return json({ error: error.code, correlationId }, 503, correlationId)
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
