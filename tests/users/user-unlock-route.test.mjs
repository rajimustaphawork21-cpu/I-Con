import assert from 'node:assert/strict'
import test from 'node:test'

import unlockUseCaseModule from '../../src/modules/users/application/unlock-user.usecase.ts'
import detailRouteHandlerModule from '../../src/app/api/users/[id]/route-handler.ts'
import unlockRouteHandlerModule from '../../src/app/api/users/[id]/unlock/route-handler.ts'

const { UnlockUserUseCase, UserUnlockDispatchOutcomeUnknownError } = unlockUseCaseModule
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
  appendRequests = []

  constructor(mode = 'available') {
    this.mode = mode
  }

  async record(event) {
    this.appendRequests.push(event)
    this.events.push(event)
  }

  async execute(context, operation) {
    const attempt = {
      ...context,
      outcome: 'attempt',
      code: 'USER_UNLOCK_ATTEMPT',
      severity: 'information'
    }

    this.appendRequests.push(attempt)

    if (this.mode === 'attempt-unavailable') {
      return { outcome: 'unavailable', reason: 'ATTEMPT_NOT_CONFIRMED' }
    }

    this.events.push(attempt)

    try {
      await operation()

      const success = {
        ...context,
        outcome: 'success',
        code: 'USER_UNLOCKED',
        severity: 'information'
      }

      this.appendRequests.push(success)

      if (this.mode === 'terminal-ack-lost') {
        return { outcome: 'unknown', reason: 'TERMINAL_AUDIT_NOT_CONFIRMED' }
      }

      this.events.push(success)

      return { outcome: 'success' }
    } catch (error) {
      if (error instanceof UserUnlockDispatchOutcomeUnknownError) {
        const unknown = {
          ...context,
          outcome: 'unknown',
          code: 'USER_UNLOCK_OUTCOME_UNKNOWN',
          severity: 'alert'
        }

        this.appendRequests.push(unknown)
        this.events.push(unknown)

        return { outcome: 'unknown', reason: 'KEYCLOAK_OUTCOME_AMBIGUOUS' }
      }

      const failure = {
        ...context,
        outcome: 'failure',
        code: 'USER_UNLOCK_FAILED',
        severity: 'information'
      }

      this.appendRequests.push(failure)
      this.events.push(failure)

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
  writeOutcome = 'success'
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

        if (writeOutcome === 'unknown') throw new UserUnlockDispatchOutcomeUnknownError()
        if (writeOutcome === 'failure') throw new Error('sanitized upstream failure')
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
      outcome: 'attempt',
      code: 'USER_UNLOCK_ATTEMPT',
      severity: 'information'
    },
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

test('missing audit refuses the operation before target reads or a Keycloak write', async () => {
  const missingAudit = createTestRoute({ auditCoordinator: null })
  const missingAuditResponse = await missingAudit.post('user-1')

  assert.equal(missingAuditResponse.status, 503)
  assert.deepEqual(await missingAuditResponse.json(), { error: 'USER_UNLOCK_AUDIT_UNAVAILABLE' })
  assert.deepEqual(missingAudit.directoryCalls, [])
  assert.deepEqual(missingAudit.writeCalls, [])
})

test('an unconfirmed ATTEMPT returns audit unavailable and never dispatches the Keycloak write', async () => {
  const auditCoordinator = new TestAuditCoordinator('attempt-unavailable')
  const fixture = createTestRoute({ auditCoordinator })
  const response = await fixture.post('user-1')

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'USER_UNLOCK_AUDIT_UNAVAILABLE' })
  assert.deepEqual(fixture.writeCalls, [])
  assert.deepEqual(auditCoordinator.events, [])
  assert.deepEqual(
    auditCoordinator.appendRequests.map(event => event.outcome),
    ['attempt']
  )
})

test('an ambiguous post-dispatch Keycloak outcome returns UNKNOWN and requests an UNKNOWN audit event', async () => {
  const fixture = createTestRoute({ writeOutcome: 'unknown' })
  const response = await fixture.post('user-1')

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: 'USER_UNLOCK_OUTCOME_UNKNOWN',
    correlationId: 'correlation-1'
  })
  assert.equal(response.headers.get('x-correlation-id'), 'correlation-1')
  assert.deepEqual(fixture.writeCalls, ['user-1'])
  assert.deepEqual(
    fixture.auditCoordinator.events.map(event => event.outcome),
    ['attempt', 'unknown']
  )
  assert.equal(fixture.auditCoordinator.events.at(-1).code, 'USER_UNLOCK_OUTCOME_UNKNOWN')
  assert.equal(fixture.auditCoordinator.events.at(-1).correlationId, 'correlation-1')
})

test('a lost terminal-success acknowledgement returns UNKNOWN without appending a competing terminal event', async () => {
  const auditCoordinator = new TestAuditCoordinator('terminal-ack-lost')
  const fixture = createTestRoute({ auditCoordinator })
  const response = await fixture.post('user-1')

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: 'USER_UNLOCK_OUTCOME_UNKNOWN',
    correlationId: 'correlation-1'
  })
  assert.equal(response.headers.get('x-correlation-id'), 'correlation-1')
  assert.deepEqual(fixture.writeCalls, ['user-1'])
  assert.deepEqual(
    auditCoordinator.events.map(event => event.outcome),
    ['attempt']
  )
  assert.deepEqual(
    auditCoordinator.appendRequests.map(event => event.outcome),
    ['attempt', 'success']
  )
  assert.equal(
    auditCoordinator.appendRequests.some(event => event.outcome === 'unknown'),
    false
  )
})

test('a failed Keycloak write returns a sanitized error and records failure', async () => {
  const fixture = createTestRoute({ writeOutcome: 'failure' })
  const response = await fixture.post('user-1')

  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'USER_UNLOCK_FAILED' })
  assert.deepEqual(fixture.writeCalls, ['user-1'])
  assert.deepEqual(
    fixture.auditCoordinator.events.map(event => event.outcome),
    ['attempt', 'failure']
  )
  assert.equal(fixture.auditCoordinator.events.at(-1).outcome, 'failure')
  assert.equal(fixture.auditCoordinator.events.at(-1).code, 'USER_UNLOCK_FAILED')
  assert.ok(!JSON.stringify(fixture.auditCoordinator.events).includes('sanitized upstream failure'))
})
