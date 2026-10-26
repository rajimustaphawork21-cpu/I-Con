import assert from "node:assert/strict";
import test from "node:test";

import {
  AccessDeniedError,
  AuthorizePermissionUseCase,
} from "../../modules/access/application/authorize-permission.usecase.ts";
import { USERS_PERMISSIONS } from "../../modules/access/domain/permission-policy.ts";

test("an enabled subject with a direct admin role is authorized", async () => {
  const authorize = new AuthorizePermissionUseCase({
    async resolveBySubject(subject) {
      return { subject, enabled: true, directClientRoles: ["admin"] };
    },
  });

  await assert.doesNotReject(() =>
    authorize.execute("test.sara-subject", USERS_PERMISSIONS.list),
  );
});

for (const scenario of [
  {
    name: "deleted subject",
    access: null,
  },
  {
    name: "disabled subject",
    access: {
      subject: "subject",
      enabled: false,
      directClientRoles: ["super-admin"],
    },
  },
  {
    name: "missing roles",
    access: { subject: "subject", enabled: true, directClientRoles: [] },
  },
  {
    name: "unknown role",
    access: {
      subject: "subject",
      enabled: true,
      directClientRoles: ["auditor"],
    },
  },
]) {
  test(`${scenario.name} is denied`, async () => {
    const authorize = new AuthorizePermissionUseCase({
      async resolveBySubject() {
        return scenario.access;
      },
    });

    await assert.rejects(
      () => authorize.execute("subject", USERS_PERMISSIONS.list),
      AccessDeniedError,
    );
  });
}

test("a mismatched resolved subject is denied", async () => {
  const authorize = new AuthorizePermissionUseCase({
    async resolveBySubject() {
      return {
        subject: "different-subject",
        enabled: true,
        directClientRoles: ["admin"],
      };
    },
  });

  await assert.rejects(
    () => authorize.execute("subject", USERS_PERMISSIONS.count),
    AccessDeniedError,
  );
});

test("role-resolution failures fail closed and remain failures", async () => {
  const upstreamError = new Error("upstream unavailable");
  const authorize = new AuthorizePermissionUseCase({
    async resolveBySubject() {
      throw upstreamError;
    },
  });

  await assert.rejects(
    () => authorize.execute("subject", USERS_PERMISSIONS.count),
    error => {
      assert.equal(error, upstreamError);

      return true;
    },
  );
});
