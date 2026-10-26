import assert from "node:assert/strict";
import test from "node:test";

import {
  KeycloakAccessRepository,
  KeycloakAccessResolutionError,
} from "../../modules/access/infrastructure/keycloak-access.repository.ts";

test("Keycloak access resolves the enabled user and direct management-web roles", async () => {
  const calls = [];
  const client = {
    clients: {
      async find(query) {
        calls.push(["client", query]);

        return [{ id: "web-uuid", clientId: "management-web" }];
      },
    },
    users: {
      async findOne(query) {
        calls.push(["user", query]);

        return { id: query.id, enabled: true };
      },
      async listClientRoleMappings(query) {
        calls.push(["roles", query]);

        return [{ name: "admin" }];
      },
    },
  };

  const result = await new KeycloakAccessRepository(
    client,
    "configured-realm",
    "management-web",
  ).resolveBySubject("trusted-subject");

  assert.deepEqual(result, {
    subject: "trusted-subject",
    enabled: true,
    directClientRoles: ["admin"],
  });
  assert.deepEqual(calls, [
    ["user", { id: "trusted-subject", realm: "configured-realm" }],
    [
      "client",
      {
        clientId: "management-web",
        first: 0,
        max: 2,
        realm: "configured-realm",
      },
    ],
    [
      "roles",
      {
        id: "trusted-subject",
        clientUniqueId: "web-uuid",
        realm: "configured-realm",
      },
    ],
  ]);
});

test("a deleted Keycloak user resolves to no access", async () => {
  const repository = new KeycloakAccessRepository(
    {
      clients: {
        async find() {
          assert.fail("Clients must not be read for a deleted user.");
        },
      },
      users: {
        async findOne() {
          return undefined;
        },
        async listClientRoleMappings() {
          assert.fail("Roles must not be read for a deleted user.");
        },
      },
    },
    "configured-realm",
    "management-web",
  );

  assert.equal(await repository.resolveBySubject("deleted"), null);
});

test("a disabled Keycloak user denies access without reading roles", async () => {
  const repository = new KeycloakAccessRepository(
    {
      clients: {
        async find() {
          assert.fail("Clients must not be read for a disabled user.");
        },
      },
      users: {
        async findOne() {
          return { enabled: false };
        },
        async listClientRoleMappings() {
          assert.fail("Roles must not be read for a disabled user.");
        },
      },
    },
    "configured-realm",
    "management-web",
  );

  assert.deepEqual(await repository.resolveBySubject("disabled"), {
    subject: "disabled",
    enabled: false,
    directClientRoles: [],
  });
});

test("other clients and realm roles are never queried or accepted", async () => {
  const client = {
    clients: {
      async find() {
        return [
          { id: "other-uuid", clientId: "other-client" },
          { id: "web-uuid", clientId: "management-web" },
        ];
      },
    },
    users: {
      async findOne() {
        return { enabled: true };
      },
      async listClientRoleMappings(query) {
        assert.equal(query.clientUniqueId, "web-uuid");

        return [{ name: "user" }];
      },
      async listRealmRoleMappings() {
        assert.fail("Realm roles must never be queried.");
      },
      async listRoleMappings() {
        assert.fail(
          "Combined mappings from other clients must never be queried.",
        );
      },
    },
  };

  const result = await new KeycloakAccessRepository(
    client,
    "configured-realm",
    "management-web",
  ).resolveBySubject("subject");

  assert.deepEqual(result?.directClientRoles, ["user"]);
});

test("a missing, duplicate, or malformed management client fails closed", async () => {
  for (const clients of [
    [],
    [
      { id: "one", clientId: "management-web" },
      { id: "two", clientId: "management-web" },
    ],
    [{ clientId: "management-web" }],
  ]) {
    const repository = new KeycloakAccessRepository(
      {
        clients: {
          async find() {
            return clients;
          },
        },
        users: {
          async findOne() {
            return { enabled: true };
          },
          async listClientRoleMappings() {
            return [];
          },
        },
      },
      "realm",
      "management-web",
    );

    await assert.rejects(
      () => repository.resolveBySubject("subject"),
      KeycloakAccessResolutionError,
    );
  }
});

test("a malformed direct role fails closed without exposing its value", async () => {
  const repository = new KeycloakAccessRepository(
    {
      clients: {
        async find() {
          return [{ id: "web-uuid", clientId: "management-web" }];
        },
      },
      users: {
        async findOne() {
          return { enabled: true };
        },
        async listClientRoleMappings() {
          return [{ name: undefined }];
        },
      },
    },
    "realm",
    "management-web",
  );

  await assert.rejects(
    () => repository.resolveBySubject("sensitive-subject"),
    error => {
      assert.ok(error instanceof KeycloakAccessResolutionError);
      assert.doesNotMatch(error.message, /sensitive-subject/);

      return true;
    },
  );
});
