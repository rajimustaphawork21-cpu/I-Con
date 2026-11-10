// Auth Imports
import { auth } from '@/auth'

// User Imports
import { KeycloakUserDirectoryAdapter } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'

// Local Imports
import { createSimulatedUnlockGetHandler } from './route-handler'
import { isKeycloakAccountIdInScope } from '../route-handler'
import { resolveLocalTestAccountVisibility } from '../../route-handler'

let keycloakUserDirectory: KeycloakUserDirectoryAdapter | undefined

const directory = () => {
  keycloakUserDirectory ??= new KeycloakUserDirectoryAdapter()

  return keycloakUserDirectory
}

export const dynamic = 'force-dynamic'

export const GET = createSimulatedUnlockGetHandler({
  getSession: () => auth(),
  resolveVisibilityScope: resolveLocalTestAccountVisibility,
  isAccountIdInScope: isKeycloakAccountIdInScope,
  getUserById: accountId => directory().getById(accountId),

  // Demo eligibility must never use the development-only unprotected-account override.
  resolveProtection: user => directory().resolveProtection(user)
})
