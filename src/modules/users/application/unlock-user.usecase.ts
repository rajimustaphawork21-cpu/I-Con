import 'server-only'

// Auth Imports
import { LOT1_ACTIONS, authorizeLot1, authorizeLot1Operation } from '@/libs/auth/authorization-policy'
import type {
  AuthorizationDenialReason,
  TrustedOperatorContext,
  TrustedUserProtectionFacts
} from '@/libs/auth/authorization-policy'

// User Imports
import { AccountVisibilityScopeUnavailableError } from '@/modules/users/application/list-users.usecase'
import type { ResolvedAccountVisibilityScope } from '@/modules/users/application/list-users.usecase'
import type { ResolvedUserProtection, UserIdentity } from '@/modules/users/application/get-user-detail.usecase'

export type UnlockUserRequest = {
  confirmed?: unknown
}

export type TrustedUnlockUserContext<TScope extends object> = {
  operator: TrustedOperatorContext | null | undefined
  accountVisibilityScope: ResolvedAccountVisibilityScope<TScope> | null | undefined
  correlationId: string
}

export interface UserUnlockDirectoryAdapter<TUser extends UserIdentity> {
  getById(accountId: string): Promise<TUser | null>
}

export interface UserUnlockProtectionResolver<TUser extends UserIdentity> {
  resolve(user: TUser): Promise<ResolvedUserProtection | null>
}

export interface UserBruteForceLockReader {
  isLocked(accountId: string): Promise<boolean>
}

export interface UserUnlocker {
  unlock(accountId: string): Promise<void>
}

type UserUnlockAuditBase = {
  correlationId: string
  operatorSubject: string | null
  targetUserId?: string
  action: 'user:unlock'
}

export type UserUnlockAuditEvent = UserUnlockAuditBase & {
  outcome: 'denied' | 'failure'
  code: string
  severity: 'information' | 'alert'
}

export type UserUnlockAuditExecutionResult =
  | { outcome: 'success' }
  | { outcome: 'failure' }
  | { outcome: 'unavailable' }

/**
 * A production implementation must durably append the final success/failure result and must not
 * invoke `operation` when the append-only path cannot uphold RG-46 and RG-47.
 */
export interface UserUnlockAuditCoordinator {
  record(event: UserUnlockAuditEvent): Promise<void>
  execute(
    operationContext: UserUnlockAuditBase,
    operation: () => Promise<void>
  ): Promise<UserUnlockAuditExecutionResult>
}

export class UnlockUserAuthorizationError extends Error {
  readonly code = 'USER_UNLOCK_FORBIDDEN'

  constructor(readonly reason: AuthorizationDenialReason) {
    super('User unlock is not authorized')
    this.name = 'UnlockUserAuthorizationError'
  }
}

export class UnlockUserConfirmationRequiredError extends Error {
  readonly code = 'UNLOCK_CONFIRMATION_REQUIRED'

  constructor() {
    super('Explicit unlock confirmation is required')
    this.name = 'UnlockUserConfirmationRequiredError'
  }
}

export class UnlockUserNotFoundError extends Error {
  readonly code = 'USER_NOT_FOUND'

  constructor() {
    super('User was not found')
    this.name = 'UnlockUserNotFoundError'
  }
}

export class UnlockUserProtectionUnavailableError extends Error {
  readonly code = 'ACCOUNT_PROTECTION_UNAVAILABLE'

  constructor() {
    super('Account protection could not be resolved')
    this.name = 'UnlockUserProtectionUnavailableError'
  }
}

export class UnlockUserLockStatusUnavailableError extends Error {
  readonly code = 'ACCOUNT_LOCK_STATUS_UNAVAILABLE'

  constructor() {
    super('Account brute-force lock status could not be resolved')
    this.name = 'UnlockUserLockStatusUnavailableError'
  }
}

export class UnlockUserAuditUnavailableError extends Error {
  readonly code = 'USER_UNLOCK_AUDIT_UNAVAILABLE'

  constructor() {
    super('Durable user-unlock auditing is unavailable')
    this.name = 'UnlockUserAuditUnavailableError'
  }
}

export class UnlockUserOperationFailedError extends Error {
  readonly code = 'USER_UNLOCK_FAILED'

  constructor() {
    super('Keycloak user unlock failed')
    this.name = 'UnlockUserOperationFailedError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const readAccountId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new UnlockUserNotFoundError()
  }

  return value
}

const readApprovedScope = <TScope extends object>(value: ResolvedAccountVisibilityScope<TScope> | null | undefined) => {
  if (!value || value.resolution !== 'approved' || !isRecord(value.value)) {
    throw new AccountVisibilityScopeUnavailableError()
  }

  return value.value
}

const readProtection = (value: ResolvedUserProtection | null): TrustedUserProtectionFacts | null => {
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
    return null
  }

  return protection
}

type UnlockUserUseCaseOptions<TUser extends UserIdentity, TScope extends object> = {
  userDirectory: UserUnlockDirectoryAdapter<TUser>
  isAccountIdInScope: (scope: TScope, accountId: string) => boolean | null
  protectionResolver: UserUnlockProtectionResolver<TUser>
  lockReader: UserBruteForceLockReader
  unlocker: UserUnlocker
  auditCoordinator?: UserUnlockAuditCoordinator
}

export class UnlockUserUseCase<TUser extends UserIdentity, TScope extends object> {
  private readonly userDirectory: UserUnlockDirectoryAdapter<TUser>
  private readonly isAccountIdInScope: (scope: TScope, accountId: string) => boolean | null
  private readonly protectionResolver: UserUnlockProtectionResolver<TUser>
  private readonly lockReader: UserBruteForceLockReader
  private readonly unlocker: UserUnlocker
  private readonly auditCoordinator?: UserUnlockAuditCoordinator

  constructor(options: UnlockUserUseCaseOptions<TUser, TScope>) {
    this.userDirectory = options.userDirectory
    this.isAccountIdInScope = options.isAccountIdInScope
    this.protectionResolver = options.protectionResolver
    this.lockReader = options.lockReader
    this.unlocker = options.unlocker
    this.auditCoordinator = options.auditCoordinator
  }

  async execute(
    requestedId: unknown,
    request: UnlockUserRequest,
    trusted: TrustedUnlockUserContext<TScope>
  ): Promise<{ id: string }> {
    const operatorDecision = authorizeLot1Operation({
      operator: trusted.operator,
      action: LOT1_ACTIONS.userUnlock
    })

    if (!operatorDecision.allowed) {
      await this.recordDenied(trusted, undefined, operatorDecision.reason)
      throw new UnlockUserAuthorizationError(operatorDecision.reason)
    }

    let accountId: string

    try {
      accountId = readAccountId(requestedId)
    } catch (error) {
      await this.recordDenied(trusted, undefined, 'USER_NOT_FOUND')
      throw error
    }

    if (request.confirmed !== true) {
      await this.recordDenied(trusted, accountId, 'UNLOCK_CONFIRMATION_REQUIRED')
      throw new UnlockUserConfirmationRequiredError()
    }

    let visibilityScope: TScope

    try {
      visibilityScope = readApprovedScope(trusted.accountVisibilityScope)
    } catch (error) {
      await this.recordDenied(trusted, accountId, 'VISIBILITY_SCOPE_UNAVAILABLE')
      throw error
    }

    const inScope = this.isAccountIdInScope(visibilityScope, accountId)

    if (inScope === null) {
      await this.recordDenied(trusted, accountId, 'VISIBILITY_SCOPE_UNAVAILABLE')
      throw new AccountVisibilityScopeUnavailableError()
    }

    if (!inScope) {
      await this.recordDenied(trusted, accountId, 'USER_NOT_FOUND')
      throw new UnlockUserNotFoundError()
    }

    // No target read or mutation is attempted unless a trusted RG-46 coordinator is available.
    if (!this.auditCoordinator) throw new UnlockUserAuditUnavailableError()

    let user: TUser | null

    try {
      user = await this.userDirectory.getById(accountId)
    } catch {
      await this.recordFailure(trusted, accountId, 'TARGET_RELOAD_FAILED')
      throw new UnlockUserOperationFailedError()
    }

    if (!user) {
      await this.recordDenied(trusted, accountId, 'USER_NOT_FOUND')
      throw new UnlockUserNotFoundError()
    }

    let resolvedProtection: ResolvedUserProtection | null

    try {
      resolvedProtection = await this.protectionResolver.resolve(user)
    } catch {
      resolvedProtection = null
    }

    const protection = readProtection(resolvedProtection)

    if (!protection) {
      await this.recordFailure(trusted, user.id, 'ACCOUNT_PROTECTION_UNAVAILABLE')
      throw new UnlockUserProtectionUnavailableError()
    }

    const targetWithoutLock = {
      user: {
        id: user.id,
        username: user.username,
        isLocked: false,
        protection
      }
    }

    const targetDecision = authorizeLot1({
      operator: trusted.operator,
      action: LOT1_ACTIONS.userUnlock,
      target: targetWithoutLock
    })

    if (!targetDecision.allowed && targetDecision.reason !== 'ACCOUNT_NOT_LOCKED') {
      await this.recordDenied(trusted, user.id, targetDecision.reason)
      throw new UnlockUserAuthorizationError(targetDecision.reason)
    }

    let isLocked: boolean

    try {
      isLocked = await this.lockReader.isLocked(user.id)
    } catch {
      await this.recordFailure(trusted, user.id, 'ACCOUNT_LOCK_STATUS_UNAVAILABLE')
      throw new UnlockUserLockStatusUnavailableError()
    }

    const authorization = authorizeLot1({
      operator: trusted.operator,
      action: LOT1_ACTIONS.userUnlock,
      target: { user: { ...targetWithoutLock.user, isLocked } }
    })

    if (!authorization.allowed) {
      await this.recordDenied(trusted, user.id, authorization.reason)
      throw new UnlockUserAuthorizationError(authorization.reason)
    }

    let result: UserUnlockAuditExecutionResult

    try {
      result = await this.auditCoordinator.execute(this.auditBase(trusted, user.id), () =>
        this.unlocker.unlock(user.id)
      )
    } catch {
      throw new UnlockUserAuditUnavailableError()
    }

    if (result.outcome === 'unavailable') throw new UnlockUserAuditUnavailableError()
    if (result.outcome === 'failure') throw new UnlockUserOperationFailedError()

    return { id: user.id }
  }

  private auditBase(trusted: TrustedUnlockUserContext<TScope>, targetUserId?: string): UserUnlockAuditBase {
    return {
      correlationId: trusted.correlationId,
      operatorSubject: trusted.operator?.subject ?? null,
      ...(targetUserId ? { targetUserId } : {}),
      action: 'user:unlock'
    }
  }

  private async recordDenied(
    trusted: TrustedUnlockUserContext<TScope>,
    targetUserId: string | undefined,
    code: string
  ) {
    if (!this.auditCoordinator) return

    try {
      await this.auditCoordinator.record({
        ...this.auditBase(trusted, targetUserId),
        outcome: 'denied',
        code,
        severity: code === 'PROTECTED_ACCOUNT' ? 'alert' : 'information'
      })
    } catch {
      // A denied operation remains denied even if its audit sink is unavailable.
    }
  }

  private async recordFailure(trusted: TrustedUnlockUserContext<TScope>, targetUserId: string, code: string) {
    if (!this.auditCoordinator) return

    try {
      await this.auditCoordinator.record({
        ...this.auditBase(trusted, targetUserId),
        outcome: 'failure',
        code,
        severity: 'information'
      })
    } catch {
      // No mutation has occurred, so the operation remains safely failed.
    }
  }
}
