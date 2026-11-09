import 'server-only'

// Auth Imports
import { LOT1_ACTIONS, authorizeLot1 } from '@/libs/auth/authorization-policy'
import type { AuthorizationDenialReason, TrustedOperatorContext } from '@/libs/auth/authorization-policy'

export type ListUsersRequest = {
  search?: unknown
  page?: unknown
  pageSize?: unknown
}

export type ValidatedListUsersQuery = {
  search?: string
  page: number
  pageSize: number
  offset: number
}

export type UserDirectoryPage<TUser> = {
  users: readonly TUser[]
  total: number
}

/**
 * Opaque visibility constraints resolved and approved by a future server adapter.
 * Request data must never be used to construct this value.
 */
export type ResolvedAccountVisibilityScope<TScope extends object> = {
  resolution: 'approved'
  value: TScope
}

export type TrustedListUsersContext<TScope extends object> = {
  operator: TrustedOperatorContext | null | undefined
  accountVisibilityScope: ResolvedAccountVisibilityScope<TScope> | null | undefined
}

export type ListUsersResult<TUser> = UserDirectoryPage<TUser> & {
  page: number
  pageSize: number
}

export interface UserDirectoryAdapter<TUser, TScope extends object> {

  /** The adapter must apply visibility scope before pagination. */
  list(query: ValidatedListUsersQuery, visibilityScope: TScope): Promise<UserDirectoryPage<TUser>>
}

export type ListUsersValidationCode =
  | 'INVALID_REQUEST'
  | 'SEARCH_TOO_SHORT'
  | 'INVALID_PAGE'
  | 'INVALID_PAGE_SIZE'

export class ListUsersAuthorizationError extends Error {
  readonly code = 'LIST_USERS_FORBIDDEN'

  constructor(readonly reason: AuthorizationDenialReason) {
    super('List users is not authorized')
    this.name = 'ListUsersAuthorizationError'
  }
}

export class AccountVisibilityScopeUnavailableError extends Error {
  readonly code = 'ACCOUNT_VISIBILITY_SCOPE_UNAVAILABLE'

  constructor() {
    super('Account visibility scope is unavailable')
    this.name = 'AccountVisibilityScopeUnavailableError'
  }
}

export class ListUsersValidationError extends Error {
  constructor(readonly code: ListUsersValidationCode) {
    super('List users request is invalid')
    this.name = 'ListUsersValidationError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const readPositiveInteger = (
  value: unknown,
  fallback: number,
  code: Extract<ListUsersValidationCode, 'INVALID_PAGE' | 'INVALID_PAGE_SIZE'>
) => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new ListUsersValidationError(code)

  return value
}

export const validateListUsersRequest = (input: unknown): ValidatedListUsersQuery => {
  if (input !== undefined && !isRecord(input)) throw new ListUsersValidationError('INVALID_REQUEST')

  const request = (input ?? {}) as ListUsersRequest
  let search: string | undefined

  if (request.search !== undefined) {
    if (typeof request.search !== 'string') throw new ListUsersValidationError('INVALID_REQUEST')

    search = request.search.trim()

    if (search.length < 3) throw new ListUsersValidationError('SEARCH_TOO_SHORT')
  }

  const page = readPositiveInteger(request.page, 1, 'INVALID_PAGE')
  const pageSize = readPositiveInteger(request.pageSize, 20, 'INVALID_PAGE_SIZE')

  if (pageSize > 100) throw new ListUsersValidationError('INVALID_PAGE_SIZE')

  const offset = (page - 1) * pageSize

  if (!Number.isSafeInteger(offset)) throw new ListUsersValidationError('INVALID_PAGE')

  return { ...(search === undefined ? {} : { search }), page, pageSize, offset }
}

const readApprovedScope = <TScope extends object>(
  value: ResolvedAccountVisibilityScope<TScope> | null | undefined
): TScope => {
  if (!value || value.resolution !== 'approved' || !isRecord(value.value)) {
    throw new AccountVisibilityScopeUnavailableError()
  }

  return value.value
}

export class ListUsersUseCase<TUser, TScope extends object> {
  constructor(private readonly userDirectory: UserDirectoryAdapter<TUser, TScope>) {}

  async execute(request: unknown, trusted: TrustedListUsersContext<TScope>): Promise<ListUsersResult<TUser>> {
    const authorization = authorizeLot1({
      operator: trusted.operator,
      action: LOT1_ACTIONS.userRead
    })

    if (!authorization.allowed) throw new ListUsersAuthorizationError(authorization.reason)

    // Scope is a trusted server input and is deliberately separate from the request query.
    const visibilityScope = readApprovedScope(trusted.accountVisibilityScope)
    const query = validateListUsersRequest(request)
    const page = await this.userDirectory.list(query, visibilityScope)

    return { ...page, page: query.page, pageSize: query.pageSize }
  }
}
