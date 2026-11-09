import assert from 'node:assert/strict'
import test from 'node:test'

import useCaseModule from '../../src/modules/users/application/list-users.usecase.ts'
import routeHandlerModule from '../../src/app/api/users/route-handler.ts'

const { ListUsersUseCase } = useCaseModule
const { createUsersGetHandler } = routeHandlerModule

const users = [
  { id: 'user-1', username: 'alice', firstName: 'Alice', email: 'alice@example.test', enabled: true },
  { id: 'user-2', username: 'alicia', firstName: 'Alicia', email: 'alicia@example.test', enabled: true },
  { id: 'user-3', username: 'bob', enabled: false }
]

const session = roles => ({
  user: { id: 'operator-1' },
  clientRoles: roles
})

const approvedScope = accountIds => ({
  resolution: 'approved',
  value: { mode: 'account-ids', accountIds }
})

class TestDirectoryAdapter {
  calls = []

  async list(query, scope) {
    this.calls.push({ query, scope })

    const scopedUsers = users.filter(user => scope.accountIds.includes(user.id))
    const matchingUsers = query.search
      ? scopedUsers.filter(user =>
          [user.username, user.firstName, user.email]
            .filter(Boolean)
            .some(value => value.toLowerCase().includes(query.search.toLowerCase()))
        )
      : scopedUsers

    return {
      users: matchingUsers.slice(query.offset, query.offset + query.pageSize).map(user => ({
        ...user,
        internalOnly: 'must-not-leave-the-route'
      })),
      total: matchingUsers.length
    }
  }
}

const createTestRoute = ({ currentSession, scope }) => {
  const adapter = new TestDirectoryAdapter()
  const useCase = new ListUsersUseCase(adapter)
  let resolverCalls = 0

  const handler = createUsersGetHandler({
    getSession: async () => currentSession,
    resolveVisibilityScope: async () => {
      resolverCalls += 1

      return scope
    },
    executeListUsers: (request, trusted) => useCase.execute(request, trusted)
  })

  return { adapter, getResolverCalls: () => resolverCalls, handler }
}

test('GET /api/users returns an authorized scoped directory page without cacheable or extra fields', async () => {
  const { adapter, handler } = createTestRoute({
    currentSession: session(['OPS-N1']),
    scope: approvedScope(['user-1', 'user-3'])
  })
  const response = await handler(new Request('http://localhost/api/users?search=ali&page=1&pageSize=1'))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /no-store/)
  assert.equal(response.headers.get('pragma'), 'no-cache')
  assert.deepEqual(body, {
    users: [
      {
        id: 'user-1',
        username: 'alice',
        firstName: 'Alice',
        email: 'alice@example.test',
        enabled: true
      }
    ],
    total: 1,
    page: 1,
    pageSize: 1
  })
  assert.deepEqual(adapter.calls[0].query, { search: 'ali', page: 1, pageSize: 1, offset: 0 })
})

test('GET /api/users returns 401 for a missing session without resolving scope or calling the adapter', async () => {
  const { adapter, getResolverCalls, handler } = createTestRoute({
    currentSession: null,
    scope: approvedScope(['user-1'])
  })
  const response = await handler(new Request('http://localhost/api/users'))

  assert.equal(response.status, 401)
  assert.equal(getResolverCalls(), 0)
  assert.equal(adapter.calls.length, 0)
})

test('GET /api/users returns 403 for a DEC-AUTH-001 multi-role session without calling the adapter', async () => {
  const { adapter, handler } = createTestRoute({
    currentSession: session(['AUD', 'ADM-APP']),
    scope: approvedScope(['user-1'])
  })
  const response = await handler(new Request('http://localhost/api/users'))

  assert.equal(response.status, 403)
  assert.equal(adapter.calls.length, 0)
})

test('GET /api/users returns 403 for unresolved visibility without calling the adapter', async () => {
  const { adapter, handler } = createTestRoute({
    currentSession: session(['ADM-CONSOLE']),
    scope: null
  })
  const response = await handler(new Request('http://localhost/api/users'))

  assert.equal(response.status, 403)
  assert.equal(adapter.calls.length, 0)
})

test('forged scope query parameters and headers cannot expand the server-approved account scope', async () => {
  const { adapter, handler } = createTestRoute({
    currentSession: session(['OPS-N1']),
    scope: approvedScope(['user-1'])
  })
  const response = await handler(
    new Request(
      'http://localhost/api/users?search=ali&pageSize=100&visibilityScope=realm-wide&accountIds=user-2',
      {
        headers: {
          'x-account-visibility-scope': 'realm-wide',
          'x-approved-account-ids': 'user-2'
        }
      }
    )
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body.users.map(user => user.id), ['user-1'])
  assert.deepEqual(adapter.calls[0].scope, { mode: 'account-ids', accountIds: ['user-1'] })
})

test('forged role query parameters and headers cannot authorize an unrecognized session role', async () => {
  const { adapter, handler } = createTestRoute({
    currentSession: session(['NOT-A-PORTAL-ROLE']),
    scope: approvedScope(['user-1'])
  })
  const response = await handler(
    new Request('http://localhost/api/users?roles=OPS-N1', {
      headers: { 'x-icon-client-roles': 'OPS-N1' }
    })
  )

  assert.equal(response.status, 403)
  assert.equal(adapter.calls.length, 0)
})
