import assert from 'node:assert/strict'
import test from 'node:test'

import userDetailModule from '../../src/modules/users/presentation/user-detail.ts'

const {
  INITIAL_SIMULATED_UNLOCK_STATE,
  INITIAL_USER_UNLOCK_STATE,
  SIMULATED_UNLOCK_FEEDBACK,
  USER_UNLOCK_SUCCESS_FEEDBACK,
  buildSimulatedUnlockCapabilityRequestUrl,
  buildUserDetailRequestUrl,
  buildUserUnlockRequestUrl,
  executeUserUnlock,
  getUserDetailErrorKind,
  loadSimulatedUnlockCapability,
  loadUserUnlockStatus,
  parseSimulatedUnlockCapability,
  parseUserIdentity,
  parseUserUnlockStatus,
  reduceSimulatedUnlockUiState,
  reduceUserUnlockUiState
} = userDetailModule

test('user-detail requests encode the account ID in the BFF route', () => {
  assert.equal(buildUserDetailRequestUrl('user-1'), '/api/users/user-1')
  assert.equal(buildUserDetailRequestUrl('user/1'), '/api/users/user%2F1')
})

test('user-detail parsing keeps only the allowlisted identity DTO fields', () => {
  assert.deepEqual(
    parseUserIdentity({
      id: 'user-1',
      username: 'alice',
      firstName: 'Alice',
      lastName: 'Example',
      email: 'alice@example.test',
      enabled: false,
      protected: true,
      attributes: { internal: ['secret'] },
      credentials: ['must-not-be-kept']
    }),
    {
      id: 'user-1',
      username: 'alice',
      firstName: 'Alice',
      lastName: 'Example',
      email: 'alice@example.test',
      enabled: false
    }
  )
})

test('user-detail parsing accepts omitted optional identity fields and rejects malformed DTOs', () => {
  assert.deepEqual(parseUserIdentity({ id: 'user-1', username: 'alice', enabled: true }), {
    id: 'user-1',
    username: 'alice',
    enabled: true
  })
  assert.equal(parseUserIdentity({ id: 'user-1', username: 'alice' }), null)
  assert.equal(parseUserIdentity({ id: 'user-1', username: 'alice', enabled: true, email: 42 }), null)
})

test('user-detail HTTP errors map to the required presentation states', () => {
  assert.equal(getUserDetailErrorKind(401, { error: 'UNAUTHENTICATED' }), 'session-expired')
  assert.equal(getUserDetailErrorKind(403, { error: 'FORBIDDEN' }), 'forbidden')
  assert.equal(getUserDetailErrorKind(404, { error: 'USER_NOT_FOUND' }), 'not-found')
  assert.equal(getUserDetailErrorKind(503, { error: 'ACCOUNT_PROTECTION_UNAVAILABLE' }), 'protection-unavailable')
  assert.equal(
    getUserDetailErrorKind(503, { error: 'PROTECTED_ACCOUNT_READ_AUDIT_UNAVAILABLE' }),
    'protection-unavailable'
  )
  assert.equal(getUserDetailErrorKind(503, { error: 'USER_DIRECTORY_UNAVAILABLE' }), 'upstream')
  assert.equal(getUserDetailErrorKind(500, { error: 'INTERNAL_ERROR' }), 'unknown')
})

test('simulated unlock capability uses a read-only demo endpoint and a strict DTO', async () => {
  const calls = []

  const payload = {
    simulation: 'local-only',
    enabled: true,
    eligible: true,
    simulatedLocked: true
  }

  const fetchImplementation = async (input, init) => {
    calls.push({ input, init })

    return Response.json(payload)
  }

  assert.equal(buildSimulatedUnlockCapabilityRequestUrl('user/1'), '/api/users/user%2F1/unlock-demo')
  assert.deepEqual(await loadSimulatedUnlockCapability('user-1', fetchImplementation), payload)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, '/api/users/user-1/unlock-demo')
  assert.equal(calls[0].init.method, 'GET')
  assert.notEqual(calls[0].input, '/api/users/user-1/unlock')
  assert.equal(parseSimulatedUnlockCapability({ ...payload, simulatedLocked: 'true' }), null)
})

test('cancel preserves simulated lock state and confirmation changes only local demo state', () => {
  const opened = reduceSimulatedUnlockUiState(INITIAL_SIMULATED_UNLOCK_STATE, {
    type: 'open-confirmation'
  })

  const cancelled = reduceSimulatedUnlockUiState(opened, { type: 'cancel' })

  assert.deepEqual(cancelled, {
    confirmationOpen: false,
    locked: true,
    feedback: null
  })

  const reopened = reduceSimulatedUnlockUiState(cancelled, { type: 'open-confirmation' })
  const confirmed = reduceSimulatedUnlockUiState(reopened, { type: 'confirm' })

  assert.deepEqual(confirmed, {
    confirmationOpen: false,
    locked: false,
    feedback: SIMULATED_UNLOCK_FEEDBACK
  })
  assert.equal(SIMULATED_UNLOCK_FEEDBACK, 'Déblocage simulé. Le compte Keycloak reste inchangé.')
})

test('real unlock status and POST /api/users/{id}/unlock require confirmation and report success only after HTTP 200', async () => {
  const calls = []

  assert.equal(buildUserUnlockRequestUrl('user/1'), '/api/users/user%2F1/unlock')
  assert.deepEqual(parseUserUnlockStatus({ enabled: true, eligible: true, locked: true }), {
    enabled: true,
    eligible: true,
    locked: true
  })
  assert.equal(parseUserUnlockStatus({ enabled: true, eligible: true, locked: 'true' }), null)

  const status = await loadUserUnlockStatus('user-1', async (input, init) => {
    calls.push({ input, init })

    return Response.json({ enabled: true, eligible: true, locked: true })
  })

  assert.deepEqual(status, { enabled: true, eligible: true, locked: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, '/api/users/user-1/unlock')
  assert.equal(calls[0].init.method, 'GET')

  const loadedState = reduceUserUnlockUiState(INITIAL_USER_UNLOCK_STATE, { type: 'reset', status })
  const openedState = reduceUserUnlockUiState(loadedState, { type: 'open-confirmation' })
  const cancelledState = reduceUserUnlockUiState(openedState, { type: 'cancel' })

  assert.equal(cancelledState.confirmationOpen, false)
  assert.equal(cancelledState.locked, true)
  assert.equal(cancelledState.feedback, null)

  const reopenedState = reduceUserUnlockUiState(cancelledState, { type: 'open-confirmation' })
  const submittingState = reduceUserUnlockUiState(reopenedState, { type: 'submit-start' })

  assert.equal(submittingState.submitting, true)
  assert.equal(submittingState.locked, true)
  assert.equal(submittingState.feedback, null)

  const unlockResult = await executeUserUnlock('user-1', async (input, init) => {
    calls.push({ input, init })

    return Response.json(
      { status: 'USER_UNLOCKED', id: 'user-1' },
      { status: 200, headers: { 'x-correlation-id': 'corr-200' } }
    )
  })

  assert.deepEqual(unlockResult, {
    outcome: 'unlocked',
    id: 'user-1',
    correlationId: 'corr-200'
  })
  assert.equal(calls[1].input, '/api/users/user-1/unlock')
  assert.equal(calls[1].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].init.body), { confirmed: true })

  const succeededState = reduceUserUnlockUiState(submittingState, { type: 'submit-success' })

  assert.equal(succeededState.locked, false)
  assert.equal(succeededState.eligible, false)
  assert.equal(succeededState.confirmationOpen, false)
  assert.equal(succeededState.submitting, false)
  assert.equal(succeededState.feedback, USER_UNLOCK_SUCCESS_FEEDBACK)
})

test('UNKNOWN unlock outcome exposes the correlation ID and prevents retry', async () => {
  const unknownResult = await executeUserUnlock('user-1', async () =>
    Response.json(
      { error: 'USER_UNLOCK_OUTCOME_UNKNOWN', correlationId: 'corr-unknown-1' },
      { status: 503, headers: { 'x-correlation-id': 'corr-unknown-1' } }
    )
  )

  assert.deepEqual(unknownResult, {
    outcome: 'unknown',
    correlationId: 'corr-unknown-1'
  })

  const loadedState = reduceUserUnlockUiState(INITIAL_USER_UNLOCK_STATE, {
    type: 'reset',
    status: { enabled: true, eligible: true, locked: true }
  })

  const openedState = reduceUserUnlockUiState(loadedState, { type: 'open-confirmation' })
  const submittingState = reduceUserUnlockUiState(openedState, { type: 'submit-start' })

  const unknownState = reduceUserUnlockUiState(submittingState, {
    type: 'submit-unknown',
    correlationId: unknownResult.correlationId
  })

  assert.equal(unknownState.unknownCorrelationId, 'corr-unknown-1')
  assert.equal(unknownState.eligible, false)
  assert.equal(unknownState.confirmationOpen, false)
  assert.equal(unknownState.submitting, false)
  assert.equal(unknownState.feedback, null)

  const retryAttempt = reduceUserUnlockUiState(unknownState, { type: 'open-confirmation' })

  assert.deepEqual(retryAttempt, unknownState)
})
