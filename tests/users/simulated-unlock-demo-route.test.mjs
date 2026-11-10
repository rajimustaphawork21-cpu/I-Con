import assert from 'node:assert/strict'
import test from 'node:test'

import detailRouteHandlerModule from '../../src/app/api/users/[id]/route-handler.ts'
import simulatedUnlockRouteModule from '../../src/app/api/users/[id]/unlock-demo/route-handler.ts'

const { isKeycloakAccountIdInScope } = detailRouteHandlerModule
const { createSimulatedUnlockGetHandler, readSimulatedUnlockDemoConfiguration } = simulatedUnlockRouteModule

const user = { id: 'user-1', username: 'alice', enabled: true }

const unprotected = {
  resolution: 'resolved',
  value: {
    hasRealmManagementRole: false,
    hasRealmAdministrationRole: false,
    isSsoAdministratorsGroupMember: false,
    hasProtectedAttribute: false,
    isServiceAccount: false
  }
}

const session = (roles = ['OPS-N1'], subject = 'operator-1') => ({
  user: { id: subject },
  clientRoles: roles
})

const approvedScope = accountIds => ({
  resolution: 'approved',
  value: { mode: 'account-ids', accountIds }
})

const enabledConfiguration = () => ({ enabled: true, accountId: 'user-1' })

const createTestRoute = ({
  currentSession = session(),
  scope = approvedScope(['user-1']),
  currentUser = user,
  protection = unprotected,
  readConfiguration = enabledConfiguration
} = {}) => {
  const directoryCalls = []
  const protectionCalls = []

  const handler = createSimulatedUnlockGetHandler({
    getSession: async () => currentSession,
    resolveVisibilityScope: async () => scope,
    isAccountIdInScope: isKeycloakAccountIdInScope,
    getUserById: async accountId => {
      directoryCalls.push(accountId)

      return currentUser?.id === accountId ? currentUser : null
    },
    resolveProtection: async candidate => {
      protectionCalls.push(candidate.id)

      return protection
    },
    readConfiguration
  })

  const get = (id = 'user-1') =>
    handler(new Request(`http://localhost/api/users/${id}/unlock-demo`), {
      params: Promise.resolve({ id })
    })

  return { directoryCalls, get, protectionCalls }
}

test('the demo is disabled by default and production ignores enabled flags', () => {
  assert.deepEqual(readSimulatedUnlockDemoConfiguration({ NODE_ENV: 'development' }), { enabled: false })
  assert.deepEqual(
    readSimulatedUnlockDemoConfiguration({
      NODE_ENV: 'production',
      ICON_SIMULATED_UNLOCK_DEMO_ENABLED: 'true',
      ICON_SIMULATED_UNLOCK_DEMO_ACCOUNT_ID: 'user-1'
    }),
    { enabled: false }
  )
  assert.deepEqual(
    readSimulatedUnlockDemoConfiguration({
      NODE_ENV: 'development',
      ICON_SIMULATED_UNLOCK_DEMO_ENABLED: 'true',
      ICON_SIMULATED_UNLOCK_DEMO_ACCOUNT_ID: 'user-1'
    }),
    { enabled: true, accountId: 'user-1' }
  )
})

test('an eligible operator and configured account receive deterministic simulated lock capability', async () => {
  const fixture = createTestRoute()
  const response = await fixture.get()

  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /^private, no-store/)
  assert.deepEqual(await response.json(), {
    simulation: 'local-only',
    enabled: true,
    eligible: true,
    simulatedLocked: true
  })
  assert.deepEqual(fixture.directoryCalls, ['user-1'])
  assert.deepEqual(fixture.protectionCalls, ['user-1'])
})

test('AUD, self, out-of-scope, protected, inherited-protected, and unresolved targets are never eligible', async () => {
  const scenarios = [
    { label: 'AUD', fixture: createTestRoute({ currentSession: session(['AUD']) }) },
    {
      label: 'self target',
      fixture: createTestRoute({ currentSession: session(['OPS-N1'], 'user-1') })
    },
    { label: 'out of scope', fixture: createTestRoute({ scope: approvedScope(['user-2']) }) },
    {
      label: 'protected attribute',
      fixture: createTestRoute({
        protection: { resolution: 'resolved', value: { ...unprotected.value, hasProtectedAttribute: true } }
      })
    },
    {
      label: 'inherited effective realm-management role',
      fixture: createTestRoute({
        protection: { resolution: 'resolved', value: { ...unprotected.value, hasRealmManagementRole: true } }
      })
    },
    { label: 'unresolved protection', fixture: createTestRoute({ protection: null }) }
  ]

  for (const scenario of scenarios) {
    const response = await scenario.fixture.get()

    assert.equal(response.status, 200, scenario.label)
    assert.deepEqual(
      await response.json(),
      {
        simulation: 'local-only',
        enabled: true,
        eligible: false,
        simulatedLocked: false
      },
      scenario.label
    )
  }

  assert.deepEqual(scenarios[0].fixture.directoryCalls, [], 'AUD must be denied before target reload')
  assert.deepEqual(scenarios[2].fixture.directoryCalls, [], 'out-of-scope ID must not reach Keycloak')
})

test(
  'the development read override cannot make unresolved protection eligible for the demo',
  { concurrency: false },
  async () => {
    const previousEnvironment = {
      NODE_ENV: process.env.NODE_ENV,
      ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_UNPROTECTED_ACCOUNT_IDS:
        process.env.ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_UNPROTECTED_ACCOUNT_IDS,
      ICON_KEYCLOAK_ADMIN_URL: process.env.ICON_KEYCLOAK_ADMIN_URL,
      ICON_KEYCLOAK_REALM: process.env.ICON_KEYCLOAK_REALM
    }

    try {
      process.env.NODE_ENV = 'development'
      process.env.ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_UNPROTECTED_ACCOUNT_IDS = 'user-1'
      process.env.ICON_KEYCLOAK_ADMIN_URL = 'http://127.0.0.1:8080'
      process.env.ICON_KEYCLOAK_REALM = 'I-Con'

      const fixture = createTestRoute({ protection: null })
      const response = await fixture.get()

      assert.equal(response.status, 200)
      assert.equal((await response.json()).eligible, false)
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  }
)

test('a disabled demo returns no capability without session or Keycloak access', async () => {
  const fixture = createTestRoute({ readConfiguration: () => ({ enabled: false }) })
  const response = await fixture.get()

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    simulation: 'local-only',
    enabled: false,
    eligible: false,
    simulatedLocked: false
  })
  assert.deepEqual(fixture.directoryCalls, [])
  assert.deepEqual(fixture.protectionCalls, [])
})
