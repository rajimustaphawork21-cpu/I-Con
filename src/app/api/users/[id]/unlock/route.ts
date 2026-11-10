// Auth Imports
import { auth } from '@/auth'

// User Imports
import { UnlockUserUseCase } from '@/modules/users/application/unlock-user.usecase'
import type { TrustedUnlockUserContext, UnlockUserRequest } from '@/modules/users/application/unlock-user.usecase'
import { KeycloakUserDirectoryAdapter } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'
import type {
  DirectoryUser,
  KeycloakAccountVisibilityScope
} from '@/modules/users/infrastructure/keycloak-user-directory.adapter'
import { KeycloakUserUnlockAdapter } from '@/modules/users/infrastructure/keycloak-user-unlock.adapter'

// Local Imports
import { createUserUnlockPostHandler } from './route-handler'
import { isKeycloakAccountIdInScope } from '../route-handler'
import { resolveLocalTestAccountVisibility } from '../../route-handler'

let unlockUserUseCase: UnlockUserUseCase<DirectoryUser, KeycloakAccountVisibilityScope> | undefined
let keycloakUserDirectory: KeycloakUserDirectoryAdapter | undefined
let keycloakUserUnlocker: KeycloakUserUnlockAdapter | undefined

const directory = () => {
  keycloakUserDirectory ??= new KeycloakUserDirectoryAdapter()

  return keycloakUserDirectory
}

const executeUnlock = (
  accountId: unknown,
  request: UnlockUserRequest,
  trusted: TrustedUnlockUserContext<KeycloakAccountVisibilityScope>
) => {
  unlockUserUseCase ??= new UnlockUserUseCase({
    userDirectory: { getById: id => directory().getById(id) },
    isAccountIdInScope: isKeycloakAccountIdInScope,
    protectionResolver: { resolve: user => directory().resolveProtection(user) },
    lockReader: { isLocked: id => directory().isLocked(id) },
    unlocker: {
      unlock: id => {
        keycloakUserUnlocker ??= new KeycloakUserUnlockAdapter()

        return keycloakUserUnlocker.unlock(id)
      }
    }

    // RG-45..47 blocker: no durable append-only audit coordinator is available yet.
    // UnlockUserUseCase therefore refuses the operation before any Keycloak target read or write.
  })

  return unlockUserUseCase.execute(accountId, request, trusted)
}

export const dynamic = 'force-dynamic'

export const POST = createUserUnlockPostHandler({
  getSession: () => auth(),
  resolveVisibilityScope: resolveLocalTestAccountVisibility,
  executeUnlock
})
