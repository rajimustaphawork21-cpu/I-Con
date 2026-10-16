import type KcAdminClient from "@keycloak/keycloak-admin-client";

import type {
  ListUsersQuery,
  UserRepository,
} from "../domain/user.repository";
import type { User } from "../domain/user.type";

type KeycloakUserRepresentation = Awaited<
  ReturnType<KcAdminClient["users"]["find"]>
>[number];

type KeycloakUsersReader = {
  readonly users: Pick<KcAdminClient["users"], "find">;
};

export class KeycloakUserMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeycloakUserMappingError";
  }
}

export class KeycloakUserRepository implements UserRepository {
  private readonly client: KeycloakUsersReader;
  private readonly realmName: string;

  constructor(client: KeycloakUsersReader, realmName: string) {
    this.client = client;
    this.realmName = realmName;
  }

  async list(query: ListUsersQuery): Promise<User[]> {
    const users = await this.client.users.find({
      first: query.first,
      max: query.max,
      ...(query.search === undefined ? {} : { search: query.search }),
      realm: this.realmName,
    });

    return users.map(mapUser);
  }
}

function mapUser(
  representation: KeycloakUserRepresentation,
  index: number,
): User {
  const id = requireNonEmptyString(representation.id, "id", index);
  const username = requireNonEmptyString(
    representation.username,
    "username",
    index,
  );

  if (typeof representation.enabled !== "boolean") {
    throw new KeycloakUserMappingError(
      `Keycloak user record ${index} is missing the required enabled field.`,
    );
  }

  if (
    representation.email !== undefined &&
    typeof representation.email !== "string"
  ) {
    throw new KeycloakUserMappingError(
      `Keycloak user record ${index} has an invalid email field.`,
    );
  }

  return {
    id,
    username,
    enabled: representation.enabled,
    ...(representation.email === undefined
      ? {}
      : { email: representation.email }),
  };
}

function requireNonEmptyString(
  value: unknown,
  field: "id" | "username",
  index: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KeycloakUserMappingError(
      `Keycloak user record ${index} is missing the required ${field} field.`,
    );
  }

  return value;
}
