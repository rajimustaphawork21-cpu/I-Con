// Auth Imports
import { auth } from '@/auth'

// User Imports
import { ListUsersUseCase } from '@/modules/users/application/list-users.usecase'
import type {
  ListUsersRequest,
  ListUsersResult,
  TrustedListUsersContext
} from '@/modules/users/application/list-users.usecase'
import { KeycloakUserDirectoryAdapter } from '@/modules/users/infrastructure/keycloak-user-directory.adapter'
import type {
  DirectoryUser,
  KeycloakAccountVisibilityScope
} from '@/modules/users/infrastructure/keycloak-user-directory.adapter'

// Local Imports
import { createUsersGetHandler, resolveLocalTestAccountVisibility } from './route-handler'

let listUsersUseCase: ListUsersUseCase<DirectoryUser, KeycloakAccountVisibilityScope> | undefined

const executeListUsers = (
  request: ListUsersRequest,
  trusted: TrustedListUsersContext<KeycloakAccountVisibilityScope>
): Promise<ListUsersResult<DirectoryUser>> => {
  listUsersUseCase ??= new ListUsersUseCase(new KeycloakUserDirectoryAdapter())

  return listUsersUseCase.execute(request, trusted)
}

export const dynamic = 'force-dynamic'

export const GET = createUsersGetHandler({
  getSession: () => auth(),
  resolveVisibilityScope: resolveLocalTestAccountVisibility,
  executeListUsers
})
