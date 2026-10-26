import assert from "node:assert/strict";
import test from "node:test";

import {
  hasUsersPermission,
  USERS_PERMISSIONS,
} from "../../modules/access/domain/permission-policy.ts";

const matrix = [
  ["user", false],
  ["admin", true],
  ["super-admin", true],
];

for (const [role, expected] of matrix) {
  for (const permission of Object.values(USERS_PERMISSIONS)) {
    test(`${role} ${expected ? "may" : "may not"} use ${permission}`, () => {
      assert.equal(hasUsersPermission([role], permission), expected);
    });
  }
}

test("unknown, missing, realm-shaped, and other-client roles deny by default", () => {
  assert.equal(hasUsersPermission([], USERS_PERMISSIONS.list), false);
  assert.equal(hasUsersPermission(undefined, USERS_PERMISSIONS.list), false);
  assert.equal(
    hasUsersPermission(["realm-admin"], USERS_PERMISSIONS.list),
    false,
  );
  assert.equal(
    hasUsersPermission(["other-client:admin"], USERS_PERMISSIONS.list),
    false,
  );
  assert.equal(hasUsersPermission(["ADMIN"], USERS_PERMISSIONS.list), false);
});
