import 'server-only'

// Auth Imports
import { LOT1_ACTIONS, authorizeLot1, authorizeLot1Operation } from '@/libs/auth/authorization-policy'
import type { TrustedOperatorContext, TrustedUserProtectionFacts } from '@/libs/auth/authorization-policy'

// User Imports
import type { ResolvedUserProtection, UserIdentity } from '@/modules/users/application/get-user-detail.usecase'
import type { ResolvedAccountVisibilityScope } from '@/modules/users/application/list-users.usecase'
import type { KeycloakAccountVisibilityScope } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'

type ServerSession = {
  user?: { id?: string | null } | null
  clientRoles?: readonly string[] | null
}

type SimulatedUnlockDemoConfiguration = { enabled: false } | { enabled: true; accountId: string }

type SimulatedUnlockRouteContext = {
  params: Promise<{ id: string }>
}

type SimulatedUnlockRouteDependencies = {
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
  readConfiguration?: () => SimulatedUnlockDemoConfiguration
}

const NO_STORE_HEADERS = {
  'cache-control': 'private, no-store, max-age=0, must-revalidate',
  expires: '0',
  pragma: 'no-cache'
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE_HEADERS })

const capability = (enabled: boolean, eligible = false) => ({
  simulation: 'local-only' as const,
  enabled,
  eligible,
  simulatedLocked: enabled && eligible
})

const toOperator = (session: ServerSession): TrustedOperatorContext | null => {
  const subject = session.user?.id

  if (typeof subject !== 'string' || !subject) return null

  return {
    subject,
    roles: Array.isArray(session.clientRoles) ? session.clientRoles : [],
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

export const readSimulatedUnlockDemoConfiguration = (
  environment: NodeJS.ProcessEnv = process.env
): SimulatedUnlockDemoConfiguration => {
  if (environment.NODE_ENV !== 'development') return { enabled: false }
  if (environment.ICON_SIMULATED_UNLOCK_DEMO_ENABLED !== 'true') return { enabled: false }

  const accountId = environment.ICON_SIMULATED_UNLOCK_DEMO_ACCOUNT_ID

  if (!accountId || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) return { enabled: false }

  return { enabled: true, accountId }
}

export const createSimulatedUnlockGetHandler =
  (dependencies: SimulatedUnlockRouteDependencies) =>
  async (_request: Request, context: SimulatedUnlockRouteContext) => {
    const configuration = dependencies.readConfiguration?.() ?? readSimulatedUnlockDemoConfiguration()

    if (!configuration.enabled) return json(capability(false))

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

    if (!operationDecision.allowed) return json(capability(true))

    let accountId: string

    try {
      accountId = (await context.params).id
    } catch {
      return json(capability(true))
    }

    if (accountId !== configuration.accountId || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
      return json(capability(true))
    }

    let visibilityScope: ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null

    try {
      visibilityScope = await dependencies.resolveVisibilityScope(operator)
    } catch {
      visibilityScope = null
    }

    if (!visibilityScope || visibilityScope.resolution !== 'approved') return json(capability(true))

    const inScope = dependencies.isAccountIdInScope(visibilityScope.value, accountId)

    if (inScope !== true) return json(capability(true))

    let user: UserIdentity | null

    try {
      user = await dependencies.getUserById(accountId)
    } catch {
      return json(capability(true))
    }

    if (!user || user.id !== accountId) return json(capability(true))

    let resolvedProtection: ResolvedUserProtection | null

    try {
      resolvedProtection = await dependencies.resolveProtection(user)
    } catch {
      resolvedProtection = null
    }

    const protection = readProtection(resolvedProtection)

    if (!protection) return json(capability(true))

    const authorization = authorizeLot1({
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

    return json(capability(true, authorization.allowed))
  }
