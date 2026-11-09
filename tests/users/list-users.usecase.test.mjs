import assert from 'node:assert/strict'
import test from 'node:test'

import listUsersModule from '../../src/modules/users/application/list-users.usecase.ts'

const {
  AccountVisibilityScopeUnavailableError,
  ListUsersAuthorizationError,
  ListUsersUseCase,
  ListUsersValidationError
} = listUsersModule

const users = [
  { id: 'user-1', username: 'alice' },
  { id: 'user-2', username: 'alicia' },
  { id: 'user-3', username: 'bob' }
]

const operator = roles => ({
  subject: 'operator-user',
  roles,
  delegatedApplicationIds: [],
  delegableRoleIds: [],
  delegableGroupIds: [],
  modifiableProfileFields: []
})

const approvedScope = allowedAccountIds => ({
  resolution: 'approved',
  value: { allowedAccountIds }
})

class TestUserDirectoryAdapter {
  calls = []

  async list(query, visibilityScope) {
    this.calls.push({ query, visibilityScope })

    const inScope = users.filter(user => visibilityScope.allowedAccountIds.includes(user.id))
    const matching = query.search
      ? inScope.filter(user => user.username.toLowerCase().includes(query.search.toLowerCase()))
      : inScope

    return {
      users: matching.slice(query.offset, query.offset + query.pageSize),
      total: matching.length
    }
  }
}

test('an authorized single-role operator receives only in-scope users with RG-10 defaults', async () => {
  const adapter = new TestUserDirectoryAdapter()
  const useCase = new ListUsersUseCase(adapter)

  const result = await useCase.execute(
    {},
    {
      operator: operator(['OPS-N1']),
      accountVisibilityScope: approvedScope(['user-1', 'user-3'])
    }
  )

  assert.deepEqual(result, {
    users: [users[0], users[2]],
    total: 2,
    page: 1,
    pageSize: 20
  })
  assert.equal(adapter.calls.length, 1)
  assert.deepEqual(adapter.calls[0].query, { page: 1, pageSize: 20, offset: 0 })
})

test('search is trimmed, applied within scope, and requires at least three characters', async () => {
  const adapter = new TestUserDirectoryAdapter()
  const useCase = new ListUsersUseCase(adapter)
  const trusted = {
    operator: operator(['AUD']),
    accountVisibilityScope: approvedScope(['user-1'])
  }

  const result = await useCase.execute({ search: '  ali  ' }, trusted)

  assert.deepEqual(result.users, [users[0]])
  assert.equal(adapter.calls[0].query.search, 'ali')

  await assert.rejects(
    () => useCase.execute({ search: 'ab' }, trusted),
    error => error instanceof ListUsersValidationError && error.code === 'SEARCH_TOO_SHORT'
  )
  assert.equal(adapter.calls.length, 1)
})

test('page size accepts 100, rejects values above 100, and calculates the offset', async () => {
  const adapter = new TestUserDirectoryAdapter()
  const useCase = new ListUsersUseCase(adapter)
  const trusted = {
    operator: operator(['ADM-APP']),
    accountVisibilityScope: approvedScope(users.map(user => user.id))
  }

  await useCase.execute({ page: 2, pageSize: 100 }, trusted)

  assert.deepEqual(adapter.calls[0].query, { page: 2, pageSize: 100, offset: 100 })

  await assert.rejects(
    () => useCase.execute({ pageSize: 101 }, trusted),
    error => error instanceof ListUsersValidationError && error.code === 'INVALID_PAGE_SIZE'
  )
  assert.equal(adapter.calls.length, 1)
})

test('an unauthorized operator never reaches the adapter', async () => {
  const adapter = new TestUserDirectoryAdapter()
  const useCase = new ListUsersUseCase(adapter)

  await assert.rejects(
    () =>
      useCase.execute(
        {},
        {
          operator: operator(['unknown-role']),
          accountVisibilityScope: approvedScope(['user-1'])
        }
      ),
    error => error instanceof ListUsersAuthorizationError && error.reason === 'PORTAL_ROLE_REQUIRED'
  )
  assert.equal(adapter.calls.length, 0)
})

test('a DEC-AUTH-001 multi-role operator never reaches the adapter', async () => {
  const adapter = new TestUserDirectoryAdapter()
  const useCase = new ListUsersUseCase(adapter)

  await assert.rejects(
    () =>
      useCase.execute(
        {},
        {
          operator: operator(['AUD', 'ADM-APP']),
          accountVisibilityScope: approvedScope(['user-1'])
        }
      ),
    error => error instanceof ListUsersAuthorizationError && error.reason === 'SINGLE_PORTAL_ROLE_REQUIRED'
  )
  assert.equal(adapter.calls.length, 0)
})

test('a request without a resolved visibility scope never reaches the adapter', async () => {
  const adapter = new TestUserDirectoryAdapter()
  const useCase = new ListUsersUseCase(adapter)

  await assert.rejects(
    () =>
      useCase.execute(
        { search: 'alice' },
        {
          operator: operator(['ADM-CONSOLE']),
          accountVisibilityScope: null
        }
      ),
    AccountVisibilityScopeUnavailableError
  )
  assert.equal(adapter.calls.length, 0)
})
