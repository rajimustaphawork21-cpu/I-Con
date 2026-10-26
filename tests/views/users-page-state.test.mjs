import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_USERS_PAGE_STATE,
  resolveUsersPageState,
} from "../../src/views/users/users-page-state.ts";

test("Users page begins in the loading state", () => {
  assert.deepEqual(INITIAL_USERS_PAGE_STATE, { kind: "loading" });
});

test("Users page resolves the forbidden state from either endpoint", () => {
  assert.deepEqual(resolveUsersPageState(403, {}, 200, { count: 0 }), {
    kind: "forbidden",
  });
  assert.deepEqual(resolveUsersPageState(200, { users: [] }, 403, {}), {
    kind: "forbidden",
  });
});

test("Users page resolves an empty state", () => {
  assert.deepEqual(
    resolveUsersPageState(200, { users: [] }, 200, { count: 0 }),
    { kind: "empty", count: 0 },
  );
});

test("Users page resolves retryable errors without rendering upstream data", () => {
  for (const result of [
    resolveUsersPageState(503, { error: "raw" }, 200, { count: 0 }),
    resolveUsersPageState(200, { users: "invalid" }, 200, { count: 0 }),
    resolveUsersPageState(200, { users: [] }, 200, { count: -1 }),
  ]) {
    assert.deepEqual(result, { kind: "error" });
  }
});

test("Users page recognizes session expiry for login navigation", () => {
  assert.deepEqual(resolveUsersPageState(401, {}, 401, {}), {
    kind: "unauthenticated",
  });
});

test("Users page accepts a populated safe response", () => {
  assert.deepEqual(
    resolveUsersPageState(
      200,
      {
        users: [
          {
            id: "id",
            username: "test.sara",
            enabled: true,
            email: "sara@example.test",
          },
        ],
      },
      200,
      { count: 1 },
    ),
    {
      kind: "ready",
      users: [
        {
          id: "id",
          username: "test.sara",
          enabled: true,
          email: "sara@example.test",
        },
      ],
      count: 1,
    },
  );
});
