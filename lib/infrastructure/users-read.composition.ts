import "server-only";

import { AuthorizePermissionUseCase } from "../../modules/access/application/authorize-permission.usecase";
import { KeycloakAccessRepository } from "../../modules/access/infrastructure/keycloak-access.repository";
import { CountUsersForSubjectUseCase } from "../../modules/users/application/count-users-for-subject.usecase";
import { CountUsersUseCase } from "../../modules/users/application/count-users.usecase";
import { ListUsersForSubjectUseCase } from "../../modules/users/application/list-users-for-subject.usecase";
import { ListUsersUseCase } from "../../modules/users/application/list-users.usecase";
import { KeycloakUserRepository } from "../../modules/users/infrastructure/keycloak-user.repository";
import {
  createKeycloakAdminClient,
  loadKeycloakAdminConfig,
} from "./keycloak-admin.client";

export class UsersReadConfigurationError extends Error {
  constructor() {
    super("Users read access is not configured.");
    this.name = "UsersReadConfigurationError";
  }
}

export async function createUsersReadUseCases() {
  const config = loadKeycloakAdminConfig();
  const humanClientId = process.env.KEYCLOAK_WEB_CLIENT_ID?.trim();

  if (!humanClientId) {
    throw new UsersReadConfigurationError();
  }

  const client = await createKeycloakAdminClient(config);

  const accessRepository = new KeycloakAccessRepository(
    client,
    config.realmName,
    humanClientId,
  );

  const authorize = new AuthorizePermissionUseCase(accessRepository);
  const userRepository = new KeycloakUserRepository(client, config.realmName);

  return {
    list: new ListUsersForSubjectUseCase(
      authorize,
      new ListUsersUseCase(userRepository),
    ),
    count: new CountUsersForSubjectUseCase(
      authorize,
      new CountUsersUseCase(userRepository),
    ),
  };
}
