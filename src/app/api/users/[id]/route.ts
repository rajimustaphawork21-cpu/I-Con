// Auth Imports
import { auth } from '@/auth'

// User Imports
import { GetUserDetailUseCase } from '@/modules/users/application/get-user-detail.usecase'
import type {
  TrustedGetUserDetailContext,
  UserIdentity
} from '@/modules/users/application/get-user-detail.usecase'
import { KeycloakUserDirectoryAdapter } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'
import type { KeycloakAccountVisibilityScope } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'

// Local Imports
import {
  createUserDetailGetHandler,
  isKeycloakAccountIdInScope,
  resolveAccountProtection
} from './route-handler'
import { resolveLocalTestAccountVisibility } from '../route-handler'

let getUserDetailUseCase: GetUserDetailUseCase<UserIdentity, KeycloakAccountVisibilityScope> | undefined
let keycloakUserDirectory: KeycloakUserDirectoryAdapter | undefined

const userDirectory = {
  getById: (accountId: string) => {
    keycloakUserDirectory ??= new KeycloakUserDirectoryAdapter()

    return keycloakUserDirectory.getById(accountId)
  }
}

const executeGetUserDetail = (
  accountId: unknown,
  trusted: TrustedGetUserDetailContext<KeycloakAccountVisibilityScope>
) => {
  getUserDetailUseCase ??= new GetUserDetailUseCase({
    userDirectory,
    isAccountIdInScope: isKeycloakAccountIdInScope,
    protectionResolver: {
      resolve: user => {
        keycloakUserDirectory ??= new KeycloakUserDirectoryAdapter()

        const directory = keycloakUserDirectory

        return resolveAccountProtection(user, candidate => directory.resolveProtection(candidate))
      }
    }

    // RG-45: no protected-account read auditor is wired, so protected reads fail closed.
  })

  return getUserDetailUseCase.execute(accountId, trusted)
}

export const dynamic = 'force-dynamic'

export const GET = createUserDetailGetHandler({
  getSession: () => auth(),
  resolveVisibilityScope: resolveLocalTestAccountVisibility,
  executeGetUserDetail
})
