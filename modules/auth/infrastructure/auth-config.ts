const REQUIRED_ENVIRONMENT_VARIABLES = [
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "KEYCLOAK_URL",
  "KEYCLOAK_REALM",
  "KEYCLOAK_WEB_CLIENT_ID",
  "KEYCLOAK_WEB_CLIENT_SECRET",
] as const;

const MINIMUM_SECRET_LENGTH = 32;
const POST_LOGOUT_PATH = "/login";

export interface AuthConfig {
  readonly appUrl: string;
  readonly secret: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly logoutEndpoint: string;
  readonly postLogoutRedirectUri: string;
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

/**
 * Human-login configuration. It deliberately reads only the `management-web`
 * client credentials and never the `management-service` Admin API ones.
 */
export function loadAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const missing = REQUIRED_ENVIRONMENT_VARIABLES.filter((name) => {
    const value = environment[name];

    return value === undefined || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new AuthConfigurationError(
      `Missing required environment variable(s): ${missing.join(", ")}.`,
    );
  }

  const secret = environment.NEXTAUTH_SECRET as string;

  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new AuthConfigurationError(
      `NEXTAUTH_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters.`,
    );
  }

  const appOrigin = parseOrigin(environment.NEXTAUTH_URL as string, "NEXTAUTH_URL");

  const keycloakBase = parseOrigin(
    environment.KEYCLOAK_URL as string,
    "KEYCLOAK_URL",
  );

  const realm = (environment.KEYCLOAK_REALM as string).trim();
  const issuer = `${keycloakBase}/realms/${encodeURIComponent(realm)}`;

  return {
    appUrl: appOrigin,
    secret,
    issuer,
    clientId: (environment.KEYCLOAK_WEB_CLIENT_ID as string).trim(),
    clientSecret: environment.KEYCLOAK_WEB_CLIENT_SECRET as string,
    logoutEndpoint: `${issuer}/protocol/openid-connect/logout`,
    postLogoutRedirectUri: `${appOrigin}${POST_LOGOUT_PATH}`,
  };
}

function parseOrigin(value: string, name: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new AuthConfigurationError(`${name} must be a valid HTTP or HTTPS URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AuthConfigurationError(
      `${name} must use the HTTP or HTTPS protocol.`,
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new AuthConfigurationError(`${name} must not contain credentials.`);
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new AuthConfigurationError(
      `${name} must not contain a query string or fragment.`,
    );
  }

  if (url.pathname !== "/") {
    throw new AuthConfigurationError(`${name} must not contain a path.`);
  }

  return url.origin;
}
