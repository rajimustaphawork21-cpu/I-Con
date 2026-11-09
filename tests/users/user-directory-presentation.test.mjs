import assert from 'node:assert/strict'
import test from 'node:test'

import directoryModule from '../../src/modules/users/presentation/user-directory.ts'

const {
  buildDirectoryRequestUrl,
  getDirectoryErrorKind,
  isDirectorySearchValid,
  normalizeDirectorySearch,
  parseDirectoryPage
} = directoryModule

test('directory search normalization enforces RG-09 without rejecting an empty search', () => {
  assert.equal(normalizeDirectorySearch('  ali  '), 'ali')
  assert.equal(isDirectorySearchValid(''), true)
  assert.equal(isDirectorySearchValid('ab'), false)
  assert.equal(isDirectorySearchValid('ali'), true)
})

test('directory request URL carries search and server-side pagination only', () => {
  assert.equal(buildDirectoryRequestUrl('ali ce', 2, 50), '/api/users?page=2&pageSize=50&search=ali+ce')
  assert.equal(buildDirectoryRequestUrl('', 1, 20), '/api/users?page=1&pageSize=20')
})

test('directory response parsing keeps only supported DTO fields', () => {
  const page = parseDirectoryPage({
    users: [
      {
        id: 'user-1',
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Example',
        email: 'alice@example.test',
        enabled: false,
        locked: true,
        protected: true,
        credentials: ['must-not-be-kept']
      }
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    internal: 'must-not-be-kept'
  })

  assert.deepEqual(page, {
    users: [
      {
        id: 'user-1',
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Example',
        email: 'alice@example.test',
        enabled: false
      }
    ],
    total: 1,
    page: 1,
    pageSize: 20
  })
})

test('directory response parsing fails closed for malformed DTOs', () => {
  assert.equal(
    parseDirectoryPage({ users: [{ id: 'user-1', username: 'alice' }], total: 1, page: 1, pageSize: 20 }),
    null
  )
})

test('HTTP statuses map to the required directory UI states', () => {
  assert.equal(getDirectoryErrorKind(400), 'invalid-search')
  assert.equal(getDirectoryErrorKind(401), 'session-expired')
  assert.equal(getDirectoryErrorKind(403), 'forbidden')
  assert.equal(getDirectoryErrorKind(502), 'upstream')
  assert.equal(getDirectoryErrorKind(503), 'upstream')
  assert.equal(getDirectoryErrorKind(500), 'unknown')
})
