import 'server-only'

// Type Imports
import type {
  UserDirectoryAdapter,
  UserDirectoryPage,
  ValidatedListUsersQuery
} from '@/modules/users/application/list-users.usecase'

export type DirectoryUser = {
  id: string
  username: string
  firstName?: string
  lastName?: string
  email?: string
  enabled: boolean
}

/** Realm-wide access must be an explicit decision made by a trusted scope resolver. */
export type KeycloakAccountVisibilityScope =
  | { mode: 'realm-wide' }
  | { mode: 'account-ids'; accountIds: readonly string[] }

export type KeycloakDirectoryConfiguration = {
  adminBaseUrl: string
  realm: string
  clientId: string
  clientSecret: string
}

export type KeycloakUserDirectoryErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'INVALID_VISIBILITY_SCOPE'
  | 'SERVICE_ACCOUNT_AUTHENTICATION_FAILED'
  | 'UPSTREAM_REQUEST_FAILED'
  | 'INVALID_UPSTREAM_RESPONSE'

export class KeycloakUserDirectoryError extends Error {
  constructor(
    readonly code: KeycloakUserDirectoryErrorCode,
    readonly status?: number
  ) {
    super('Keycloak user directory request failed')
    this.name = 'KeycloakUserDirectoryError'
  }
}

type KeycloakUserDirectoryAdapterOptions = {
  configuration?: KeycloakDirectoryConfiguration
  fetch?: typeof fetch
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const readConfiguration = (): KeycloakDirectoryConfiguration => {
  const configuration = {
    adminBaseUrl: process.env.ICON_KEYCLOAK_ADMIN_URL,
    realm: process.env.ICON_KEYCLOAK_REALM,
    clientId: process.env.ICON_KEYCLOAK_DIRECTORY_CLIENT_ID,
    clientSecret: process.env.ICON_KEYCLOAK_DIRECTORY_CLIENT_SECRET
  }

  if (Object.values(configuration).some(value => !value)) {
    throw new KeycloakUserDirectoryError('CONFIGURATION_ERROR')
  }

  return configuration as KeycloakDirectoryConfiguration
}

const normalizeConfiguration = (configuration: KeycloakDirectoryConfiguration): KeycloakDirectoryConfiguration => {
  const normalized = {
    adminBaseUrl: configuration.adminBaseUrl.trim(),
    realm: configuration.realm.trim(),
    clientId: configuration.clientId.trim(),
    clientSecret: configuration.clientSecret
  }

  if (!normalized.adminBaseUrl || !normalized.realm || !normalized.clientId || !normalized.clientSecret) {
    throw new KeycloakUserDirectoryError('CONFIGURATION_ERROR')
  }

  let adminUrl: URL

  try {
    adminUrl = new URL(normalized.adminBaseUrl)
  } catch {
    throw new KeycloakUserDirectoryError('CONFIGURATION_ERROR')
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)

  if (
    adminUrl.username ||
    adminUrl.password ||
    adminUrl.search ||
    adminUrl.hash ||
    (adminUrl.protocol !== 'https:' && !(adminUrl.protocol === 'http:' && isLoopback))
  ) {
    throw new KeycloakUserDirectoryError('CONFIGURATION_ERROR')
  }

  adminUrl.pathname = adminUrl.pathname.replace(/\/+$/, '')

  return { ...normalized, adminBaseUrl: adminUrl.toString().replace(/\/$/, '') }
}

const buildUrl = (configuration: KeycloakDirectoryConfiguration, path: string) => {
  const url = new URL(configuration.adminBaseUrl)
  const requested = new URL(path, 'http://keycloak.internal')

  url.pathname = `${url.pathname.replace(/\/$/, '')}${requested.pathname}`
  url.search = requested.search

  return url
}

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE', response.status)
  }
}

const readOptionalString = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')

  return { [field]: value }
}

export const mapKeycloakUser = (value: unknown): DirectoryUser => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) {
    throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')
  }

  if (typeof value.username !== 'string' || !value.username || typeof value.enabled !== 'boolean') {
    throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')
  }

  return {
    id: value.id,
    username: value.username,
    ...readOptionalString(value.firstName, 'firstName'),
    ...readOptionalString(value.lastName, 'lastName'),
    ...readOptionalString(value.email, 'email'),
    enabled: value.enabled
  }
}

const readVisibilityScope = (value: unknown): KeycloakAccountVisibilityScope => {
  if (!isRecord(value)) throw new KeycloakUserDirectoryError('INVALID_VISIBILITY_SCOPE')
  if (value.mode === 'realm-wide') return { mode: 'realm-wide' }

  if (
    value.mode !== 'account-ids' ||
    !Array.isArray(value.accountIds) ||
    !value.accountIds.every(accountId => typeof accountId === 'string' && accountId.length > 0)
  ) {
    throw new KeycloakUserDirectoryError('INVALID_VISIBILITY_SCOPE')
  }

  return { mode: 'account-ids', accountIds: [...new Set(value.accountIds)] }
}

const matchesSearch = (user: DirectoryUser, search: string) => {
  const normalizedSearch = search.toLocaleLowerCase()

  return [user.username, user.firstName, user.lastName, user.email]
    .filter((value): value is string => typeof value === 'string')
    .some(value => value.toLocaleLowerCase().includes(normalizedSearch))
}

export class KeycloakUserDirectoryAdapter
  implements UserDirectoryAdapter<DirectoryUser, KeycloakAccountVisibilityScope>
{
  private readonly configuration: KeycloakDirectoryConfiguration
  private readonly fetchImplementation: typeof fetch

  constructor(options: KeycloakUserDirectoryAdapterOptions = {}) {
    this.configuration = normalizeConfiguration(options.configuration ?? readConfiguration())
    this.fetchImplementation = options.fetch ?? fetch
  }

  async list(
    query: ValidatedListUsersQuery,
    visibilityScope: KeycloakAccountVisibilityScope
  ): Promise<UserDirectoryPage<DirectoryUser>> {
    const scope = readVisibilityScope(visibilityScope)

    if (scope.mode === 'account-ids' && scope.accountIds.length === 0) return { users: [], total: 0 }

    const accessToken = await this.getServiceAccountAccessToken()

    return scope.mode === 'realm-wide'
      ? this.listRealmUsers(query, accessToken)
      : this.listUsersById(query, scope.accountIds, accessToken)
  }

  private async getServiceAccountAccessToken() {
    const tokenUrl = buildUrl(
      this.configuration,
      `/realms/${encodeURIComponent(this.configuration.realm)}/protocol/openid-connect/token`
    )

    const response = await this.fetchImplementation(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.configuration.clientId,
        client_secret: this.configuration.clientSecret
      })
    })

    if (!response.ok) {
      throw new KeycloakUserDirectoryError('SERVICE_ACCOUNT_AUTHENTICATION_FAILED', response.status)
    }

    const payload = await parseJson(response)

    if (!isRecord(payload) || typeof payload.access_token !== 'string' || !payload.access_token) {
      throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE', response.status)
    }

    return payload.access_token
  }

  private async getAdminJson(path: string, accessToken: string): Promise<unknown> {
    const response = await this.fetchImplementation(buildUrl(this.configuration, path), {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) throw new KeycloakUserDirectoryError('UPSTREAM_REQUEST_FAILED', response.status)

    return parseJson(response)
  }

  private async listRealmUsers(
    query: ValidatedListUsersQuery,
    accessToken: string
  ): Promise<UserDirectoryPage<DirectoryUser>> {
    const usersUrl = `/admin/realms/${encodeURIComponent(this.configuration.realm)}/users`

    const listParameters = new URLSearchParams({
      first: String(query.offset),
      max: String(query.pageSize),
      briefRepresentation: 'true'
    })

    const countParameters = new URLSearchParams()

    if (query.search) {
      listParameters.set('search', query.search)
      countParameters.set('search', query.search)
    }

    const [usersPayload, totalPayload] = await Promise.all([
      this.getAdminJson(`${usersUrl}?${listParameters}`, accessToken),
      this.getAdminJson(`${usersUrl}/count${countParameters.size ? `?${countParameters}` : ''}`, accessToken)
    ])

    if (
      !Array.isArray(usersPayload) ||
      typeof totalPayload !== 'number' ||
      !Number.isSafeInteger(totalPayload) ||
      totalPayload < 0
    ) {
      throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')
    }

    return {
      users: usersPayload.map(mapKeycloakUser),
      total: totalPayload
    }
  }

  private async listUsersById(
    query: ValidatedListUsersQuery,
    accountIds: readonly string[],
    accessToken: string
  ): Promise<UserDirectoryPage<DirectoryUser>> {
    const usersPath = `/admin/realms/${encodeURIComponent(this.configuration.realm)}/users`

    const users = await Promise.all(
      accountIds.map(async accountId => {
        const payload = await this.getAdminJson(`${usersPath}/${encodeURIComponent(accountId)}`, accessToken)

        return mapKeycloakUser(payload)
      })
    )

    const search = query.search
    const matchingUsers = search ? users.filter(user => matchesSearch(user, search)) : users

    return {
      users: matchingUsers.slice(query.offset, query.offset + query.pageSize),
      total: matchingUsers.length
    }
  }
}
