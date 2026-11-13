// Auth Imports
import { auth } from '@/auth'

// User Imports
import {
  UnlockUserUseCase,
  UserUnlockDispatchOutcomeUnknownError
} from '@/modules/users/application/unlock-user.usecase'
import type { TrustedUnlockUserContext, UnlockUserRequest } from '@/modules/users/application/unlock-user.usecase'
import { KeycloakUserDirectoryAdapter } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'
import type {
  DirectoryUser,
  KeycloakAccountVisibilityScope
} from '@/modules/users/infrastructure/keycloak-user-directory.adapter'
import {
  KeycloakUserUnlockAdapter,
  KeycloakUserUnlockError
} from '@/modules/users/infrastructure/keycloak-user-unlock.adapter'
import {
  PostgresUserUnlockAuditCoordinator,
  createAuditDatabasePool
} from '@/modules/users/infrastructure/postgres-user-unlock-audit.coordinator'

// Local Imports
import {
  createUserUnlockGetHandler,
  createUserUnlockPostHandler,
  readLocalDevelopmentUnlockConfiguration
} from './route-handler'
import { isKeycloakAccountIdInScope } from '../route-handler'
import { resolveLocalTestAccountVisibility } from '../../route-handler'

let keycloakUserDirectory: KeycloakUserDirectoryAdapter | undefined
let keycloakUserUnlocker: KeycloakUserUnlockAdapter | undefined
let auditPool: ReturnType<typeof createAuditDatabasePool> | undefined
let auditCoordinator: PostgresUserUnlockAuditCoordinator | undefined

const directory = () => {
  keycloakUserDirectory ??= new KeycloakUserDirectoryAdapter()

  return keycloakUserDirectory
}

const resolveAuditCoordinator = (accountId: unknown) => {
  const configuration = readLocalDevelopmentUnlockConfiguration()

  if (!configuration.enabled || accountId !== configuration.accountId) return undefined

  try {
    auditPool ??= createAuditDatabasePool()
    auditCoordinator ??= new PostgresUserUnlockAuditCoordinator(auditPool)

    return auditCoordinator
  } catch {
    return undefined
  }
}

const executeUnlock = (
  accountId: unknown,
  request: UnlockUserRequest,
  trusted: TrustedUnlockUserContext<KeycloakAccountVisibilityScope>
) => {
  const coordinator = resolveAuditCoordinator(accountId)

  const unlockUserUseCase = new UnlockUserUseCase<DirectoryUser, KeycloakAccountVisibilityScope>({
    userDirectory: { getById: id => directory().getById(id) },
    isAccountIdInScope: isKeycloakAccountIdInScope,
    protectionResolver: { resolve: user => directory().resolveProtection(user) },
    lockReader: { isLocked: id => directory().isLocked(id) },
    unlocker: {
      unlock: async id => {
        keycloakUserUnlocker ??= new KeycloakUserUnlockAdapter()

        try {
          await keycloakUserUnlocker.unlock(id)
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'icon.user_unlock.upstream_error',
              correlationId: trusted.correlationId,
              targetUserId: id,
              stage:
                error instanceof KeycloakUserUnlockError
                  ? (error.stage ?? 'unknown')
                  : 'attack_detection_delete',
              code:
                error instanceof KeycloakUserUnlockError
                  ? error.code
                  : error instanceof UserUnlockDispatchOutcomeUnknownError
                    ? 'OUTCOME_UNKNOWN'
                    : 'UNKNOWN_ERROR',
              upstreamStatus: error instanceof KeycloakUserUnlockError ? (error.status ?? null) : null
            })
          )

          throw error
        }
      }
    },
    ...(coordinator ? { auditCoordinator: coordinator } : {})
  })

  return unlockUserUseCase.execute(accountId, request, trusted)
}

export const dynamic = 'force-dynamic'

export const GET = createUserUnlockGetHandler({
  getSession: () => auth(),
  resolveVisibilityScope: resolveLocalTestAccountVisibility,
  isAccountIdInScope: isKeycloakAccountIdInScope,
  getUserById: accountId => directory().getById(accountId),
  resolveProtection: user => directory().resolveProtection(user),
  isLocked: accountId => directory().isLocked(accountId)
})

export const POST = createUserUnlockPostHandler({
  getSession: () => auth(),
  resolveVisibilityScope: resolveLocalTestAccountVisibility,
  executeUnlock
})
