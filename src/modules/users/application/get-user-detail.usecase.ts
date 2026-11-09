import 'server-only'

// Auth Imports
import { LOT1_ACTIONS, authorizeLot1, isProtectedUserAccount } from '@/libs/auth/authorization-policy'
import type {
  AuthorizationDenialReason,
  TrustedOperatorContext,
  TrustedUserProtectionFacts
} from '@/libs/auth/authorization-policy'

// User Imports
import { AccountVisibilityScopeUnavailableError } from '@/modules/users/application/list-users.usecase'
import type { ResolvedAccountVisibilityScope } from '@/modules/users/application/list-users.usecase'

export type UserIdentity = {
  id: string
  username: string
  firstName?: string
  lastName?: string
  email?: string
  enabled: boolean
}

export type ResolvedUserProtection = {
  resolution: 'resolved'
  value: TrustedUserProtectionFacts
}

export type TrustedGetUserDetailContext<TScope extends object> = {
  operator: TrustedOperatorContext | null | undefined
  accountVisibilityScope: ResolvedAccountVisibilityScope<TScope> | null | undefined
}

export interface UserDetailDirectoryAdapter<TUser extends UserIdentity> {
  getById(accountId: string): Promise<TUser | null>
}

export interface UserProtectionResolver<TUser extends UserIdentity> {
  resolve(user: TUser): Promise<ResolvedUserProtection | null>
}

export interface ProtectedAccountReadAuditor {
  record(input: { operatorSubject: string; targetUserId: string; action: 'user:read' }): Promise<void>
}

export class GetUserDetailAuthorizationError extends Error {
  readonly code = 'GET_USER_DETAIL_FORBIDDEN'

  constructor(readonly reason: AuthorizationDenialReason) {
    super('Get user detail is not authorized')
    this.name = 'GetUserDetailAuthorizationError'
  }
}

export class UserDetailNotFoundError extends Error {
  readonly code = 'USER_NOT_FOUND'

  constructor() {
    super('User was not found')
    this.name = 'UserDetailNotFoundError'
  }
}

export class UserProtectionUnavailableError extends Error {
  readonly code = 'ACCOUNT_PROTECTION_UNAVAILABLE'

  constructor() {
    super('Account protection could not be resolved')
    this.name = 'UserProtectionUnavailableError'
  }
}

export class ProtectedAccountReadAuditUnavailableError extends Error {
  readonly code = 'PROTECTED_ACCOUNT_READ_AUDIT_UNAVAILABLE'

  constructor() {
    super('Protected-account read auditing is unavailable')
    this.name = 'ProtectedAccountReadAuditUnavailableError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const readAccountId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new UserDetailNotFoundError()
  }

  return value
}

const readApprovedScope = <TScope extends object>(
  value: ResolvedAccountVisibilityScope<TScope> | null | undefined
) => {
  if (!value || value.resolution !== 'approved' || !isRecord(value.value)) {
    throw new AccountVisibilityScopeUnavailableError()
  }

  return value.value
}

const readProtection = (value: ResolvedUserProtection | null): TrustedUserProtectionFacts => {
  const protection = value?.value

  if (
    value?.resolution !== 'resolved' ||
    !protection ||
    typeof protection.hasRealmManagementRole !== 'boolean' ||
    typeof protection.hasRealmAdministrationRole !== 'boolean' ||
    typeof protection.isSsoAdministratorsGroupMember !== 'boolean' ||
    typeof protection.hasProtectedAttribute !== 'boolean' ||
    typeof protection.isServiceAccount !== 'boolean'
  ) {
    throw new UserProtectionUnavailableError()
  }

  return protection
}

type GetUserDetailUseCaseOptions<TUser extends UserIdentity, TScope extends object> = {
  userDirectory: UserDetailDirectoryAdapter<TUser>
  isAccountIdInScope: (scope: TScope, accountId: string) => boolean | null
  protectionResolver: UserProtectionResolver<TUser>
  protectedAccountReadAuditor?: ProtectedAccountReadAuditor
}

export class GetUserDetailUseCase<TUser extends UserIdentity, TScope extends object> {
  private readonly userDirectory: UserDetailDirectoryAdapter<TUser>
  private readonly isAccountIdInScope: (scope: TScope, accountId: string) => boolean | null
  private readonly protectionResolver: UserProtectionResolver<TUser>
  private readonly protectedAccountReadAuditor?: ProtectedAccountReadAuditor

  constructor(options: GetUserDetailUseCaseOptions<TUser, TScope>) {
    this.userDirectory = options.userDirectory
    this.isAccountIdInScope = options.isAccountIdInScope
    this.protectionResolver = options.protectionResolver
    this.protectedAccountReadAuditor = options.protectedAccountReadAuditor
  }

  async execute(
    requestedId: unknown,
    trusted: TrustedGetUserDetailContext<TScope>
  ): Promise<TUser> {
    const authorization = authorizeLot1({
      operator: trusted.operator,
      action: LOT1_ACTIONS.userRead
    })

    if (!authorization.allowed) throw new GetUserDetailAuthorizationError(authorization.reason)

    const accountId = readAccountId(requestedId)
    const visibilityScope = readApprovedScope(trusted.accountVisibilityScope)
    const inScope = this.isAccountIdInScope(visibilityScope, accountId)

    if (inScope === null) throw new AccountVisibilityScopeUnavailableError()
    if (!inScope) throw new UserDetailNotFoundError()

    const user = await this.userDirectory.getById(accountId)

    if (!user) throw new UserDetailNotFoundError()

    let resolvedProtection: ResolvedUserProtection | null

    try {
      resolvedProtection = await this.protectionResolver.resolve(user)
    } catch {
      resolvedProtection = null
    }

    const protection = readProtection(resolvedProtection)

    if (isProtectedUserAccount({ username: user.username, protection })) {
      if (!this.protectedAccountReadAuditor) throw new ProtectedAccountReadAuditUnavailableError()

      try {
        await this.protectedAccountReadAuditor.record({
          operatorSubject: trusted.operator!.subject,
          targetUserId: user.id,
          action: 'user:read'
        })
      } catch {
        throw new ProtectedAccountReadAuditUnavailableError()
      }
    }

    return user
  }
}
