import assert from "node:assert/strict";
import test from "node:test";

import { CountUsersUseCase } from "../../modules/users/application/count-users.usecase.ts";

test("CountUsersUseCase delegates to the repository and returns the count", async () => {
  let callCount = 0;

  const repository = {
    async count() {
      callCount += 1;

      return 3;
    },
  };

  const result = await new CountUsersUseCase(repository).execute();

  assert.equal(result, 3);
  assert.equal(callCount, 1);
});

test("CountUsersUseCase propagates repository errors", async () => {
  const repositoryError = new Error("repository unavailable");

  const useCase = new CountUsersUseCase({
    async count() {
      throw repositoryError;
    },
  });

  await assert.rejects(() => useCase.execute(), (error) => {
    assert.equal(error, repositoryError);

    return true;
  });
});
