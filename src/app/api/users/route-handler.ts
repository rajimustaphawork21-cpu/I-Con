import 'server-only'

// Auth Imports
import type { TrustedOperatorContext } from '@/libs/auth/authorization-policy'

// User Imports
import {
  AccountVisibilityScopeUnavailableError,
  ListUsersAuthorizationError,
  ListUsersValidationError
} from '@/modules/users/application/list-users.usecase'
import type {
  ListUsersRequest,
  ListUsersResult,
  ResolvedAccountVisibilityScope,
  TrustedListUsersContext
} from '@/modules/users/application/list-users.usecase'
import { KeycloakUserDirectoryError } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'
import type {
  DirectoryUser,
  KeycloakAccountVisibilityScope
} from '@/modules/users/infrastructure/keycloak-user-directory.adapter'

type ServerSession = {
  user?: { id?: string | null } | null
  clientRoles?: readonly string[] | null
}

type UsersRouteDependencies = {
  getSession: () => Promise<ServerSession | null>
  resolveVisibilityScope: (
    operator: TrustedOperatorContext
  ) =>
    | Promise<ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null>
    | ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope>
    | null
  executeListUsers: (
    request: ListUsersRequest,
    trusted: TrustedListUsersContext<KeycloakAccountVisibilityScope>
  ) => Promise<ListUsersResult<DirectoryUser>>
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

const readPageNumber = (parameters: URLSearchParams, name: 'page' | 'pageSize') => {
  const value = parameters.get(name)

  if (value === null) return undefined
  if (!/^\d+$/.test(value)) return Number.NaN

  return Number(value)
}

const readRequest = (request: Request): ListUsersRequest => {
  const parameters = new URL(request.url).searchParams
  const search = parameters.get('search')

  return {
    ...(search === null ? {} : { search }),
    page: readPageNumber(parameters, 'page'),
    pageSize: readPageNumber(parameters, 'pageSize')
  }
}

const toDirectoryDto = (user: DirectoryUser): DirectoryUser => ({
  id: user.id,
  username: user.username,
  ...(user.firstName === undefined ? {} : { firstName: user.firstName }),
  ...(user.lastName === undefined ? {} : { lastName: user.lastName }),
  ...(user.email === undefined ? {} : { email: user.email }),
  enabled: user.enabled
})

export const resolveLocalTestAccountVisibility = (): ResolvedAccountVisibilityScope<KeycloakAccountVisibilityScope> | null => {
  const rawAccountIds = process.env.ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_ACCOUNT_IDS
  const adminUrl = process.env.ICON_KEYCLOAK_ADMIN_URL

  if (!rawAccountIds || !adminUrl || process.env.ICON_KEYCLOAK_REALM !== 'I-Con') return null

  let isLoopback = false

  try {
    isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(adminUrl).hostname)
  } catch {
    return null
  }

  if (!isLoopback) return null

  const accountIds = rawAccountIds.split(',').map(accountId => accountId.trim())

  if (
    accountIds.length === 0 ||
    accountIds.some(accountId => !/^[A-Za-z0-9_-]{1,128}$/.test(accountId))
  ) {
    return null
  }

  return {
    resolution: 'approved',
    value: { mode: 'account-ids', accountIds: [...new Set(accountIds)] }
  }
}

export const createUsersGetHandler = (dependencies: UsersRouteDependencies) => async (request: Request) => {
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
    visibilityScope = null
  }

  try {
    const result = await dependencies.executeListUsers(readRequest(request), {
      operator,
      accountVisibilityScope: visibilityScope
    })

    return json(
      {
        users: result.users.map(toDirectoryDto),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize
      },
      200
    )
  } catch (error) {
    if (error instanceof ListUsersAuthorizationError || error instanceof AccountVisibilityScopeUnavailableError) {
      return json({ error: 'FORBIDDEN' }, 403)
    }

    if (error instanceof ListUsersValidationError) return json({ error: error.code }, 400)

    if (error instanceof KeycloakUserDirectoryError) {
      return json({ error: 'USER_DIRECTORY_UNAVAILABLE' }, error.code === 'CONFIGURATION_ERROR' ? 503 : 502)
    }

    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
}
