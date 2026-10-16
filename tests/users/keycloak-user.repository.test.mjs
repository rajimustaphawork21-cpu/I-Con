import assert from "node:assert/strict";
import test from "node:test";

import {
  KeycloakUserMappingError,
  KeycloakUserRepository,
} from "../../modules/users/infrastructure/keycloak-user.repository.ts";

test("KeycloakUserRepository performs a scoped read and maps users", async () => {
  let receivedQuery;
  const client = {
    users: {
      async find(query) {
        receivedQuery = query;
        return [
          {
            id: "user-id",
            username: "username",
            enabled: false,
            email: "user@example.test",
            firstName: "not-mapped",
          },
        ];
      },
    },
  };

  const repository = new KeycloakUserRepository(client, "configured-realm");
  const result = await repository.list({ first: 10, max: 5, search: "term" });

  assert.deepEqual(receivedQuery, {
    first: 10,
    max: 5,
    search: "term",
    realm: "configured-realm",
  });
  assert.deepEqual(result, [
    {
      id: "user-id",
      username: "username",
      enabled: false,
      email: "user@example.test",
    },
  ]);
});

test("KeycloakUserRepository omits an undefined search value", async () => {
  let receivedQuery;
  const client = {
    users: {
      async find(query) {
        receivedQuery = query;
        return [];
      },
    },
  };

  await new KeycloakUserRepository(client, "configured-realm").list({
    first: 0,
    max: 10,
  });

  assert.deepEqual(receivedQuery, {
    first: 0,
    max: 10,
    realm: "configured-realm",
  });
});

test("KeycloakUserRepository rejects malformed records without exposing their data", async () => {
  const sensitiveValue = "personally-identifying-value";
  const client = {
    users: {
      async find() {
        return [{ username: sensitiveValue, enabled: true }];
      },
    },
  };

  await assert.rejects(
    () =>
      new KeycloakUserRepository(client, "configured-realm").list({
        first: 0,
        max: 10,
      }),
    (error) => {
      assert.ok(error instanceof KeycloakUserMappingError);
      assert.doesNotMatch(error.message, new RegExp(sensitiveValue));
      return true;
    },
  );
});
