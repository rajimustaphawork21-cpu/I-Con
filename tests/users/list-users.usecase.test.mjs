import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidListUsersQueryError,
  ListUsersUseCase,
} from "../../modules/users/application/list-users.usecase.ts";

test("ListUsersUseCase validates, normalizes, and delegates the query", async () => {
  let receivedQuery;

  const expectedUsers = [
    { id: "user-id", username: "username", enabled: true },
  ];

  const repository = {
    async list(query) {
      receivedQuery = query;

      return expectedUsers;
    },
  };

  const result = await new ListUsersUseCase(repository).execute({
    first: 5,
    max: 10,
    search: "  search term  ",
  });

  assert.deepEqual(receivedQuery, {
    first: 5,
    max: 10,
    search: "search term",
  });
  assert.equal(result, expectedUsers);
});

test("ListUsersUseCase removes an empty search value", async () => {
  let receivedQuery;

  const repository = {
    async list(query) {
      receivedQuery = query;

      return [];
    },
  };

  await new ListUsersUseCase(repository).execute({
    first: 0,
    max: 10,
    search: "   ",
  });

  assert.deepEqual(receivedQuery, { first: 0, max: 10 });
});

for (const query of [
  { first: -1, max: 10 },
  { first: 0.5, max: 10 },
  { first: 2_147_483_648, max: 10 },
  { first: Number.MAX_SAFE_INTEGER + 1, max: 10 },
  { first: 0, max: 0 },
  { first: 0, max: 101 },
  { first: 0, max: 1.5 },
]) {
  test(`ListUsersUseCase rejects invalid pagination ${JSON.stringify(query)}`, async () => {
    const useCase = new ListUsersUseCase({
      async list() {
        assert.fail("The repository must not be called for invalid input.");
      },
    });

    await assert.rejects(
      () => useCase.execute(query),
      InvalidListUsersQueryError,
    );
  });
}

test("ListUsersUseCase rejects an overlong search value", async () => {
  const useCase = new ListUsersUseCase({
    async list() {
      assert.fail("The repository must not be called for invalid input.");
    },
  });

  await assert.rejects(
    () =>
      useCase.execute({ first: 0, max: 10, search: "x".repeat(257) }),
    InvalidListUsersQueryError,
  );
});
