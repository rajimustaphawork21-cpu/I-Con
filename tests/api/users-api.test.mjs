import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizePermissionUseCase } from "../../modules/access/application/authorize-permission.usecase.ts";
import { CountUsersForSubjectUseCase } from "../../modules/users/application/count-users-for-subject.usecase.ts";
import { CountUsersUseCase } from "../../modules/users/application/count-users.usecase.ts";
import { ListUsersForSubjectUseCase } from "../../modules/users/application/list-users-for-subject.usecase.ts";
import { ListUsersUseCase } from "../../modules/users/application/list-users.usecase.ts";
import {
  handleCountUsersRequest,
  handleListUsersRequest,
} from "../../src/app/api/users/users-api.ts";

function createDependencies({
  subject = "subject",
  roles = ["admin"],
  enabled = true,
  access = "present",
  accessError,
  users = [{ id: "id", username: "test.user", enabled: true }],
  count = 1,
  usersError,
} = {}) {
  const calls = { create: 0, list: 0, count: 0 };

  return {
    calls,
    dependencies: {
      async getSubject() {
        return subject;
      },
      async createUseCases() {
        calls.create += 1;

        const authorize = new AuthorizePermissionUseCase({
          async resolveBySubject(resolvedSubject) {
            if (accessError) throw accessError;
            if (access === "missing") return null;

            return {
              subject: resolvedSubject,
              enabled,
              directClientRoles: roles,
            };
          },
        });
        const repository = {
          async list() {
            calls.list += 1;
            if (usersError) throw usersError;

            return users;
          },
          async count() {
            calls.count += 1;
            if (usersError) throw usersError;

            return count;
          },
        };

        return {
          list: new ListUsersForSubjectUseCase(
            authorize,
            new ListUsersUseCase(repository),
          ),
          count: new CountUsersForSubjectUseCase(
            authorize,
            new CountUsersUseCase(repository),
          ),
        };
      },
    },
  };
}

for (const label of ["no session", "expired session"]) {
  test(`${label} returns JSON 401 before composition`, async () => {
    let createCalls = 0;
    const response = await handleListUsersRequest(
      { url: "http://localhost/api/users" },
      {
        async getSubject() {
          return null;
        },
        async createUseCases() {
          createCalls += 1;
          throw new Error("must not run");
        },
      },
    );

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: {
        code: "unauthenticated",
        message: "Authentication is required.",
      },
    });
    assert.equal(createCalls, 0);
  });
}

for (const endpoint of ["list", "count"]) {
  test(`test.ali receives 403 for Users ${endpoint}`, async () => {
    const { dependencies, calls } = createDependencies({
      subject: "test.ali-subject",
      roles: ["user"],
    });

    const response =
      endpoint === "list"
        ? await handleListUsersRequest(
            { url: "http://localhost/api/users" },
            dependencies,
          )
        : await handleCountUsersRequest(
            { url: "http://localhost/api/users/count" },
            dependencies,
          );

    assert.equal(response.status, 403);
    assert.equal(calls.list, 0);
    assert.equal(calls.count, 0);
  });
}

for (const identity of [
  { name: "test.sara", role: "admin" },
  { name: "test.youssef", role: "super-admin" },
]) {
  test(`${identity.name} receives 200 for Users List and Count`, async () => {
    const listSetup = createDependencies({
      subject: `${identity.name}-subject`,
      roles: [identity.role],
    });
    const countSetup = createDependencies({
      subject: `${identity.name}-subject`,
      roles: [identity.role],
    });

    const listResponse = await handleListUsersRequest(
      { url: "http://localhost/api/users?first=0&max=10" },
      listSetup.dependencies,
    );
    const countResponse = await handleCountUsersRequest(
      { url: "http://localhost/api/users/count" },
      countSetup.dependencies,
    );

    assert.equal(listResponse.status, 200);
    assert.equal(countResponse.status, 200);
    assert.equal(listSetup.calls.list, 1);
    assert.equal(countSetup.calls.count, 1);
  });
}

for (const scenario of [
  { name: "unknown role", options: { roles: ["auditor"] } },
  { name: "missing roles", options: { roles: [] } },
  { name: "disabled user", options: { enabled: false, roles: ["admin"] } },
  { name: "deleted user", options: { access: "missing", roles: ["admin"] } },
]) {
  test(`${scenario.name} receives 403 and never invokes Users`, async () => {
    const { dependencies, calls } = createDependencies(scenario.options);
    const response = await handleListUsersRequest(
      { url: "http://localhost/api/users" },
      dependencies,
    );

    assert.equal(response.status, 403);
    assert.equal(calls.list, 0);
  });
}

test("role-resolution failure returns a safe 503 and never invokes Users", async () => {
  const secretText = "raw upstream details";
  const { dependencies, calls } = createDependencies({
    accessError: new Error(secretText),
  });
  const response = await handleListUsersRequest(
    { url: "http://localhost/api/users" },
    dependencies,
  );
  const body = JSON.stringify(await response.json());

  assert.equal(response.status, 503);
  assert.equal(calls.list, 0);
  assert.doesNotMatch(body, new RegExp(secretText));
});

test("Users upstream outage returns a safe 503", async () => {
  const secretText = "raw SDK failure and token";
  const { dependencies } = createDependencies({
    usersError: new Error(secretText),
  });
  const response = await handleCountUsersRequest(
    { url: "http://localhost/api/users/count" },
    dependencies,
  );
  const body = JSON.stringify(await response.json());

  assert.equal(response.status, 503);
  assert.doesNotMatch(body, new RegExp(secretText));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

for (const url of [
  "http://localhost/api/users?first=-1",
  "http://localhost/api/users?first=0.5",
  "http://localhost/api/users?first=2147483648",
  "http://localhost/api/users?max=0",
  "http://localhost/api/users?max=101",
  "http://localhost/api/users?search=x&search=y",
  "http://localhost/api/users?unexpected=value",
  `http://localhost/api/users?search=${"x".repeat(257)}`,
]) {
  test(`invalid List query returns 400 without reading Users: ${url.slice(27, 70)}`, async () => {
    const { dependencies, calls } = createDependencies();
    const response = await handleListUsersRequest({ url }, dependencies);

    assert.equal(response.status, 400);
    assert.equal(calls.list, 0);
  });
}

test("search and pagination boundaries are normalized before Users List", async () => {
  let receivedQuery;
  const response = await handleListUsersRequest(
    {
      url: "http://localhost/api/users?first=2147483647&max=100&search=%20term%20",
    },
    {
      async getSubject() {
        return "subject";
      },
      async createUseCases() {
        return {
          list: {
            async execute(_subject, query) {
              receivedQuery = query;

              return [];
            },
          },
          count: {
            async execute() {
              return 0;
            },
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(receivedQuery, {
    first: 2_147_483_647,
    max: 100,
    search: " term ",
  });
});

test("filtered Count receives the normalized search", async () => {
  let receivedQuery;
  const response = await handleCountUsersRequest(
    { url: "http://localhost/api/users/count?search=%20ali%20" },
    {
      async getSubject() {
        return "subject";
      },
      async createUseCases() {
        return {
          list: {
            async execute() {
              return [];
            },
          },
          count: {
            async execute(_subject, query) {
              receivedQuery = query;

              return 2;
            },
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(receivedQuery, { search: " ali " });
  assert.deepEqual(await response.json(), { count: 2 });
});

test("API response DTO allowlist removes roles, tokens, and unknown fields", async () => {
  const response = await handleListUsersRequest(
    { url: "http://localhost/api/users" },
    {
      async getSubject() {
        return "subject";
      },
      async createUseCases() {
        return {
          list: {
            async execute() {
              return [
                {
                  id: "id",
                  username: "user",
                  enabled: true,
                  email: "safe@example.test",
                  roles: ["admin"],
                  accessToken: "secret-token",
                  credentials: ["secret"],
                },
              ];
            },
          },
          count: {
            async execute() {
              return 1;
            },
          },
        };
      },
    },
  );
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.deepEqual(body.users, [
    {
      id: "id",
      username: "user",
      enabled: true,
      email: "safe@example.test",
    },
  ]);
  assert.doesNotMatch(serialized, /secret|accessToken|roles|credentials/);
});
