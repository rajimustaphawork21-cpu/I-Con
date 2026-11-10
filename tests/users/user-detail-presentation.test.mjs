import assert from 'node:assert/strict'
import test from 'node:test'

import userDetailModule from '../../src/modules/users/presentation/user-detail.ts'

const {
  INITIAL_SIMULATED_UNLOCK_STATE,
  SIMULATED_UNLOCK_FEEDBACK,
  buildSimulatedUnlockCapabilityRequestUrl,
  buildUserDetailRequestUrl,
  getUserDetailErrorKind,
  loadSimulatedUnlockCapability,
  parseSimulatedUnlockCapability,
  parseUserIdentity,
  reduceSimulatedUnlockUiState
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
