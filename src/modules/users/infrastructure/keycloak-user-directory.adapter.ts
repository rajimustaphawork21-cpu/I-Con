import 'server-only'

// Third-party Imports
import KcAdminClient, { NetworkError } from '@keycloak/keycloak-admin-client'

// Auth Imports
import type { TrustedUserProtectionFacts } from '@/libs/auth/authorization-policy'

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
  realmManagementClientUuid?: string
  realmManagementClientUuidValidated?: boolean
  realmManagementRoleVisibilityValidated?: boolean
  realmAdministrationRoleNames?: readonly string[]
  realmAdministrationRoleVisibilityValidated?: boolean
  ssoAdministratorsGroupPath?: string
}

export type KeycloakResolvedUserProtection = {
  resolution: 'resolved'
  value: TrustedUserProtectionFacts
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
  adminClientFactory?: () => KcAdminClient
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const readRealmAdministrationRoleInventory = (value: string | undefined) => {
  if (value === undefined) return undefined
  if (value === '[]') return []

  return value.split(',').map(roleName => roleName.trim())
}

const readConfiguration = (): KeycloakDirectoryConfiguration => {
  const requiredConfiguration = {
    adminBaseUrl: process.env.ICON_KEYCLOAK_ADMIN_URL,
    realm: process.env.ICON_KEYCLOAK_REALM,
    clientId: process.env.ICON_KEYCLOAK_DIRECTORY_CLIENT_ID,
    clientSecret: process.env.ICON_KEYCLOAK_DIRECTORY_CLIENT_SECRET
  }

  if (Object.values(requiredConfiguration).some(value => !value)) {
    throw new KeycloakUserDirectoryError('CONFIGURATION_ERROR')
  }

  return {
    ...(requiredConfiguration as KeycloakDirectoryConfiguration),
    realmManagementClientUuid: process.env.ICON_KEYCLOAK_REALM_MANAGEMENT_CLIENT_UUID,
    realmManagementClientUuidValidated: process.env.ICON_KEYCLOAK_REALM_MANAGEMENT_CLIENT_UUID_VALIDATED === 'true',
    realmManagementRoleVisibilityValidated:
      process.env.ICON_KEYCLOAK_REALM_MANAGEMENT_ROLE_VISIBILITY_VALIDATED === 'true',
    realmAdministrationRoleNames: readRealmAdministrationRoleInventory(
      process.env.ICON_KEYCLOAK_REALM_ADMINISTRATION_ROLES
    ),
    realmAdministrationRoleVisibilityValidated:
      process.env.ICON_KEYCLOAK_REALM_ADMINISTRATION_ROLE_VISIBILITY_VALIDATED === 'true',
    ssoAdministratorsGroupPath: process.env.ICON_KEYCLOAK_SSO_ADMINISTRATORS_GROUP_PATH
  }
}

const normalizeConfiguration = (configuration: KeycloakDirectoryConfiguration): KeycloakDirectoryConfiguration => {
  const normalized = {
    adminBaseUrl: configuration.adminBaseUrl.trim(),
    realm: configuration.realm.trim(),
    clientId: configuration.clientId.trim(),
    clientSecret: configuration.clientSecret,
    realmManagementClientUuid: configuration.realmManagementClientUuid?.trim(),
    realmManagementClientUuidValidated: configuration.realmManagementClientUuidValidated,
    realmManagementRoleVisibilityValidated: configuration.realmManagementRoleVisibilityValidated,
    realmAdministrationRoleNames: configuration.realmAdministrationRoleNames?.map(roleName => roleName.trim()),
    realmAdministrationRoleVisibilityValidated: configuration.realmAdministrationRoleVisibilityValidated,
    ssoAdministratorsGroupPath: configuration.ssoAdministratorsGroupPath?.trim()
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

const readSdkStatus = (error: unknown) => (error instanceof NetworkError ? error.response.status : undefined)

const readOptionalString = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')

  return { [field]: value }
}

const invalidProtectionResponse = () => new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')

const readEffectiveRoleNames = (value: unknown) => {
  if (!Array.isArray(value)) throw invalidProtectionResponse()

  const names = value.map(role => (isRecord(role) ? role.name : null))

  if (!names.every((name): name is string => typeof name === 'string' && name.length > 0)) {
    throw invalidProtectionResponse()
  }

  return names
}

const readGroupCount = (value: unknown) => {
  if (!isRecord(value) || !Number.isSafeInteger(value.count) || (value.count as number) < 0) {
    throw invalidProtectionResponse()
  }

  return value.count as number
}

const readGroupPaths = (value: unknown) => {
  if (!Array.isArray(value)) throw invalidProtectionResponse()

  const paths = value.map(group => (isRecord(group) ? group.path : null))

  if (!paths.every((path): path is string => typeof path === 'string' && path.startsWith('/'))) {
    throw invalidProtectionResponse()
  }

  return paths
}

const readUserProtectionIdentity = (value: unknown, expectedUser: Pick<DirectoryUser, 'id' | 'username'>) => {
  if (
    !isRecord(value) ||
    value.id !== expectedUser.id ||
    value.username !== expectedUser.username ||
    (value.attributes !== undefined && value.attributes !== null && !isRecord(value.attributes)) ||
    (value.serviceAccountClientId !== undefined &&
      value.serviceAccountClientId !== null &&
      typeof value.serviceAccountClientId !== 'string')
  ) {
    throw invalidProtectionResponse()
  }

  const attributes = isRecord(value.attributes) ? value.attributes : {}
  const protectedValues = attributes.protected

  if (
    protectedValues !== undefined &&
    (!Array.isArray(protectedValues) || !protectedValues.every(item => typeof item === 'string'))
  ) {
    throw invalidProtectionResponse()
  }

  return {
    hasProtectedAttribute: Array.isArray(protectedValues) && protectedValues.includes('true'),
    isServiceAccount: typeof value.serviceAccountClientId === 'string' && value.serviceAccountClientId.length > 0
  }
}

const MAX_PROTECTION_GROUP_MEMBERSHIPS = 10_000
const PROTECTION_GROUP_PAGE_SIZE = 100
const PROTECTION_ROLE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

type ProtectionFactStates = {
  [Fact in keyof TrustedUserProtectionFacts]: boolean | null
}

const unresolvedProtectionFacts = (): ProtectionFactStates => ({
  hasRealmManagementRole: null,
  hasRealmAdministrationRole: null,
  isSsoAdministratorsGroupMember: null,
  hasProtectedAttribute: null,
  isServiceAccount: null
})

/**
 * A confirmed protected fact is sufficient for RG-37 even when another source is unavailable.
 * Unknown facts are normalized to false only after at least one true fact has made the aggregate
 * protected; an aggregate unprotected result requires every fact to be conclusively false.
 */
const finalizeProtection = (facts: ProtectionFactStates): KeycloakResolvedUserProtection | null => {
  const values = Object.values(facts)
  const hasConfirmedProtection = values.some(value => value === true)

  if (!hasConfirmedProtection && values.some(value => value === null)) return null

  return {
    resolution: 'resolved',
    value: {
      hasRealmManagementRole: facts.hasRealmManagementRole === true,
      hasRealmAdministrationRole: facts.hasRealmAdministrationRole === true,
      isSsoAdministratorsGroupMember: facts.isSsoAdministratorsGroupMember === true,
      hasProtectedAttribute: facts.hasProtectedAttribute === true,
      isServiceAccount: facts.isServiceAccount === true
    }
  }
}

const resolveFactSource = async <Value>(resolve: () => Promise<Value>): Promise<Value | null> => {
  try {
    return await resolve()
  } catch {
    return null
  }
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
  private readonly adminClientFactory: () => KcAdminClient

  constructor(options: KeycloakUserDirectoryAdapterOptions = {}) {
    this.configuration = normalizeConfiguration(options.configuration ?? readConfiguration())
    this.adminClientFactory =
      options.adminClientFactory ??
      (() =>
        new KcAdminClient({
          baseUrl: this.configuration.adminBaseUrl,
          realmName: this.configuration.realm
        }))
  }

  async list(
    query: ValidatedListUsersQuery,
    visibilityScope: KeycloakAccountVisibilityScope
  ): Promise<UserDirectoryPage<DirectoryUser>> {
    const scope = readVisibilityScope(visibilityScope)

    if (scope.mode === 'account-ids' && scope.accountIds.length === 0) return { users: [], total: 0 }

    const adminClient = await this.getAuthenticatedAdminClient()

    return scope.mode === 'realm-wide'
      ? this.listRealmUsers(query, adminClient)
      : this.listUsersById(query, scope.accountIds, adminClient)
  }

  async getById(accountId: string): Promise<DirectoryUser | null> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) return null

    const adminClient = await this.getAuthenticatedAdminClient()

    const payload = await this.executeAdminRequest(() =>
      adminClient.users.findOne({
        realm: this.configuration.realm,
        id: accountId
      })
    )

    if (payload === null || payload === undefined) return null

    return mapKeycloakUser(payload)
  }

  async isLocked(accountId: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
      throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')
    }

    const adminClient = await this.getAuthenticatedAdminClient()

    const payload = await this.executeAdminRequest(() =>
      adminClient.attackDetection.findOne({
        realm: this.configuration.realm,
        id: accountId
      })
    )

    if (!isRecord(payload) || typeof payload.disabled !== 'boolean') {
      throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')
    }

    return payload.disabled
  }

  /** Resolves every RG-37 fact from Keycloak Admin REST or returns unresolved. */
  async resolveProtection(
    user: Pick<DirectoryUser, 'id' | 'username'>
  ): Promise<KeycloakResolvedUserProtection | null> {
    const protectionConfiguration = this.readProtectionConfiguration()

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(user.id)) return null

    let adminClient: KcAdminClient

    try {
      adminClient = await this.getAuthenticatedAdminClient()
    } catch {
      return null
    }

    const facts = unresolvedProtectionFacts()

    // The username came from the preceding trusted Keycloak reload, so its service-account prefix
    // remains a positive signal even if the fuller identity request below becomes unavailable.
    if (user.username.startsWith('service-account-')) facts.isServiceAccount = true

    const identityPromise = resolveFactSource(async () =>
      readUserProtectionIdentity(
        await adminClient.users.findOne({ realm: this.configuration.realm, id: user.id }),
        user
      )
    )

    const realmManagementRolesPromise = protectionConfiguration.realmManagement
      ? resolveFactSource(async () => {
          const roleNames = readEffectiveRoleNames(
            await adminClient.users.listCompositeClientRoleMappings({
              realm: this.configuration.realm,
              id: user.id,
              clientUniqueId: protectionConfiguration.realmManagement!.clientUuid
            })
          )

          if (roleNames.length > 0) return true

          // Keycloak 26.8 can return a filtered 200 [] when the reader cannot view this client.
          return protectionConfiguration.realmManagement!.roleVisibilityValidated ? false : null
        })
      : Promise.resolve(null)

    // An approved empty inventory conclusively falsifies only this fact and requires no role lookup.
    const realmAdministrationRolesPromise = protectionConfiguration.realmAdministration
      ? protectionConfiguration.realmAdministration.roleNames.size === 0
        ? Promise.resolve(false)
        : resolveFactSource(async () => {
            const roleNames = readEffectiveRoleNames(
              await adminClient.users.listCompositeRealmRoleMappings({
                realm: this.configuration.realm,
                id: user.id
              })
            )

            const hasApprovedAdministrationRole = roleNames.some(roleName =>
              protectionConfiguration.realmAdministration!.roleNames.has(roleName)
            )

            if (hasApprovedAdministrationRole) return true

            // Absence is trustworthy only after provisioning established complete realm-role visibility.
            return protectionConfiguration.realmAdministration!.roleVisibilityValidated ? false : null
          })
      : Promise.resolve(null)

    const groupMembershipPromise = protectionConfiguration.ssoAdministratorsGroupPath
      ? resolveFactSource(async () => {
          const groupCount = readGroupCount(
            await adminClient.users.countGroups({ realm: this.configuration.realm, id: user.id })
          )

          if (groupCount > MAX_PROTECTION_GROUP_MEMBERSHIPS) throw invalidProtectionResponse()

          const groupPaths = await this.getAllUserGroupPaths(adminClient, user.id, groupCount)
          const administratorsPath = protectionConfiguration.ssoAdministratorsGroupPath!

          return groupPaths.some(path => path === administratorsPath || path.startsWith(`${administratorsPath}/`))
        })
      : Promise.resolve(null)

    const [identityFacts, hasRealmManagementRole, hasRealmAdministrationRole, isGroupMember] = await Promise.all([
      identityPromise,
      realmManagementRolesPromise,
      realmAdministrationRolesPromise,
      groupMembershipPromise
    ])

    if (identityFacts) {
      facts.hasProtectedAttribute = identityFacts.hasProtectedAttribute
      facts.isServiceAccount = identityFacts.isServiceAccount || facts.isServiceAccount === true
    }

    facts.hasRealmManagementRole = hasRealmManagementRole
    facts.hasRealmAdministrationRole = hasRealmAdministrationRole
    facts.isSsoAdministratorsGroupMember = isGroupMember

    return finalizeProtection(facts)
  }

  private readProtectionConfiguration() {
    const realmManagementClientUuid = this.configuration.realmManagementClientUuid
    const ssoAdministratorsGroupPath = this.configuration.ssoAdministratorsGroupPath
    const realmAdministrationRoleNames = this.configuration.realmAdministrationRoleNames

    const hasApprovedRealmAdministrationRoleInventory =
      Array.isArray(realmAdministrationRoleNames) &&
      realmAdministrationRoleNames.every(roleName => PROTECTION_ROLE_NAME_PATTERN.test(roleName))

    return {
      realmManagement:
        realmManagementClientUuid &&
        /^[A-Za-z0-9_-]{1,128}$/.test(realmManagementClientUuid) &&
        this.configuration.realmManagementClientUuidValidated === true
          ? {
              clientUuid: realmManagementClientUuid,
              roleVisibilityValidated: this.configuration.realmManagementRoleVisibilityValidated === true
            }
          : null,
      realmAdministration: hasApprovedRealmAdministrationRoleInventory
        ? {
            roleNames: new Set(realmAdministrationRoleNames),
            roleVisibilityValidated: this.configuration.realmAdministrationRoleVisibilityValidated === true
          }
        : null,
      ssoAdministratorsGroupPath:
        ssoAdministratorsGroupPath && /^\/[^/]+(?:\/[^/]+)*$/.test(ssoAdministratorsGroupPath)
          ? ssoAdministratorsGroupPath
          : null
    }
  }

  private async getAllUserGroupPaths(adminClient: KcAdminClient, userId: string, groupCount: number) {
    const paths: string[] = []

    while (paths.length < groupCount) {
      const page = readGroupPaths(
        await adminClient.users.listGroups({
          realm: this.configuration.realm,
          id: userId,
          briefRepresentation: true,
          first: paths.length,
          max: PROTECTION_GROUP_PAGE_SIZE
        })
      )

      if (page.length === 0 || paths.length + page.length > groupCount) throw invalidProtectionResponse()

      paths.push(...page)
    }

    return paths
  }

  private async getAuthenticatedAdminClient() {
    const adminClient = this.adminClientFactory()
    let accessToken: string | undefined

    try {
      await adminClient.auth({
        grantType: 'client_credentials',
        clientId: this.configuration.clientId,
        clientSecret: this.configuration.clientSecret
      })
      accessToken = await adminClient.getAccessToken()
    } catch (error) {
      throw new KeycloakUserDirectoryError('SERVICE_ACCOUNT_AUTHENTICATION_FAILED', readSdkStatus(error))
    }

    if (typeof accessToken !== 'string' || !accessToken) {
      throw new KeycloakUserDirectoryError('INVALID_UPSTREAM_RESPONSE')
    }

    return adminClient
  }

  private async executeAdminRequest<Value>(request: () => Promise<Value>) {
    try {
      return await request()
    } catch (error) {
      throw new KeycloakUserDirectoryError('UPSTREAM_REQUEST_FAILED', readSdkStatus(error))
    }
  }

  private async listRealmUsers(
    query: ValidatedListUsersQuery,
    adminClient: KcAdminClient
  ): Promise<UserDirectoryPage<DirectoryUser>> {
    const [usersPayload, totalPayload] = await this.executeAdminRequest(() =>
      Promise.all([
        adminClient.users.find({
          realm: this.configuration.realm,
          first: query.offset,
          max: query.pageSize,
          briefRepresentation: true,
          ...(query.search ? { search: query.search } : {})
        }),
        adminClient.users.count({
          realm: this.configuration.realm,
          ...(query.search ? { search: query.search } : {})
        })
      ])
    )

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
    adminClient: KcAdminClient
  ): Promise<UserDirectoryPage<DirectoryUser>> {
    const usersPayload = await this.executeAdminRequest(() =>
      Promise.all(
        accountIds.map(accountId =>
          adminClient.users.findOne({
            realm: this.configuration.realm,
            id: accountId
          })
        )
      )
    )

    const users = usersPayload.map(mapKeycloakUser)

    const search = query.search
    const matchingUsers = search ? users.filter(user => matchesSearch(user, search)) : users

    return {
      users: matchingUsers.slice(query.offset, query.offset + query.pageSize),
      total: matchingUsers.length
    }
  }
}
