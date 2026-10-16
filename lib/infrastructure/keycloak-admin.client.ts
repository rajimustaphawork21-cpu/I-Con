import KcAdminClient from "@keycloak/keycloak-admin-client";

const CONNECTION_ENVIRONMENT_VARIABLES = [
  "KEYCLOAK_URL",
  "KEYCLOAK_REALM",
] as const;

const ADMIN_ENVIRONMENT_VARIABLES = [
  ...CONNECTION_ENVIRONMENT_VARIABLES,
  "KEYCLOAK_ADMIN_CLIENT_ID",
  "KEYCLOAK_ADMIN_CLIENT_SECRET",
] as const;

export interface KeycloakConnectionConfig {
  readonly baseUrl: string;
  readonly realmName: string;
}

export interface KeycloakAdminConfig extends KeycloakConnectionConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export class KeycloakAdminConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeycloakAdminConfigurationError";
  }
}

export function loadKeycloakConnectionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): KeycloakConnectionConfig {
  assertRequiredEnvironmentVariables(
    environment,
    CONNECTION_ENVIRONMENT_VARIABLES,
  );

  return {
    baseUrl: normalizeBaseUrl(environment.KEYCLOAK_URL as string),
    realmName: (environment.KEYCLOAK_REALM as string).trim(),
  };
}

export function loadKeycloakAdminConfig(
  environment: NodeJS.ProcessEnv = process.env,
): KeycloakAdminConfig {
  assertRequiredEnvironmentVariables(environment, ADMIN_ENVIRONMENT_VARIABLES);

  return {
    ...loadKeycloakConnectionConfig(environment),
    clientId: (environment.KEYCLOAK_ADMIN_CLIENT_ID as string).trim(),
    clientSecret: environment.KEYCLOAK_ADMIN_CLIENT_SECRET as string,
  };
}

export async function createKeycloakAdminClient(
  config: KeycloakAdminConfig,
): Promise<KcAdminClient> {
  const client = new KcAdminClient({
    baseUrl: config.baseUrl,
    realmName: config.realmName,
  });

  await client.auth({
    grantType: "client_credentials",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  return client;
}

function assertRequiredEnvironmentVariables(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
): void {
  const missingNames = names.filter((name) => {
    const value = environment[name];

    return value === undefined || value.trim().length === 0;
  });

  if (missingNames.length === 0) {
    return;
  }

  throw new KeycloakAdminConfigurationError(
    `Missing required environment variable(s): ${missingNames.join(", ")}.`,
  );
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new KeycloakAdminConfigurationError(
      "KEYCLOAK_URL must be a valid HTTP or HTTPS URL.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new KeycloakAdminConfigurationError(
      "KEYCLOAK_URL must use the HTTP or HTTPS protocol.",
    );
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new KeycloakAdminConfigurationError(
      "KEYCLOAK_URL must not contain a query string or fragment.",
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new KeycloakAdminConfigurationError(
      "KEYCLOAK_URL must not contain embedded credentials.",
    );
  }

  return url.toString().replace(/\/$/, "");
}
