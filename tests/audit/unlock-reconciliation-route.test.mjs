import assert from 'node:assert/strict'
import test from 'node:test'

import routeHandlerModule from '../../src/app/api/audit/unlock-reconciliations/[operationId]/route-handler.ts'

const { createUnlockAuditReconciliationPostHandler } = routeHandlerModule

const permission = 'audit:unlock:reconcile'

const authorizedSession = {
  user: { id: 'security-reviewer-1' },
  clientRoles: ['ADM-CONSOLE'],
  clientPermissions: [permission]
}

const pendingBody = {
  status: 'PENDING',
  evidenceKind: 'BACKEND_LOG',
  evidenceReference: 'backend-log:review-123',
  rationale: 'The available evidence does not establish a definitive outcome.'
}

const request = body =>
  new Request('http://localhost/api/audit/unlock-reconciliations/123', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

const createFixture = ({ session = authorizedSession, recordError } = {}) => {
  const appendRequests = []

  const handler = createUnlockAuditReconciliationPostHandler({
    getSession: async () => session,
    getGracePeriodMilliseconds: () => 15 * 60 * 1000,
    recordReconciliation: async input => {
      if (recordError) throw recordError

      appendRequests.push(input)

      return { reconciliationId: '456' }
    }
  })

  const post = body => handler(request(body), { params: Promise.resolve({ operationId: '123' }) })

  return { appendRequests, post }
}

test('requests without the Security reviewer permission cannot append reconciliation records', async () => {
  for (const session of [
    null,
    { ...authorizedSession, clientPermissions: [] },
    { ...authorizedSession, clientRoles: ['AUD', 'ADM-CONSOLE'] }
  ]) {
    const fixture = createFixture({ session })
    const response = await fixture.post({ ...pendingBody, clientPermissions: [permission] })

    assert.equal(response.status, session === null ? 401 : 403)
    assert.deepEqual(fixture.appendRequests, [])
  }
})

test('AUD with the explicit reconciliation permission receives 403 before append', async () => {
  const fixture = createFixture({
    session: { ...authorizedSession, clientRoles: ['AUD'] }
  })
  const response = await fixture.post(pendingBody)

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'FORBIDDEN' })
  assert.deepEqual(fixture.appendRequests, [])
})

test('a caller cannot supply or impersonate the reviewer identity', async () => {
  for (const identityField of ['reviewer', 'reviewerSubject', 'reviewer_subject']) {
    const fixture = createFixture()
    const response = await fixture.post({ ...pendingBody, [identityField]: 'another-reviewer' })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'INVALID_RECONCILIATION_REQUEST' })
    assert.deepEqual(fixture.appendRequests, [])
  }

  const fixture = createFixture()
  const response = await fixture.post(pendingBody)

  assert.equal(response.status, 201)
  assert.equal(fixture.appendRequests[0].reviewerSubject, authorizedSession.user.id)
})

test('an eligible non-AUD reviewer can append PENDING and definitive resolutions across I-Con', async () => {
  const fixture = createFixture()
  const pendingResponse = await fixture.post(pendingBody)

  const resolvedResponse = await fixture.post({
    status: 'RESOLVED',
    outcome: 'SUCCESS',
    evidenceConfirmed: true,
    evidenceKind: 'KEYCLOAK_ADMIN_EVENT',
    evidenceReference: 'keycloak-admin-event:event-123',
    rationale: 'The authoritative Keycloak event confirms that the unlock succeeded.'
  })

  assert.equal(pendingResponse.status, 201)
  assert.equal(resolvedResponse.status, 201)
  assert.deepEqual(
    fixture.appendRequests.map(input => ({
      operationId: input.operationId,
      reviewerSubject: input.reviewerSubject,
      resolvedOutcome: input.resolvedOutcome,
      evidenceIsDefinitive: input.evidenceIsDefinitive
    })),
    [
      {
        operationId: '123',
        reviewerSubject: 'security-reviewer-1',
        resolvedOutcome: null,
        evidenceIsDefinitive: false
      },
      {
        operationId: '123',
        reviewerSubject: 'security-reviewer-1',
        resolvedOutcome: 'SUCCESS',
        evidenceIsDefinitive: true
      }
    ]
  )
})

test('the API reports and does not mask the different-reviewer database gate', async () => {
  const fixture = createFixture({
    recordError: Object.assign(new Error('rejected'), {
      code: '42501',
      constraint: 'unlock_reconciliation_distinct_reviewer'
    })
  })

  const response = await fixture.post(pendingBody)

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'REVIEWER_MUST_DIFFER_FROM_UNLOCK_OPERATOR' })
  assert.deepEqual(fixture.appendRequests, [])
})
