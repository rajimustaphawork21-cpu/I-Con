import assert from "node:assert/strict";
import test from "node:test";

import {
  KeycloakAdminConfigurationError,
  loadKeycloakAdminConfig,
  loadKeycloakConnectionConfig,
} from "../../lib/infrastructure/keycloak-admin.client.ts";

test("loadKeycloakConnectionConfig normalizes a valid endpoint", () => {
  assert.deepEqual(
    loadKeycloakConnectionConfig({
      KEYCLOAK_URL: "http://localhost:8080/",
      KEYCLOAK_REALM: " configured-realm ",
    }),
    {
      baseUrl: "http://localhost:8080",
      realmName: "configured-realm",
    },
  );
});

test("loadKeycloakAdminConfig reports missing names without values", () => {
  const secretValue = "must-not-appear";

  assert.throws(
    () =>
      loadKeycloakAdminConfig({
        KEYCLOAK_URL: "http://localhost:8080",
        KEYCLOAK_REALM: "configured-realm",
        KEYCLOAK_ADMIN_CLIENT_ID: secretValue,
      }),
    (error) => {
      assert.ok(error instanceof KeycloakAdminConfigurationError);
      assert.match(error.message, /KEYCLOAK_ADMIN_CLIENT_SECRET/);
      assert.doesNotMatch(error.message, new RegExp(secretValue));

      return true;
    },
  );
});

test("loadKeycloakAdminConfig preserves the client secret exactly", () => {
  const clientSecret = "  exact-client-secret  ";

  const config = loadKeycloakAdminConfig({
    KEYCLOAK_URL: "http://localhost:8080",
    KEYCLOAK_REALM: "configured-realm",
    KEYCLOAK_ADMIN_CLIENT_ID: " management-service ",
    KEYCLOAK_ADMIN_CLIENT_SECRET: clientSecret,
  });

  assert.equal(config.clientId, "management-service");
  assert.equal(config.clientSecret, clientSecret);
});

test("loadKeycloakConnectionConfig rejects an invalid URL without echoing it", () => {
  const invalidValue = "sensitive-invalid-value";

  assert.throws(
    () =>
      loadKeycloakConnectionConfig({
        KEYCLOAK_URL: invalidValue,
        KEYCLOAK_REALM: "configured-realm",
      }),
    (error) => {
      assert.ok(error instanceof KeycloakAdminConfigurationError);
      assert.doesNotMatch(error.message, new RegExp(invalidValue));

      return true;
    },
  );
});

test("loadKeycloakConnectionConfig rejects embedded URL credentials", () => {
  assert.throws(
    () =>
      loadKeycloakConnectionConfig({
        KEYCLOAK_URL: "http://username:password@localhost:8080",
        KEYCLOAK_REALM: "configured-realm",
      }),
    KeycloakAdminConfigurationError,
  );
});
