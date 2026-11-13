import assert from 'node:assert/strict'
import test from 'node:test'

import detailUseCaseModule from '../../src/modules/users/application/get-user-detail.usecase.ts'
import routeHandlerModule from '../../src/app/api/users/[id]/route-handler.ts'

const { GetUserDetailUseCase } = detailUseCaseModule

const {
  createUserDetailGetHandler,
  isKeycloakAccountIdInScope,
  resolveAccountProtection,
  resolveLocalTestAccountProtection
} = routeHandlerModule

const users = {
  'user-1': {
    id: 'user-1',
    username: 'alice',
    firstName: 'Alice',
    lastName: 'Example',
    email: 'alice@example.test',
    enabled: false,
    internalOnly: 'must-not-leave-the-route'
  },
  'user-2': { id: 'user-2', username: 'bob', enabled: false }
}

const session = roles => ({ user: { id: 'operator-1' }, clientRoles: roles })

const approvedScope = accountIds => ({
  resolution: 'approved',
  value: { mode: 'account-ids', accountIds }
})

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

const withLocalProtectionEnvironment = async (nodeEnvironment, run) => {
  const values = {
    NODE_ENV: process.env.NODE_ENV,
    ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_UNPROTECTED_ACCOUNT_IDS:
      process.env.ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_UNPROTECTED_ACCOUNT_IDS,
    ICON_KEYCLOAK_ADMIN_URL: process.env.ICON_KEYCLOAK_ADMIN_URL,
    ICON_KEYCLOAK_REALM: process.env.ICON_KEYCLOAK_REALM
  }

  try {
    process.env.NODE_ENV = nodeEnvironment
    process.env.ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_UNPROTECTED_ACCOUNT_IDS = 'user-1'
    process.env.ICON_KEYCLOAK_ADMIN_URL = 'http://127.0.0.1:8080'
    process.env.ICON_KEYCLOAK_REALM = 'I-Con'

    await run()
  } finally {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

class TestDirectoryAdapter {
  calls = []

  async getById(accountId) {
    this.calls.push(accountId)

    return users[accountId] ?? null
  }
}

const createTestRoute = ({
  currentSession = session(['OPS-N1']),
  scope = approvedScope(['user-1']),
  resolveProtection = async () => unprotected,
  auditor
} = {}) => {
  const directory = new TestDirectoryAdapter()
  const protectionCalls = []

  const useCase = new GetUserDetailUseCase({
    userDirectory: directory,
    isAccountIdInScope: isKeycloakAccountIdInScope,
    protectionResolver: {
      resolve: async user => {
        protectionCalls.push(user.id)

        return resolveProtection(user)
      }
    },
    ...(auditor ? { protectedAccountReadAuditor: auditor } : {})
  })

  let scopeCalls = 0

  const handler = createUserDetailGetHandler({
    getSession: async () => currentSession,
    resolveVisibilityScope: async () => {
      scopeCalls += 1

      return scope
    },
    executeGetUserDetail: (accountId, trusted) => useCase.execute(accountId, trusted)
  })

  const get = id => handler(new Request(`http://localhost/api/users/${id}`), { params: Promise.resolve({ id }) })

  return { directory, get, getProtectionCalls: () => protectionCalls, getScopeCalls: () => scopeCalls }
}

test('GET /api/users/[id] returns an allowlisted identity DTO for an authorized in-scope read', async () => {
  const { directory, get, getProtectionCalls } = createTestRoute()
  const response = await get('user-1')
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /^private, no-store/)
  assert.equal(response.headers.get('pragma'), 'no-cache')
  assert.deepEqual(body, {
    id: 'user-1',
    username: 'alice',
    firstName: 'Alice',
    lastName: 'Example',
    email: 'alice@example.test',
    enabled: false
  })
  assert.deepEqual(directory.calls, ['user-1'])
  assert.deepEqual(getProtectionCalls(), ['user-1'])
})

test('AUD can still read user details inside its authorized scope', async () => {
  const { directory, get } = createTestRoute({ currentSession: session(['AUD']) })
  const response = await get('user-1')

  assert.equal(response.status, 200)
  assert.equal((await response.json()).id, 'user-1')
  assert.deepEqual(directory.calls, ['user-1'])
})

test('a changed ID outside the trusted scope returns the same 404 without reaching Keycloak', async () => {
  const { directory, get, getProtectionCalls } = createTestRoute()
  const response = await get('user-2')
  const body = await response.json()

  assert.equal(response.status, 404)
  assert.deepEqual(body, { error: 'USER_NOT_FOUND' })
  assert.equal(directory.calls.length, 0)
  assert.equal(getProtectionCalls().length, 0)
})

test('a missing in-scope Keycloak user returns the same 404 response', async () => {
  const { directory, get, getProtectionCalls } = createTestRoute({
    scope: approvedScope(['missing-user'])
  })

  const response = await get('missing-user')
  const body = await response.json()

  assert.equal(response.status, 404)
  assert.deepEqual(body, { error: 'USER_NOT_FOUND' })
  assert.deepEqual(directory.calls, ['missing-user'])
  assert.equal(getProtectionCalls().length, 0)
})

test('unresolved account protection fails closed after the trusted Keycloak reload', async () => {
  const { directory, get } = createTestRoute({ resolveProtection: async () => null })
  const response = await get('user-1')

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'ACCOUNT_PROTECTION_UNAVAILABLE' })
  assert.deepEqual(directory.calls, ['user-1'])
})

test('production mode ignores the matching local unprotected-account override', { concurrency: false }, async () => {
  await withLocalProtectionEnvironment('production', async () => {
    const { directory, get } = createTestRoute({
      currentSession: session(['OPS-N1']),
      scope: approvedScope(['user-1']),
      resolveProtection: async user => resolveLocalTestAccountProtection(user)
    })

    const response = await get('user-1')

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'ACCOUNT_PROTECTION_UNAVAILABLE' })
    assert.deepEqual(directory.calls, ['user-1'])
  })
})

test('development mode accepts the matching local override with the I-Con realm and loopback Keycloak URL', { concurrency: false }, async () => {
  await withLocalProtectionEnvironment('development', async () => {
    const { directory, get } = createTestRoute({
      currentSession: session(['OPS-N1']),
      scope: approvedScope(['user-1']),
      resolveProtection: async user => resolveLocalTestAccountProtection(user)
    })

    const response = await get('user-1')

    assert.equal(response.status, 200)
    assert.equal((await response.json()).id, 'user-1')
    assert.deepEqual(directory.calls, ['user-1'])
  })
})

test('a protected-account read is blocked while the RG-45 auditor is unavailable', async () => {
  const protectedResolution = {
    resolution: 'resolved',
    value: { ...unprotected.value, hasRealmManagementRole: true }
  }

  const { get } = createTestRoute({ resolveProtection: async () => protectedResolution })
  const response = await get('user-1')

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'PROTECTED_ACCOUNT_READ_AUDIT_UNAVAILABLE' })
})

test('the development override cannot replace a trusted protected result', { concurrency: false }, async () => {
  await withLocalProtectionEnvironment('development', async () => {
    const protectedResolution = {
      resolution: 'resolved',
      value: { ...unprotected.value, isSsoAdministratorsGroupMember: true }
    }

    const { get } = createTestRoute({
      resolveProtection: user => resolveAccountProtection(user, async () => protectedResolution)
    })

    const response = await get('user-1')

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'PROTECTED_ACCOUNT_READ_AUDIT_UNAVAILABLE' })
  })
})

test('missing session, denied operator, and unresolved scope fail before the directory adapter', async () => {
  for (const scenario of [
    { currentSession: null, expectedStatus: 401 },
    { currentSession: session(['AUD', 'ADM-APP']), expectedStatus: 403 },
    { scope: null, expectedStatus: 403 }
  ]) {
    const { directory, get, getScopeCalls } = createTestRoute(scenario)
    const response = await get('user-1')

    assert.equal(response.status, scenario.expectedStatus)
    assert.equal(directory.calls.length, 0)
    if (scenario.currentSession === null) assert.equal(getScopeCalls(), 0)
  }
})
