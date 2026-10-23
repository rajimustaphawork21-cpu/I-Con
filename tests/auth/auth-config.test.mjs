import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthConfigurationError,
  loadAuthConfig,
} from "../../modules/auth/infrastructure/auth-config.ts";

const VALID_ENVIRONMENT = {
  NEXTAUTH_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "s".repeat(40),
  KEYCLOAK_URL: "http://localhost:8080/",
  KEYCLOAK_REALM: "company-dev",
  KEYCLOAK_WEB_CLIENT_ID: "management-web",
  KEYCLOAK_WEB_CLIENT_SECRET: "web-secret",
  KEYCLOAK_ADMIN_CLIENT_ID: "management-service",
  KEYCLOAK_ADMIN_CLIENT_SECRET: "service-secret",
};

test("loadAuthConfig builds issuer, logout and post-logout URLs", () => {
  const config = loadAuthConfig(VALID_ENVIRONMENT);

  assert.equal(config.appUrl, "http://localhost:3000");
  assert.equal(config.issuer, "http://localhost:8080/realms/company-dev");
  assert.equal(
    config.logoutEndpoint,
    "http://localhost:8080/realms/company-dev/protocol/openid-connect/logout",
  );
  assert.equal(config.postLogoutRedirectUri, "http://localhost:3000/login");
});

test("loadAuthConfig uses only the management-web client credentials", () => {
  const config = loadAuthConfig(VALID_ENVIRONMENT);

  assert.equal(config.clientId, "management-web");
  assert.equal(config.clientSecret, "web-secret");
  assert.equal(JSON.stringify(config).includes("service-secret"), false);
  assert.equal(JSON.stringify(config).includes("management-service"), false);
});

test("loadAuthConfig keeps the Realm configurable and URL-encodes it", () => {
  const config = loadAuthConfig({
    ...VALID_ENVIRONMENT,
    KEYCLOAK_REALM: "other realm",
  });

  assert.equal(config.issuer, "http://localhost:8080/realms/other%20realm");
});

test("loadAuthConfig reports missing variable names without values", () => {
  assert.throws(
    () => loadAuthConfig({ ...VALID_ENVIRONMENT, NEXTAUTH_SECRET: "" }),
    (error) =>
      error instanceof AuthConfigurationError &&
      error.message.includes("NEXTAUTH_SECRET") &&
      !error.message.includes("web-secret"),
  );
});

test("loadAuthConfig rejects a short NEXTAUTH_SECRET", () => {
  assert.throws(
    () => loadAuthConfig({ ...VALID_ENVIRONMENT, NEXTAUTH_SECRET: "short" }),
    AuthConfigurationError,
  );
});

test("loadAuthConfig rejects unsafe URLs", () => {
  for (const NEXTAUTH_URL of [
    "ftp://localhost:3000",
    "not a url",
    "http://user:pass@localhost:3000",
    "http://localhost:3000/app",
    "http://localhost:3000/?a=1",
  ]) {
    assert.throws(
      () => loadAuthConfig({ ...VALID_ENVIRONMENT, NEXTAUTH_URL }),
      AuthConfigurationError,
      NEXTAUTH_URL,
    );
  }
});
