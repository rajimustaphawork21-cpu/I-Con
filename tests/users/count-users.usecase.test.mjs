import assert from "node:assert/strict";
import test from "node:test";

import {
  CountUsersUseCase,
  InvalidCountUsersQueryError,
} from "../../modules/users/application/count-users.usecase.ts";

test("CountUsersUseCase delegates to the repository and returns the count", async () => {
  let callCount = 0;

  const repository = {
    async count(query) {
      callCount += 1;
      assert.deepEqual(query, {});

      return 3;
    },
  };

  const result = await new CountUsersUseCase(repository).execute();

  assert.equal(result, 3);
  assert.equal(callCount, 1);
});

test("CountUsersUseCase normalizes filtered count search", async () => {
  let receivedQuery;
  const useCase = new CountUsersUseCase({
    async count(query) {
      receivedQuery = query;

      return 2;
    },
  });

  assert.equal(await useCase.execute({ search: "  test  " }), 2);
  assert.deepEqual(receivedQuery, { search: "test" });
});

test("CountUsersUseCase removes blank search", async () => {
  let receivedQuery;
  const useCase = new CountUsersUseCase({
    async count(query) {
      receivedQuery = query;

      return 0;
    },
  });

  await useCase.execute({ search: "   " });
  assert.deepEqual(receivedQuery, {});
});

test("CountUsersUseCase rejects an overlong search without calling Count", async () => {
  const useCase = new CountUsersUseCase({
    async count() {
      assert.fail("Count must not be called for invalid input.");
    },
  });

  await assert.rejects(
    () => useCase.execute({ search: "x".repeat(257) }),
    InvalidCountUsersQueryError,
  );
});

test("CountUsersUseCase propagates repository errors", async () => {
  const repositoryError = new Error("repository unavailable");

  const useCase = new CountUsersUseCase({
    async count() {
      throw repositoryError;
    },
  });

  await assert.rejects(
    () => useCase.execute(),
    error => {
      assert.equal(error, repositoryError);

      return true;
    },
  );
});
