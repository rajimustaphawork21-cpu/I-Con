import assert from 'node:assert/strict'
import test from 'node:test'

import claims from '../../src/libs/auth/claims.ts'

const {
  PORTAL_CLIENT_ROLES,
  getPortalClientRoles,
  getProfileLabel,
  hasAnyClientRole,
  hasPortalAccess,
  readClientRoles
} = claims

const clientId = 'icon-bff'

test('reads exact icon-bff Client Roles and removes duplicates', () => {
  assert.deepEqual(
    readClientRoles(
      {
        resource_access: {
          [clientId]: { roles: ['OPS-N1', 'AUD', 'OPS-N1'] }
        }
      },
      clientId
    ),
    ['OPS-N1', 'AUD']
  )
})

test('ignores Realm Roles and roles from other Clients', () => {
  const claims = {
    realm_access: { roles: [...PORTAL_CLIENT_ROLES] },
    resource_access: {
      another_client: { roles: [...PORTAL_CLIENT_ROLES] }
    }
  }

  assert.equal(readClientRoles(claims, clientId), null)
  assert.equal(hasPortalAccess(readClientRoles(claims, clientId)), false)
})

test('missing and malformed Client Role claims fail closed', () => {
  assert.equal(readClientRoles(undefined, clientId), null)
  assert.equal(readClientRoles({}, clientId), null)
  assert.equal(readClientRoles({ resource_access: { [clientId]: {} } }, clientId), null)
  assert.equal(readClientRoles({ resource_access: { [clientId]: { roles: 'OPS-N1' } } }, clientId), null)
  assert.equal(readClientRoles({ resource_access: { [clientId]: { roles: ['OPS-N1', 1] } } }, clientId), null)
})

for (const role of PORTAL_CLIENT_ROLES) {
  test(`${role} grants portal access`, () => {
    assert.equal(hasPortalAccess([role]), true)
    assert.match(getProfileLabel([role]) ?? '', new RegExp(`^${role}`))
  })
}

test('unknown, missing, and case-mismatched roles deny portal access', () => {
  assert.equal(hasPortalAccess([]), false)
  assert.equal(hasPortalAccess(undefined), false)
  assert.equal(hasPortalAccess(['portal-ops-n1']), false)
  assert.equal(hasPortalAccess(['ops-n1']), false)
  assert.equal(hasPortalAccess(['unknown']), false)
})

test('retains only allowlisted Client Roles for the Auth.js session', () => {
  assert.deepEqual(getPortalClientRoles(['unknown', 'AUD', 'OPS-N1']), ['OPS-N1', 'AUD'])
  assert.deepEqual(getPortalClientRoles(undefined), [])
})

test('role-specific checks require an exact role from a non-empty policy', () => {
  assert.equal(hasAnyClientRole(['AUD'], ['AUD']), true)
  assert.equal(hasAnyClientRole(['AUD'], ['ADM-APP']), false)
  assert.equal(hasAnyClientRole(['AUD'], []), false)
})
