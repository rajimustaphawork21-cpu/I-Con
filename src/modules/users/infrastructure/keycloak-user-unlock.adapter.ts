import 'server-only'

// Third-party Imports
import KcAdminClient, { NetworkError } from '@keycloak/keycloak-admin-client'

export type KeycloakUserUnlockConfiguration = {
  adminBaseUrl: string
  realm: string
  clientId: string
  clientSecret: string
}

export type KeycloakUserUnlockErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'SERVICE_ACCOUNT_AUTHENTICATION_FAILED'
  | 'UPSTREAM_REQUEST_FAILED'

export class KeycloakUserUnlockError extends Error {
  constructor(
    readonly code: KeycloakUserUnlockErrorCode,
    readonly status?: number
  ) {
    super('Keycloak user unlock request failed')
    this.name = 'KeycloakUserUnlockError'
  }
}

type KeycloakUserUnlockAdapterOptions = {
  configuration?: KeycloakUserUnlockConfiguration
  adminClientFactory?: () => KcAdminClient
}

const readConfiguration = (): KeycloakUserUnlockConfiguration => {
  const configuration = {
    adminBaseUrl: process.env.ICON_KEYCLOAK_ADMIN_URL,
    realm: process.env.ICON_KEYCLOAK_REALM,
    clientId: process.env.ICON_KEYCLOAK_USER_UNLOCK_CLIENT_ID,
    clientSecret: process.env.ICON_KEYCLOAK_USER_UNLOCK_CLIENT_SECRET
  }

  if (Object.values(configuration).some(value => !value)) {
    throw new KeycloakUserUnlockError('CONFIGURATION_ERROR')
  }

  return configuration as KeycloakUserUnlockConfiguration
}

const normalizeConfiguration = (configuration: KeycloakUserUnlockConfiguration): KeycloakUserUnlockConfiguration => {
  const normalized = {
    adminBaseUrl: configuration.adminBaseUrl.trim(),
    realm: configuration.realm.trim(),
    clientId: configuration.clientId.trim(),
    clientSecret: configuration.clientSecret
  }

  if (!normalized.adminBaseUrl || !normalized.realm || !normalized.clientId || !normalized.clientSecret) {
    throw new KeycloakUserUnlockError('CONFIGURATION_ERROR')
  }

  let adminUrl: URL

  try {
    adminUrl = new URL(normalized.adminBaseUrl)
  } catch {
    throw new KeycloakUserUnlockError('CONFIGURATION_ERROR')
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)

  if (
    adminUrl.username ||
    adminUrl.password ||
    adminUrl.search ||
    adminUrl.hash ||
    (adminUrl.protocol !== 'https:' && !(adminUrl.protocol === 'http:' && isLoopback))
  ) {
    throw new KeycloakUserUnlockError('CONFIGURATION_ERROR')
  }

  adminUrl.pathname = adminUrl.pathname.replace(/\/+$/, '')

  return { ...normalized, adminBaseUrl: adminUrl.toString().replace(/\/$/, '') }
}

const readSdkStatus = (error: unknown) => (error instanceof NetworkError ? error.response.status : undefined)

export class KeycloakUserUnlockAdapter {
  private readonly configuration: KeycloakUserUnlockConfiguration
  private readonly adminClientFactory: () => KcAdminClient

  constructor(options: KeycloakUserUnlockAdapterOptions = {}) {
    this.configuration = normalizeConfiguration(options.configuration ?? readConfiguration())
    this.adminClientFactory =
      options.adminClientFactory ??
      (() =>
        new KcAdminClient({
          baseUrl: this.configuration.adminBaseUrl,
          realmName: this.configuration.realm
        }))
  }

  async unlock(accountId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
      throw new KeycloakUserUnlockError('UPSTREAM_REQUEST_FAILED')
    }

    const adminClient = await this.getAuthenticatedAdminClient()

    try {
      await adminClient.attackDetection.del({
        realm: this.configuration.realm,
        id: accountId
      })
    } catch (error) {
      throw new KeycloakUserUnlockError('UPSTREAM_REQUEST_FAILED', readSdkStatus(error))
    }
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
      throw new KeycloakUserUnlockError('SERVICE_ACCOUNT_AUTHENTICATION_FAILED', readSdkStatus(error))
    }

    if (typeof accessToken !== 'string' || !accessToken) {
      throw new KeycloakUserUnlockError('SERVICE_ACCOUNT_AUTHENTICATION_FAILED')
    }

    return adminClient
  }
}
