import assert from 'node:assert/strict'
import test from 'node:test'

import unlockUseCaseModule from '../../src/modules/users/application/unlock-user.usecase.ts'
import detailRouteHandlerModule from '../../src/app/api/users/[id]/route-handler.ts'
import unlockRouteHandlerModule from '../../src/app/api/users/[id]/unlock/route-handler.ts'

const { UnlockUserUseCase } = unlockUseCaseModule
const { isKeycloakAccountIdInScope } = detailRouteHandlerModule
const { createUserUnlockPostHandler } = unlockRouteHandlerModule

const users = {
  'user-1': { id: 'user-1', username: 'alice', enabled: true },
  'user-2': { id: 'user-2', username: 'bob', enabled: true }
}

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

const protectedAccount = {
  resolution: 'resolved',
  value: { ...unprotected.value, hasProtectedAttribute: true }
}

const inheritedProtectedAccount = {
  resolution: 'resolved',
  value: { ...unprotected.value, hasRealmManagementRole: true }
}

const session = (roles = ['OPS-N1'], subject = 'operator-1') => ({
  user: { id: subject },
  clientRoles: roles
})

const approvedScope = accountIds => ({
  resolution: 'approved',
  value: { mode: 'account-ids', accountIds }
})

class TestAuditCoordinator {
  events = []

  constructor(mode = 'available') {
    this.mode = mode
  }

  async record(event) {
    this.events.push(event)
  }

  async execute(context, operation) {
    if (this.mode === 'unavailable') return { outcome: 'unavailable' }

    try {
      await operation()
      this.events.push({
        ...context,
        outcome: 'success',
        code: 'USER_UNLOCKED',
        severity: 'information'
      })

      return { outcome: 'success' }
    } catch {
      this.events.push({
        ...context,
        outcome: 'failure',
        code: 'USER_UNLOCK_FAILED',
        severity: 'information'
      })

      return { outcome: 'failure' }
    }
  }
}

const createTestRoute = ({
  currentSession = session(),
  scope = approvedScope(['user-1']),
  user = users['user-1'],
  protection = unprotected,
  isLocked = true,
  auditCoordinator = new TestAuditCoordinator(),
  writeFails = false
} = {}) => {
  const calls = []
  const directoryCalls = []
  const protectionCalls = []
  const lockCalls = []
  const writeCalls = []

  const useCase = new UnlockUserUseCase({
    userDirectory: {
      getById: async accountId => {
        calls.push('reload')
        directoryCalls.push(accountId)

        return user?.id === accountId ? user : null
      }
    },
    isAccountIdInScope: isKeycloakAccountIdInScope,
    protectionResolver: {
      resolve: async candidate => {
        calls.push('protection')
        protectionCalls.push(candidate.id)

        return protection
      }
    },
    lockReader: {
      isLocked: async accountId => {
        calls.push('lock')
        lockCalls.push(accountId)

        return isLocked
      }
    },
    unlocker: {
      unlock: async accountId => {
        calls.push('write')
        writeCalls.push(accountId)

        if (writeFails) throw new Error('sanitized upstream failure')
      }
    },
    ...(auditCoordinator ? { auditCoordinator } : {})
  })

  const handler = createUserUnlockPostHandler({
    getSession: async () => currentSession,
    resolveVisibilityScope: async () => scope,
    executeUnlock: (accountId, request, trusted) => useCase.execute(accountId, request, trusted),
    createCorrelationId: () => 'correlation-1'
  })

  const post = (id, body = { confirmed: true }) =>
    handler(
      new Request(`http://localhost/api/users/${id}/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id }) }
    )

  return {
    auditCoordinator,
    calls,
    directoryCalls,
    lockCalls,
    post,
    protectionCalls,
    writeCalls
  }
}

test('an eligible confirmed unlock reloads and rechecks the target before one audited write', async () => {
  const fixture = createTestRoute()
  const response = await fixture.post('user-1')

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'USER_UNLOCKED', id: 'user-1' })
  assert.equal(response.headers.get('x-correlation-id'), 'correlation-1')
  assert.match(response.headers.get('cache-control'), /^private, no-store/)
  assert.deepEqual(fixture.calls, ['reload', 'protection', 'lock', 'write'])
  assert.deepEqual(fixture.writeCalls, ['user-1'])
  assert.deepEqual(fixture.auditCoordinator.events, [
    {
      correlationId: 'correlation-1',
      operatorSubject: 'operator-1',
      targetUserId: 'user-1',
      action: 'user:unlock',
      outcome: 'success',
      code: 'USER_UNLOCKED',
      severity: 'information'
    }
  ])
})

test('AUD and DEC-AUTH-001 denials happen before target reads and never write', async () => {
  for (const roles of [['AUD'], ['OPS-N1', 'ADM-APP']]) {
    const fixture = createTestRoute({ currentSession: session(roles) })
    const response = await fixture.post('user-1')

    assert.equal(response.status, 403)
    assert.deepEqual(fixture.directoryCalls, [])
    assert.deepEqual(fixture.writeCalls, [])
    assert.equal(fixture.auditCoordinator.events[0].outcome, 'denied')
    assert.equal(
      fixture.auditCoordinator.events[0].code,
      roles[0] === 'AUD' && roles.length === 1 ? 'ACTION_NOT_ALLOWED' : 'SINGLE_PORTAL_ROLE_REQUIRED'
    )
  }
})

test('missing explicit confirmation is denied before any Keycloak target operation', async () => {
  const fixture = createTestRoute()
  const response = await fixture.post('user-1', {})

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'UNLOCK_CONFIRMATION_REQUIRED' })
  assert.deepEqual(fixture.directoryCalls, [])
  assert.deepEqual(fixture.writeCalls, [])
  assert.equal(fixture.auditCoordinator.events[0].code, 'UNLOCK_CONFIRMATION_REQUIRED')
})

test('out-of-scope, self, protected, inherited-protected, and unlocked targets never write', async () => {
  const scenarios = [
    {
      label: 'out of scope',
      fixture: createTestRoute({ scope: approvedScope(['user-2']) }),
      expectedStatus: 404,
      expectedCode: 'USER_NOT_FOUND'
    },
    {
      label: 'self target',
      fixture: createTestRoute({ currentSession: session(['OPS-N1'], 'user-1') }),
      expectedStatus: 403,
      expectedCode: 'SELF_CHANGE_FORBIDDEN'
    },
    {
      label: 'protected target',
      fixture: createTestRoute({ protection: protectedAccount }),
      expectedStatus: 403,
      expectedCode: 'PROTECTED_ACCOUNT'
    },
    {
      label: 'target protected by an inherited effective realm-management role',
      fixture: createTestRoute({ protection: inheritedProtectedAccount }),
      expectedStatus: 403,
      expectedCode: 'PROTECTED_ACCOUNT'
    },
    {
      label: 'not locked',
      fixture: createTestRoute({ isLocked: false }),
      expectedStatus: 409,
      expectedCode: 'ACCOUNT_NOT_LOCKED'
    }
  ]

  for (const scenario of scenarios) {
    const response = await scenario.fixture.post('user-1')

    assert.equal(response.status, scenario.expectedStatus, scenario.label)
    assert.deepEqual(scenario.fixture.writeCalls, [], scenario.label)
    assert.equal(scenario.fixture.auditCoordinator.events.at(-1).outcome, 'denied', scenario.label)
    assert.equal(scenario.fixture.auditCoordinator.events.at(-1).code, scenario.expectedCode, scenario.label)
  }
})

test(
  'unresolved trusted protection fails closed and ignores the development read override',
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
      const response = await fixture.post('user-1')

      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'ACCOUNT_PROTECTION_UNAVAILABLE' })
      assert.deepEqual(fixture.lockCalls, [])
      assert.deepEqual(fixture.writeCalls, [])
      assert.equal(fixture.auditCoordinator.events.at(-1).outcome, 'failure')
      assert.equal(fixture.auditCoordinator.events.at(-1).code, 'ACCOUNT_PROTECTION_UNAVAILABLE')
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  }
)

test('missing or unavailable durable audit never invokes the Keycloak write', async () => {
  const missingAudit = createTestRoute({ auditCoordinator: null })
  const missingAuditResponse = await missingAudit.post('user-1')

  assert.equal(missingAuditResponse.status, 503)
  assert.deepEqual(await missingAuditResponse.json(), { error: 'USER_UNLOCK_AUDIT_UNAVAILABLE' })
  assert.deepEqual(missingAudit.directoryCalls, [])
  assert.deepEqual(missingAudit.writeCalls, [])

  const unavailableAudit = createTestRoute({
    auditCoordinator: new TestAuditCoordinator('unavailable')
  })
  const unavailableAuditResponse = await unavailableAudit.post('user-1')

  assert.equal(unavailableAuditResponse.status, 503)
  assert.deepEqual(await unavailableAuditResponse.json(), { error: 'USER_UNLOCK_AUDIT_UNAVAILABLE' })
  assert.deepEqual(unavailableAudit.writeCalls, [])
})

test('a failed Keycloak write returns a sanitized error and records failure', async () => {
  const fixture = createTestRoute({ writeFails: true })
  const response = await fixture.post('user-1')

  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'USER_UNLOCK_FAILED' })
  assert.deepEqual(fixture.writeCalls, ['user-1'])
  assert.equal(fixture.auditCoordinator.events.at(-1).outcome, 'failure')
  assert.equal(fixture.auditCoordinator.events.at(-1).code, 'USER_UNLOCK_FAILED')
  assert.ok(!JSON.stringify(fixture.auditCoordinator.events).includes('sanitized upstream failure'))
})
