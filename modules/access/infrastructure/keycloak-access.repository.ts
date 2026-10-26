import type KcAdminClient from "@keycloak/keycloak-admin-client";

import type {
  AccessRepository,
  SubjectAccess,
} from "../domain/access.repository";

type KeycloakAccessReader = {
  readonly clients: Pick<KcAdminClient["clients"], "find">;
  readonly users: Pick<
    KcAdminClient["users"],
    "findOne" | "listClientRoleMappings"
  >;
};

export class KeycloakAccessResolutionError extends Error {
  constructor() {
    super("Keycloak access data could not be resolved.");
    this.name = "KeycloakAccessResolutionError";
  }
}

/** Reads only direct roles belonging to the configured human OIDC client. */
export class KeycloakAccessRepository implements AccessRepository {
  private readonly client: KeycloakAccessReader;
  private readonly realmName: string;
  private readonly humanClientId: string;

  constructor(
    client: KeycloakAccessReader,
    realmName: string,
    humanClientId: string,
  ) {
    this.client = client;
    this.realmName = realmName;
    this.humanClientId = humanClientId;
  }

  async resolveBySubject(subject: string): Promise<SubjectAccess | null> {
    const user = await this.client.users.findOne({
      id: subject,
      realm: this.realmName,
    });

    if (!user) {
      return null;
    }

    if (user.enabled !== true) {
      return {
        subject,
        enabled: false,
        directClientRoles: [],
      };
    }

    const clients = await this.client.clients.find({
      clientId: this.humanClientId,
      first: 0,
      max: 2,
      realm: this.realmName,
    });

    const matchingClients = clients.filter(
      candidate => candidate.clientId === this.humanClientId,
    );

    if (
      matchingClients.length !== 1 ||
      typeof matchingClients[0]?.id !== "string" ||
      matchingClients[0].id.length === 0
    ) {
      throw new KeycloakAccessResolutionError();
    }

    const roles = await this.client.users.listClientRoleMappings({
      id: subject,
      clientUniqueId: matchingClients[0].id,
      realm: this.realmName,
    });

    const directClientRoles = roles.map(role => {
      if (typeof role.name !== "string" || role.name.length === 0) {
        throw new KeycloakAccessResolutionError();
      }

      return role.name;
    });

    return {
      subject,
      enabled: true,
      directClientRoles,
    };
  }
}
