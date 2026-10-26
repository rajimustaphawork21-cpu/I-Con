import assert from "node:assert/strict";
import test from "node:test";

import {
  KeycloakUserCountError,
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
    error => {
      assert.ok(error instanceof KeycloakUserMappingError);
      assert.doesNotMatch(error.message, new RegExp(sensitiveValue));

      return true;
    },
  );
});

test("KeycloakUserRepository counts users in the configured Realm", async () => {
  let receivedQuery;

  const client = {
    users: {
      async count(query) {
        receivedQuery = query;

        return 3;
      },
    },
  };

  const result = await new KeycloakUserRepository(
    client,
    "configured-realm",
  ).count({});

  assert.deepEqual(receivedQuery, { realm: "configured-realm" });
  assert.equal(result, 3);
});

for (const [description, invalidCount] of [
  ["negative", -1],
  ["fractional", 1.5],
  ["NaN", Number.NaN],
  ["non-finite", Number.POSITIVE_INFINITY],
  ["out-of-range integer", Number.MAX_SAFE_INTEGER + 1],
  ["numeric string", "3"],
]) {
  test(`KeycloakUserRepository rejects ${description} count`, async () => {
    const client = {
      users: {
        async count() {
          return invalidCount;
        },
      },
    };

    await assert.rejects(
      () => new KeycloakUserRepository(client, "configured-realm").count({}),
      error => {
        assert.ok(error instanceof KeycloakUserCountError);
        assert.equal(
          error.message,
          "Keycloak returned an invalid Users count.",
        );
        assert.doesNotMatch(
          error.message,
          new RegExp(escapeRegExp(String(invalidCount))),
        );

        return true;
      },
    );
  });
}

test("KeycloakUserRepository propagates count infrastructure errors", async () => {
  const infrastructureError = new Error("infrastructure failure");

  const client = {
    users: {
      async count() {
        throw infrastructureError;
      },
    },
  };

  await assert.rejects(
    () => new KeycloakUserRepository(client, "configured-realm").count({}),
    error => {
      assert.equal(error, infrastructureError);

      return true;
    },
  );
});

test("KeycloakUserRepository passes search to filtered Count", async () => {
  let receivedQuery;
  const client = {
    users: {
      async count(query) {
        receivedQuery = query;

        return 2;
      },
    },
  };

  const result = await new KeycloakUserRepository(
    client,
    "configured-realm",
  ).count({ search: "test" });

  assert.equal(result, 2);
  assert.deepEqual(receivedQuery, {
    search: "test",
    realm: "configured-realm",
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
