import assert from 'node:assert/strict'
import test from 'node:test'

import { NetworkError } from '@keycloak/keycloak-admin-client'

import unlockUseCaseModule from '../../src/modules/users/application/unlock-user.usecase.ts'
import directoryAdapterModule from '../../src/modules/users/infrastructure/keycloak-user-directory.adapter.ts'
import unlockAdapterModule from '../../src/modules/users/infrastructure/keycloak-user-unlock.adapter.ts'

const { UserUnlockDispatchOutcomeUnknownError } = unlockUseCaseModule
const { KeycloakUserDirectoryAdapter } = directoryAdapterModule
const { KeycloakUserUnlockAdapter, KeycloakUserUnlockError } = unlockAdapterModule

test('the read-only directory credential resolves current per-user brute-force lock status', async () => {
  const calls = []
  const adminClient = {
    auth: async credentials => calls.push({ operation: 'auth', credentials }),
    getAccessToken: async () => 'directory-reader-token',
    attackDetection: {
      findOne: async payload => {
        calls.push({ operation: 'findOne', payload })

        return { disabled: true, numFailures: 5 }
      }
    }
  }
  const adapter = new KeycloakUserDirectoryAdapter({
    configuration: {
      adminBaseUrl: 'https://keycloak.example.test',
      realm: 'I-Con',
      clientId: 'icon-directory-reader',
      clientSecret: 'test-read-secret'
    },
    adminClientFactory: () => adminClient
  })

  assert.equal(await adapter.isLocked('user-1'), true)
  assert.deepEqual(calls.at(-1), {
    operation: 'findOne',
    payload: { realm: 'I-Con', id: 'user-1' }
  })
})

test('the write adapter uses the SDK per-user brute-force delete with separate credentials', async () => {
  const calls = []
  const adminClient = {
    auth: async credentials => calls.push({ operation: 'auth', credentials }),
    getAccessToken: async () => 'write-service-account-token',
    attackDetection: {
      del: async payload => calls.push({ operation: 'del', payload }),
      delAll: async () => {
        throw new Error('bulk brute-force reset must never be used')
      }
    }
  }
  const adapter = new KeycloakUserUnlockAdapter({
    configuration: {
      adminBaseUrl: 'https://keycloak.example.test',
      realm: 'I-Con',
      clientId: 'icon-user-unlocker',
      clientSecret: 'test-write-secret'
    },
    adminClientFactory: () => adminClient
  })

  await adapter.unlock('user-1')

  assert.deepEqual(calls, [
    {
      operation: 'auth',
      credentials: {
        grantType: 'client_credentials',
        clientId: 'icon-user-unlocker',
        clientSecret: 'test-write-secret'
      }
    },
    { operation: 'del', payload: { realm: 'I-Con', id: 'user-1' } }
  ])
})

test('an invalid account ID is rejected before authentication or mutation', async () => {
  let adminClientCreated = false
  const adapter = new KeycloakUserUnlockAdapter({
    configuration: {
      adminBaseUrl: 'https://keycloak.example.test',
      realm: 'I-Con',
      clientId: 'icon-user-unlocker',
      clientSecret: 'test-write-secret'
    },
    adminClientFactory: () => {
      adminClientCreated = true

      return {}
    }
  })

  await assert.rejects(
    adapter.unlock('../all-users'),
    error => error instanceof KeycloakUserUnlockError && error.code === 'UPSTREAM_REQUEST_FAILED'
  )
  assert.equal(adminClientCreated, false)
})

test('network drops and 5xx errors after brute-force delete dispatch report an unknown outcome', async () => {
  for (const failure of [
    new Error('socket hang up'),
    new NetworkError('bad gateway', {
      response: new Response(null, { status: 502 }),
      responseData: null
    })
  ]) {
    const adapter = new KeycloakUserUnlockAdapter({
      configuration: {
        adminBaseUrl: 'https://keycloak.example.test',
        realm: 'I-Con',
        clientId: 'icon-user-unlocker',
        clientSecret: 'test-write-secret'
      },
      adminClientFactory: () => ({
        auth: async () => {},
        getAccessToken: async () => 'write-service-account-token',
        attackDetection: {
          del: async () => {
            throw failure
          }
        }
      })
    })

    await assert.rejects(
      adapter.unlock('user-1'),
      error => error instanceof UserUnlockDispatchOutcomeUnknownError
    )
  }
})

test('4xx token and unlock errors report sanitized failing stage and HTTP status', async () => {
  const tokenRejectedAdapter = new KeycloakUserUnlockAdapter({
    configuration: {
      adminBaseUrl: 'https://keycloak.example.test',
      realm: 'I-Con',
      clientId: 'icon-user-unlocker',
      clientSecret: 'test-write-secret'
    },
    adminClientFactory: () => ({
      auth: async () => {
        throw new NetworkError('unauthorized', {
          response: new Response(null, { status: 401 }),
          responseData: { error: 'unauthorized_client' }
        })
      },
      getAccessToken: async () => 'unused'
    })
  })

  await assert.rejects(
    tokenRejectedAdapter.unlock('user-1'),
    error =>
      error instanceof KeycloakUserUnlockError &&
      error.code === 'SERVICE_ACCOUNT_AUTHENTICATION_FAILED' &&
      error.stage === 'service_account_token' &&
      error.status === 401
  )

  const forbiddenUnlockAdapter = new KeycloakUserUnlockAdapter({
    configuration: {
      adminBaseUrl: 'https://keycloak.example.test',
      realm: 'I-Con',
      clientId: 'icon-user-unlocker',
      clientSecret: 'test-write-secret'
    },
    adminClientFactory: () => ({
      auth: async () => {},
      getAccessToken: async () => 'write-service-account-token',
      attackDetection: {
        del: async () => {
          throw new NetworkError('forbidden', {
            response: new Response(null, { status: 403 }),
            responseData: { error: 'HTTP 403 Forbidden' }
          })
        }
      }
    })
  })

  await assert.rejects(
    forbiddenUnlockAdapter.unlock('user-1'),
    error =>
      error instanceof KeycloakUserUnlockError &&
      error.code === 'UPSTREAM_REQUEST_FAILED' &&
      error.stage === 'attack_detection_delete' &&
      error.status === 403
  )
})
