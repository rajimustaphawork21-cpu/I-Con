# Keycloak Management MVP — Read-Only Users Integration Report

**Status date:** 2026-10-16 (Africa/Casablanca)  
**Repository:** `~/Desktop/keycloak-management`  
**Authoritative project instructions:** `AGENTS.md`  
**Phase covered:** Local Keycloak verification and the smallest read-only Users DDD slice

## 1. Purpose of this report

This is a self-contained technical handoff for another AI or developer. It records:

- the repository state that was inspected;
- the Keycloak environment that was verified;
- the exact read-only Users slice that was implemented;
- architectural and security decisions;
- files created or changed;
- commands and test results;
- known limitations and blockers;
- the next recommended step.

Read `AGENTS.md` completely before changing the project. If this report conflicts with the current repository or `AGENTS.md`, treat the current files and runtime environment as authoritative and investigate the difference.

## 2. Executive summary

The first Keycloak integration phase is complete:

- The existing Docker container is running Keycloak `26.8.0` on `localhost:8080`.
- Public OpenID Connect discovery responds successfully.
- A read-only Admin API listing returned exactly one Realm at test time, `master`, and that Realm was enabled.
- No Realm name is hardcoded in application or integration source code. The Realm is always supplied through `KEYCLOAK_REALM`.
- A minimal Users bounded-context slice now follows Domain-Driven Design boundaries:
  - Domain user and repository contracts;
  - Application-level pagination/search validation;
  - Infrastructure adapter using the official Keycloak Admin Client;
  - Infrastructure client-credentials factory intended for server-only use;
  - Read-only integration harness;
  - Unit tests.
- The live integration test successfully requested the first page of Users and returned one record. It logged only the record count, not the user representation.
- No Keycloak user, role, group, client, Realm, or role mapping was created, updated, deleted, or otherwise modified.
- No client secret, password, access token, or real user record was printed or written to the repository.
- No UI, API route, login flow, authorization policy, or role-management feature was added.

Important qualification: the live test used a short-lived access token obtained from the existing local bootstrap administration configuration and held only in process memory. This proves connectivity and the complete read-only DDD query path, but it does **not** prove the reusable `client_credentials` service-account authentication path. No `.env.local` or service-account credentials are currently configured in the repository.

## 3. Product and architecture constraints that remain in force

The MVP is one configurable Keycloak Realm containing multiple Clients. It is not a multi-Realm account aggregator.

Mandatory constraints:

1. Never hardcode `realm-x`, `master`, or any other Realm as the application Realm.
2. Keycloak remains the source of truth for identities, Clients, and role mappings.
3. The official `@keycloak/keycloak-admin-client` is server-side infrastructure only.
4. Domain and Application code must not import Keycloak SDK types or implementations.
5. Human administrator authentication and backend service-account authentication are separate concerns.
6. Client Roles are scoped to individual Clients and are independent from platform administration roles.
7. Do not implement role mutations until authentication, server authorization, least-privilege service credentials, test data, and audit requirements are in place.
8. Preserve the existing Next.js and shadcn/ui dashboard rather than replacing it.

Current dependency direction:

```text
Integration composition root
  -> ListUsersUseCase (Application)
      -> UserRepository port (Domain)
          <- KeycloakUserRepository (Infrastructure)
              -> @keycloak/keycloak-admin-client 26.8.0
                  -> GET /admin/realms/{configuredRealm}/users
```

The infrastructure adapter's SDK-facing type exposes only `users.find`, which makes its read-only intent explicit at the TypeScript boundary.

## 4. Inspected repository state

### 4.1 Confirmed versions

| Component | Verified state |
|---|---|
| Next.js | `16.4.1` |
| React / React DOM | `19.3.0` |
| TypeScript | `5.9.3` |
| Node.js | `24.16.0` |
| npm | `11.13.0` |
| Keycloak Admin Client | `26.8.0` installed and lockfile-resolved |
| shadcn CLI | `4.21.5` |
| UI preset | Base UI / Nova (`base-nova`) |
| Keycloak Docker image | `quay.io/keycloak/keycloak:26.8.0` |

### 4.2 Existing application state

- The root-level App Router convention is still used: `app/`, `components/`, `hooks/`, and `lib/`.
- `/dashboard` remains the generated shadcn dashboard and still reads starter data from `app/dashboard/data.json`.
- No live Keycloak data was connected to a page or route.
- `app/page.tsx` remains the default starter page.
- `TooltipProvider` is still not mounted in `app/layout.tsx`.
- No login route, server session, protected API route, Users screen, Clients screen, or role-management screen exists.
- No `.env`, `.env.local`, or other `.env*` file exists in the repository root.
- `.gitignore` correctly ignores `.env*` files.

### 4.3 Existing dirty worktree

The worktree was already dirty before this phase. Existing tracked changes included:

- `AGENTS.md`;
- `app/globals.css`;
- `package.json`;
- `package-lock.json`.

Existing untracked shadcn-generated paths included:

- `app/dashboard/`;
- `components.json`;
- `components/`;
- `hooks/`;
- `lib/`.

Those existing changes were preserved. This phase added only the Users DDD slice, its test harness/tests, package scripts, and this report.

## 5. Keycloak environment findings

### 5.1 Container and endpoint

The existing container was inspected read-only:

```text
Container name: keycloak
Image:          quay.io/keycloak/keycloak:26.8.0
Mode:           start-dev
Port mapping:   0.0.0.0:8080 -> 8080/tcp
Status:         running
```

Public OIDC discovery for the administrative Realm responded successfully, confirming that the service was reachable at `http://localhost:8080`.

### 5.2 Realm discovery

A read-only Admin API Realm listing returned exactly one Realm at test time, and it was enabled:

```text
master
```

This is an observed runtime fact, not a decision to use `master` as the product's permanent Realm. The source code does not contain a runtime Realm constant. The test command passed the discovered name through `KEYCLOAK_REALM`.

Before later product work, explicitly decide whether to use an existing dedicated application Realm or create one through an authorized Keycloak-administration procedure. Do not silently assume `master` is the final MVP target.

### 5.3 Authentication used during verification

The local container exposes bootstrap administrator configuration. For the one-time smoke test:

1. the values were read without printing them;
2. a short-lived token was requested;
3. the Realm was discovered read-only;
4. the token and discovered Realm were passed to the integration process through transient environment variables;
5. the process called only the Users list endpoint;
6. no token, credential, or user representation was emitted.

The committed integration harness normally expects a dedicated service account through:

```dotenv
KEYCLOAK_URL=<server URL>
KEYCLOAK_REALM=<configured Realm>
KEYCLOAK_ADMIN_CLIENT_ID=<confidential management Client ID>
KEYCLOAK_ADMIN_CLIENT_SECRET=<local secret>
```

These are variable names only. No real values are stored in the repository.

## 6. Implemented DDD slice

### 6.1 Domain layer

`modules/users/domain/user.type.ts`

Defines the application User representation:

```ts
interface User {
  id: string;
  username: string;
  enabled: boolean;
  email?: string;
}
```

Only the fields needed by the first Users read path are mapped. Keycloak credentials, required actions, access structures, groups, roles, and other SDK fields are not exposed.

`modules/users/domain/user.repository.ts`

Defines:

- `ListUsersQuery` with `first`, `max`, and optional `search`;
- `UserRepository.list(...)` as the infrastructure-independent port.

This layer has no Keycloak SDK imports.

### 6.2 Application layer

`modules/users/application/list-users.usecase.ts`

`ListUsersUseCase` validates and normalizes input before delegating to `UserRepository`:

- `first` must be a safe integer from `0` through `2,147,483,647`;
- `max` must be an integer from `1` through `100`;
- optional search input is trimmed;
- an empty trimmed search is removed;
- search is limited to `256` characters;
- invalid requests fail before the repository is called.

Authorization is intentionally not fabricated in this phase. The future presentation/API layer must supply a validated caller, and the Application layer must enforce the finalized permission policy before this use case is exposed to a browser or ordinary user.

### 6.3 Infrastructure layer

`modules/users/infrastructure/keycloak-user.repository.ts`

`KeycloakUserRepository`:

- implements the Domain `UserRepository` port;
- accepts a narrow SDK reader exposing only `users.find`;
- always sends the configured Realm explicitly;
- sends only pagination and optional search values;
- maps Keycloak representations into Domain Users;
- requires nonempty `id` and `username` values;
- requires a boolean `enabled` value, including valid `false` values;
- maps `email` only when supplied;
- throws sanitized mapping errors that contain a record index and field name, never record contents.

The SDK's `users.find` implementation performs:

```text
GET /admin/realms/{realm}/users
```

No Keycloak create, update, delete, role-mapping, group, Client, or Realm mutation method is invoked or exposed by this repository adapter.

### 6.4 Keycloak client and configuration

`lib/infrastructure/keycloak-admin.client.ts`

The configuration loader:

- requires the four service-account variable names listed above;
- reports missing variable names without echoing values;
- trims the URL, Realm, and Client ID;
- preserves the Client secret exactly;
- permits only HTTP or HTTPS URLs;
- rejects query strings, fragments, and embedded URL credentials;
- removes one trailing URL slash.

`createKeycloakAdminClient(...)` uses the official SDK and OAuth2 `client_credentials`:

```ts
await client.auth({
  grantType: "client_credentials",
  clientId,
  clientSecret,
});
```

This reusable service-account authentication path is implemented but has not yet been exercised against a configured management Client.

The factory is currently imported only by the local integration composition script. Its server-only placement is an architectural requirement, not yet an enforced Next.js module boundary: the file does not currently import a `server-only` guard. When it is later wired into the application, keep it out of all Client Components and browser bundles and add an appropriate server-only boundary if compatible with the script runner.

### 6.5 Integration composition root

`scripts/test-keycloak.mjs`

The script composes the real path:

```text
validated environment
  -> authenticated Keycloak Admin Client
  -> KeycloakUserRepository
  -> ListUsersUseCase
  -> first page, maximum 10 users
```

It supports two authentication modes:

1. Normal reusable mode: `client_credentials` from the four configuration variables.
2. Local test-only mode: a short-lived token supplied through `KEYCLOAK_TEST_ACCESS_TOKEN`.

The test-only token mode bypasses `createKeycloakAdminClient`. Therefore, a passing token-mode run proves the server connection, official SDK Users request, repository mapping, and use-case execution, but not service-account authentication.

Successful output contains only a count:

```text
Keycloak Users read-only integration passed (N record(s) returned).
```

Failure output is sanitized. It does not print the raw thrown error, response body, URL value, Realm value, credentials, token, or user record.

Known low-severity wording issue: the current `401`/`403` message says to check service-account permissions even when the test-only access-token mode was used. A later cleanup should make this message mode-neutral, for example “Check the configured credential or token permissions.” This does not affect request behavior or data safety.

## 7. Files created or modified in this phase

### 7.1 Created implementation files

```text
modules/users/domain/user.type.ts
modules/users/domain/user.repository.ts
modules/users/application/list-users.usecase.ts
modules/users/infrastructure/keycloak-user.repository.ts
lib/infrastructure/keycloak-admin.client.ts
scripts/test-keycloak.mjs
```

### 7.2 Created test files

```text
tests/infrastructure/keycloak-admin.client.test.mjs
tests/users/keycloak-user.repository.test.mjs
tests/users/list-users.usecase.test.mjs
```

### 7.3 Modified existing file

`package.json` received only these scripts during this phase:

```json
{
  "typecheck": "tsc --noEmit",
  "test": "node --test tests/**/*.test.mjs",
  "test:keycloak": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local scripts/test-keycloak.mjs"
}
```

The targeted warning suppression prevents Node's module-type warning from printing an absolute local filesystem path. It does not suppress other warning categories.

### 7.4 Created report

```text
report.md
```

No dependency was added or upgraded during this phase. `package-lock.json` was not changed by this implementation work; it already contained earlier shadcn and Keycloak dependency changes.

## 8. Test coverage and results

### 8.1 Unit tests

Command:

```bash
npm test
```

Result: passed.

The Node test runner reports three isolated test files at the top level. Those files contain 18 individual test cases:

| Test area | Cases | Coverage |
|---|---:|---|
| Keycloak configuration | 5 | valid normalization, missing-name safety, exact secret preservation, invalid URL redaction, embedded credentials rejection |
| Keycloak User repository | 3 | scoped query/mapping, omitted search, malformed-record redaction |
| List Users use case | 10 | normalization, empty search, offset bounds, page-size bounds, integer validation, search-length validation |

### 8.2 TypeScript

Command:

```bash
npm run typecheck
```

Result: passed with `tsc --noEmit`.

### 8.3 ESLint

Targeted command:

```bash
npx eslint modules lib/infrastructure scripts tests
```

Result: passed for all new files.

Full command:

```bash
npm run lint
```

Result: failed on two pre-existing generated UI issues:

1. `components/chart-area-interactive.tsx:149` — synchronous `setTimeRange(...)` inside an effect.
2. `hooks/use-mobile.ts:14` — synchronous `setIsMobile(...)` inside an effect.

Both are `react-hooks/set-state-in-effect` errors. They were not changed because this phase was explicitly limited to the read-only Users integration and prohibited new UI work.

### 8.4 Live Keycloak integration

Command path:

```bash
npm run test:keycloak
```

The live run supplied the endpoint, discovered Realm, and short-lived test token transiently. Result:

```text
Keycloak Users read-only integration passed (1 record(s) returned).
```

No user identifier, username, email, profile value, credential, or token was printed.

### 8.5 Production build

The default command was attempted:

```bash
npm run build
```

Inside the agent execution sandbox, the existing `@tailwindcss/turbopack` loader could not bind an internal local port and Turbopack returned `EPERM`. This is an execution-environment restriction, not a TypeScript or application compilation error.

The supported webpack fallback was then run without changing project configuration:

```bash
npm run build -- --webpack
```

One run completed successfully:

```text
Compiled successfully
TypeScript finished
Static pages generated
Routes: /, /_not-found, /dashboard
```

The normal Turbopack command should be rerun directly in the user's ordinary terminal, outside the agent sandbox, before considering Turbopack verification fully closed.

Later webpack rechecks inside the same agent environment failed earlier in Next.js with `Could not parse output from TypeScript's --showConfig`. Direct `npm run typecheck` and direct `npx tsc --showConfig` continued to pass, and a diagnostic of Next's child-process capture returned an empty stdout stream. This makes build behavior inside the agent sandbox non-deterministic and environment-limited. The earlier successful webpack result is valid historical evidence, but a fresh ordinary-terminal `npm run build` is still required for final build confirmation.

### 8.6 Production dependency audit

Command:

```bash
npm audit --omit=dev
```

Result:

```text
found 0 vulnerabilities
```

This is evidence for the current production dependency audit only; it is not a guarantee that no security issue exists.

## 9. Security and data-handling audit

| Requirement | Status | Evidence |
|---|---|---|
| No hardcoded application Realm | Passed | Runtime source reads `KEYCLOAK_REALM`; observed `master` was passed only at execution time |
| Existing Keycloak 26.8.0 used | Passed | Running Docker image and live GET request verified |
| No Keycloak resource mutation | Passed | Adapter exposes/calls only `users.find`; no write endpoints invoked |
| No credentials or tokens logged | Passed | Values stayed in process memory; harness emits sanitized messages only |
| No real user PII logged | Passed | Live output contains only returned-record count |
| Strict DDD dependency direction | Passed | Domain/Application have no SDK dependency; adapter implements Domain port |
| Existing Next.js/shadcn UI preserved | Passed | No UI component, route, layout, CSS, or dashboard data file changed in this phase |
| Smallest Users read slice only | Passed | No Clients, roles, groups, auth UI, APIs, or writes implemented |
| Service-account authentication verified | Not yet | No project service-account credentials are configured; live run used test-token mode |
| Production build fully reproducible in agent sandbox | Environment-blocked | Turbopack loader binding was denied; one webpack build passed, while later sandbox rechecks hit a child-output-capture failure |
| Full repository ESLint clean | Not yet | Two pre-existing generated UI errors remain |

## 10. Known limitations and blockers

### 10.1 No configured management service account

The project has no `.env.local` and no verified confidential management Client credentials. The `client_credentials` factory cannot be tested until an authorized Keycloak administrator supplies or configures a least-privilege Client.

Do not commit a secret, paste it into this report, or print it in a command transcript.

### 10.2 Product Realm is not established

Only `master` exists in the inspected server. Although it was the actual configured Realm available for this smoke test, it should not automatically become the business application's permanent Realm.

Selecting or creating a target Realm is an explicit Keycloak administration decision outside this completed read-only phase.

### 10.3 Authentication and authorization are absent

There is no interactive OIDC login, validated server session, caller permission policy, or protected API route. The Users use case must not be exposed to the browser until those controls exist.

### 10.4 Service-account permissions are unverified

The future service account should receive only the administrative permissions needed for the current operation, normally read-only user viewing. Do not grant broad Realm administrator privileges merely to make a test pass.

### 10.5 Node execution assumption

The `.mjs` tests and integration harness import TypeScript modules directly using the verified local Node `24.16.0` runtime. This avoids adding a test-runner dependency, but it is not portable to every older Node version supported by Next.js. If the project standardizes on an older Node runtime, add a deliberate TypeScript runner/build strategy rather than relying on native Node 24 type stripping.

### 10.6 Existing UI follow-ups

The following remain outside this phase:

- two full-lint failures in generated UI code;
- missing root `TooltipProvider`;
- default metadata and homepage content;
- static dashboard demo data.

Do not mix these cleanups into privileged Keycloak work without a separate reviewed change.

## 11. Safe reproduction commands

Run from the repository root.

```bash
npm run typecheck
npm test
npx eslint modules lib/infrastructure scripts tests
npm run build
npm audit --omit=dev
```

When a properly protected `.env.local` exists, run:

```bash
npm run test:keycloak
```

Safe `.env.local` shape:

```dotenv
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=<actual configured target Realm>
KEYCLOAK_ADMIN_CLIENT_ID=<dedicated confidential Client>
KEYCLOAK_ADMIN_CLIENT_SECRET=<secret; never commit or print>
```

Do not copy the one-time bootstrap-token procedure into ordinary development scripts. It was used only to verify this already-running local instance without modifying it.

## 12. Recommended next phase

Do not start UI development or role management yet. The next phase should be narrowly scoped to verifying dedicated read-only service-account authentication.

Recommended sequence:

1. Review this report and the current diff.
2. Confirm the intended MVP Realm with the user. Do not infer that `master` is the final target.
3. Through an explicitly authorized Keycloak administration step, inspect or configure a dedicated confidential management Client with service accounts enabled.
4. Grant only the minimum read permission required to list Users in the target Realm.
5. Store the four configuration values in local `.env.local`; never commit it.
6. Run `npm run test:keycloak` without `KEYCLOAK_TEST_ACCESS_TOKEN`.
7. Verify that client-credentials authentication and the Users GET both succeed.
8. Test expected failure for missing/insufficient permissions with sanitized output.
9. Rerun unit tests, type checking, targeted lint, the ordinary Turbopack build outside the agent sandbox, and the production audit.
10. Stop for review again.

Only after that review should the project proceed to interactive OIDC login, server-side authorization, secured API routes, or dashboard data integration.

## 13. Instructions for the next AI

1. Read `AGENTS.md` completely before editing.
2. Inspect the current worktree and do not overwrite existing shadcn or user changes.
3. Treat this report as historical evidence, not a substitute for checking current files and services.
4. Never hardcode a Realm name.
5. Never print `.env.local`, Docker environment values, tokens, passwords, Client secrets, or real user records.
6. Do not create or mutate any Keycloak resource without explicit authorization for that new phase.
7. Keep SDK imports in Infrastructure and composition code only.
8. Do not add UI/API exposure before interactive login and server authorization exist.
9. Clearly distinguish a test-token smoke test from a verified service-account `client_credentials` test.
10. Report commands actually run, their results, and anything that remains unverified.

## 14. Final phase status

The requested read-only Users integration phase is implemented and reviewed. The DDD query path and live Keycloak GET are proven. The permanent target Realm and dedicated least-privilege service-account authentication remain the next explicit configuration and verification tasks.
