import 'server-only'

// Auth Imports
import type { TrustedOperatorContext, TrustedUserProtectionFacts } from '@/libs/auth/authorization-policy'

// User Imports
import {
  GetUserDetailAuthorizationError,
  ProtectedAccountReadAuditUnavailableError,
  UserDetailNotFoundError,
  UserProtectionUnavailableError
} from '@/modules/users/application/get-user-detail.usecase'
import type {
  ResolvedUserProtection,
  TrustedGetUserDetailContext,
  UserIdentity
} from '@/modules/users/application/get-user-detail.usecase'
import { AccountVisibilityScopeUnavailableError } from '@/modules/users/application/list-users.usecase'
import type { ResolvedAccountVisibilityScope } from '@/modules/users/application/list-users.usecase'
import { KeycloakUserDirectoryError } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'
import type { KeycloakAccountVisibilityScope } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'

type ServerSession = {
  user?: { id?: string | null } | null
  clientRoles?: readonly string[] | null
}

type UserDetailRouteContext = {
  params: Promise<{ id: string }>
}

type UserDetailRouteDependencies = {
  getSession: () => Promise<ServerSession | null>
  resolveVisibilityScope: (
    operator: TrustedOperatorContext
  ) =>
    | Promise<ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null>
    | ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope>
    | null
  executeGetUserDetail: (
    accountId: unknown,
    trusted: TrustedGetUserDetailContext<KeycloakAccountVisibilityScope>
  ) => Promise<UserIdentity>
}

const NO_STORE_HEADERS = {
  'cache-control': 'private, no-store, max-age=0, must-revalidate',
  expires: '0',
  pragma: 'no-cache'
}

const json = (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE_HEADERS })

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

const toIdentityDto = (user: UserIdentity): UserIdentity => ({
  id: user.id,
  username: user.username,
  ...(user.firstName === undefined ? {} : { firstName: user.firstName }),
  ...(user.lastName === undefined ? {} : { lastName: user.lastName }),
  ...(user.email === undefined ? {} : { email: user.email }),
  enabled: user.enabled
})

const unresolvedScopeError = () => json({ error: 'FORBIDDEN' }, 403)
const notFound = () => json({ error: 'USER_NOT_FOUND' }, 404)

export const isKeycloakAccountIdInScope = (scope: KeycloakAccountVisibilityScope, accountId: string) => {
  if (!scope || typeof scope !== 'object') return null
  if (scope.mode === 'realm-wide') return true

  if (
    scope.mode !== 'account-ids' ||
    !Array.isArray(scope.accountIds) ||
    !scope.accountIds.every(id => typeof id === 'string' && id.length > 0)
  ) {
    return null
  }

  return scope.accountIds.includes(accountId)
}

const noProtection: TrustedUserProtectionFacts = {
  hasRealmManagementRole: false,
  hasRealmAdministrationRole: false,
  isSsoAdministratorsGroupMember: false,
  hasProtectedAttribute: false,
  isServiceAccount: false
}

/** Local-only fallback when trusted RG-37 protection data is unresolved. */
export const resolveLocalTestAccountProtection = (
  user: UserIdentity
): ResolvedUserProtection | null => {
  if (process.env.NODE_ENV !== 'development') return null

  const rawAccountIds = process.env.ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_UNPROTECTED_ACCOUNT_IDS
  const adminUrl = process.env.ICON_KEYCLOAK_ADMIN_URL

  if (!rawAccountIds || !adminUrl || process.env.ICON_KEYCLOAK_REALM !== 'I-Con') return null

  try {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(adminUrl).hostname)) return null
  } catch {
    return null
  }

  const accountIds = rawAccountIds.split(',').map(accountId => accountId.trim())

  if (
    accountIds.length === 0 ||
    accountIds.some(accountId => !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) ||
    !accountIds.includes(user.id)
  ) {
    return null
  }

  return { resolution: 'resolved', value: noProtection }
}

/** A development assertion is only a fallback; it can never replace a trusted Keycloak result. */
export const resolveAccountProtection = async (
  user: UserIdentity,
  resolveTrustedProtection: (user: UserIdentity) => Promise<ResolvedUserProtection | null>
): Promise<ResolvedUserProtection | null> => {
  let trustedProtection: ResolvedUserProtection | null

  try {
    trustedProtection = await resolveTrustedProtection(user)
  } catch {
    trustedProtection = null
  }

  return trustedProtection ?? resolveLocalTestAccountProtection(user)
}

export const createUserDetailGetHandler = (dependencies: UserDetailRouteDependencies) =>
  async (_request: Request, context: UserDetailRouteContext) => {
    let session: ServerSession | null

    try {
      session = await dependencies.getSession()
    } catch {
      return json({ error: 'AUTHENTICATION_UNAVAILABLE' }, 500)
    }

    if (!session) return json({ error: 'UNAUTHENTICATED' }, 401)

    const operator = toOperator(session)

    if (!operator) return json({ error: 'UNAUTHENTICATED' }, 401)

    let visibilityScope: ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null

    try {
      visibilityScope = await dependencies.resolveVisibilityScope(operator)
    } catch {
      return unresolvedScopeError()
    }

    if (!visibilityScope) return unresolvedScopeError()

    let accountId: unknown

    try {
      accountId = (await context.params).id
    } catch {
      return notFound()
    }

    try {
      const user = await dependencies.executeGetUserDetail(accountId, {
        operator,
        accountVisibilityScope: visibilityScope
      })

      return json(toIdentityDto(user), 200)
    } catch (error) {
      if (
        error instanceof GetUserDetailAuthorizationError ||
        error instanceof AccountVisibilityScopeUnavailableError
      ) {
        return json({ error: 'FORBIDDEN' }, 403)
      }

      if (error instanceof UserDetailNotFoundError) return notFound()

      if (error instanceof UserProtectionUnavailableError) {
        return json({ error: error.code }, 503)
      }

      if (error instanceof ProtectedAccountReadAuditUnavailableError) {
        return json({ error: error.code }, 503)
      }

      if (error instanceof KeycloakUserDirectoryError) {
        return json({ error: 'USER_DIRECTORY_UNAVAILABLE' }, error.code === 'CONFIGURATION_ERROR' ? 503 : 502)
      }

      return json({ error: 'INTERNAL_ERROR' }, 500)
    }
  }
