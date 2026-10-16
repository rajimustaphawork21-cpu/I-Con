#!/usr/bin/env node

import KcAdminClient from "@keycloak/keycloak-admin-client";

import {
  createKeycloakAdminClient,
  KeycloakAdminConfigurationError,
  loadKeycloakAdminConfig,
  loadKeycloakConnectionConfig,
} from "../lib/infrastructure/keycloak-admin.client.ts";
import { ListUsersUseCase } from "../modules/users/application/list-users.usecase.ts";
import {
  KeycloakUserMappingError,
  KeycloakUserRepository,
} from "../modules/users/infrastructure/keycloak-user.repository.ts";

const TEST_ACCESS_TOKEN_ENVIRONMENT_VARIABLE =
  "KEYCLOAK_TEST_ACCESS_TOKEN";

async function run() {
  const client = await createIntegrationClient(process.env);
  const { realmName } = loadKeycloakConnectionConfig(process.env);
  const repository = new KeycloakUserRepository(client, realmName);
  const listUsers = new ListUsersUseCase(repository);
  const users = await listUsers.execute({ first: 0, max: 10 });

  console.log(
    `Keycloak Users read-only integration passed (${users.length} record(s) returned).`,
  );
}

async function createIntegrationClient(environment) {
  const accessToken = environment[
    TEST_ACCESS_TOKEN_ENVIRONMENT_VARIABLE
  ]?.trim();

  if (accessToken === undefined || accessToken.length === 0) {
    return createKeycloakAdminClient(loadKeycloakAdminConfig(environment));
  }

  const config = loadKeycloakConnectionConfig(environment);
  const client = new KcAdminClient(config);
  client.setAccessToken(accessToken);

  return client;
}

function getHttpStatus(error) {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if ("response" in error && typeof error.response === "object") {
    const response = error.response;

    if (
      response !== null &&
      "status" in response &&
      typeof response.status === "number"
    ) {
      return response.status;
    }
  }

  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  return undefined;
}

function reportFailure(error) {
  if (error instanceof KeycloakAdminConfigurationError) {
    console.error(`Keycloak integration configuration error: ${error.message}`);
    return;
  }

  if (error instanceof KeycloakUserMappingError) {
    console.error(
      "Keycloak returned a user record that does not satisfy the Users domain contract.",
    );
    return;
  }

  const status = getHttpStatus(error);

  if (status === 401 || status === 403) {
    console.error(
      `Keycloak rejected the read-only Users request (HTTP ${status}). Check the configured service-account permissions.`,
    );
    return;
  }

  if (status === 404) {
    console.error(
      "Keycloak could not find the configured Realm or Users endpoint (HTTP 404).",
    );
    return;
  }

  console.error(
    "Keycloak Users read-only integration failed. Check the server endpoint and configuration.",
  );
}

run().catch((error) => {
  reportFailure(error);
  process.exitCode = 1;
});
