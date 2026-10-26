import assert from "node:assert/strict";
import test from "node:test";

import {
  AccessDeniedError,
  AuthorizePermissionUseCase,
} from "../../modules/access/application/authorize-permission.usecase.ts";
import { CountUsersForSubjectUseCase } from "../../modules/users/application/count-users-for-subject.usecase.ts";
import { CountUsersUseCase } from "../../modules/users/application/count-users.usecase.ts";
import { ListUsersForSubjectUseCase } from "../../modules/users/application/list-users-for-subject.usecase.ts";
import { ListUsersUseCase } from "../../modules/users/application/list-users.usecase.ts";

test("denied authorization never invokes Users List or Count", async () => {
  const authorize = new AuthorizePermissionUseCase({
    async resolveBySubject(subject) {
      return { subject, enabled: true, directClientRoles: ["user"] };
    },
  });
  const repository = {
    async list() {
      assert.fail("List must not run after an authorization denial.");
    },
    async count() {
      assert.fail("Count must not run after an authorization denial.");
    },
  };

  const list = new ListUsersForSubjectUseCase(
    authorize,
    new ListUsersUseCase(repository),
  );
  const count = new CountUsersForSubjectUseCase(
    authorize,
    new CountUsersUseCase(repository),
  );

  await assert.rejects(
    () => list.execute("test.ali-subject", { first: 0, max: 10 }),
    AccessDeniedError,
  );
  await assert.rejects(
    () => count.execute("test.ali-subject", {}),
    AccessDeniedError,
  );
});

test("authorization resolution failure never invokes Users List or Count", async () => {
  const authorize = new AuthorizePermissionUseCase({
    async resolveBySubject() {
      throw new Error("Keycloak unavailable");
    },
  });
  const repository = {
    async list() {
      assert.fail("List must not run after an authorization failure.");
    },
    async count() {
      assert.fail("Count must not run after an authorization failure.");
    },
  };

  await assert.rejects(() =>
    new ListUsersForSubjectUseCase(
      authorize,
      new ListUsersUseCase(repository),
    ).execute("subject", { first: 0, max: 10 }),
  );
  await assert.rejects(() =>
    new CountUsersForSubjectUseCase(
      authorize,
      new CountUsersUseCase(repository),
    ).execute("subject", {}),
  );
});

test("an authorized subject reaches both existing Users use cases", async () => {
  const authorize = new AuthorizePermissionUseCase({
    async resolveBySubject(subject) {
      return { subject, enabled: true, directClientRoles: ["super-admin"] };
    },
  });
  const calls = [];
  const repository = {
    async list(query) {
      calls.push(["list", query]);

      return [];
    },
    async count(query) {
      calls.push(["count", query]);

      return 0;
    },
  };

  await new ListUsersForSubjectUseCase(
    authorize,
    new ListUsersUseCase(repository),
  ).execute("subject", { first: 2, max: 5, search: " test " });

  await new CountUsersForSubjectUseCase(
    authorize,
    new CountUsersUseCase(repository),
  ).execute("subject", { search: " test " });

  assert.deepEqual(calls, [
    ["list", { first: 2, max: 5, search: "test" }],
    ["count", { search: "test" }],
  ]);
});
