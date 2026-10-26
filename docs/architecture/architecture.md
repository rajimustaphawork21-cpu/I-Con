# Architecture — Keycloak Management

**Last reviewed:** 2026-10-26. This document owns architecture and security decisions; the [implementation index](../implementation/implementation.md) links active feature records, while shared operational API conventions live in the [API document](../api/api.md).

## 1. Mission, scope, and definitions

Keycloak Management is a **custom administration application over an existing Keycloak server**, not an identity provider or a replacement for Keycloak's native console. The current development runtime is Keycloak 24.0.4 while the server-only Admin SDK is 26.8.0; this mismatch is temporarily accepted only for the manually tested read-only endpoints. The initial MVP manages Users, Clients, Client Roles and User-to-Client Role assignments inside **one configured Realm**. Keycloak is the source of truth for identities, Clients, Groups and Role mappings.

- **Realm**: isolation boundary for users, Clients, sessions and Roles. `company-dev` is the local development example, selected by configuration and **never hardcoded**.
- **Client**: an application relying on Keycloak (e.g. `LMS`, `Dashboard`); each Client has its own Roles. `management-service` is a separate confidential backend machine Client.
- **SSO**: within one Realm, a person can authenticate once for several Clients; SSO **does not imply identical permissions**.
- **One person / one Realm user**: one account can have `LMS:admin` and `Dashboard:viewer`. Client Role changes must not alter assignments in other Clients.
- **Future Multi-Realm**: deferred. Separate Realms do not automatically share user identities. Centralized `master` delegation and per-Realm service accounts are potential designs, **not implemented or approved**.

### Role domains — keep them separate

| Role category | Examples | Meaning |
| --- | --- | --- |
| Application Client Roles | `LMS:user`, `Dashboard:viewer` | Permissions inside the respective application |
| Human platform administration Roles | direct `management-web` Client Roles: `user`, `admin`, `super-admin` | What a signed-in human may do in the management UI; current read-only Users policy is implemented |
| Keycloak service-account admin Roles | `realm-management:view-users`, `query-users`, later narrowly approved roles | What backend's machine credential can invoke on Admin REST API |

For current Users List and Count, `admin` and `super-admin` allow access; `user`, unknown and missing roles deny. The policy matches exact, direct roles from `management-web` only. Realm roles, other-client roles, group/composite/effective mappings and browser flags do not grant access. Future write permissions still require a separate delegation matrix, audit design, bootstrap controls and last-Super-Admin protection.

## 2. Approved application style: Modular DDD

**One active Next.js App Router application (Modular Monolith)** at the repository root, with feature bounded contexts; `modules/users` is the reference. Documentation and reference resources coexist at the root but are excluded from the application scanners. The former shadcn application is absent from the active tree and remains recoverable from Git commit `85e3d00`. Do **not** flatten modules to a services/controllers/stores architecture.

```text
keycloak-management/                  # Single active Next.js application
  src/app/                             # Vuexy App Router presentation
  src/@core/                           # Vuexy theme/core
  src/@layouts/                        # Vuexy layout system
  src/@menu/                           # Vuexy navigation system
  src/components/                      # Vuexy providers and components
  modules/
    access/
      domain/                          # Pure permission policy and AccessRepository port
      application/                     # Default-deny subject authorization use case
      infrastructure/                  # Enabled-user and direct management-web Role resolver
    auth/                              # Session policy and Auth.js/Keycloak infrastructure
    users/
      domain/                          # User, ListUsersQuery, UserRepository port
      application/                     # Validated and authorized List/Count use cases
      infrastructure/                  # KeycloakUserRepository List/Count adapter
  lib/infrastructure/
    keycloak-admin.client.ts           # Server-side SDK configuration/authentication
    users-read.composition.ts          # Server-only Access + Users composition root
  src/app/api/users/                    # Protected JSON List and Count routes
  src/app/(dashboard)/users/            # Authenticated Vuexy Users page
  scripts/test-keycloak.mjs            # Local read-only SDK integration harness
  tests/                               # Unit tests for config, repository, use case
  package.json                         # pnpm scripts and active dependencies
  resources/full-version/              # Commercial Vuexy reference source; inactive
  docs/
    architecture/architecture.md       # Durable architecture and security decisions
    api/api.md                         # Shared REST/Postman conventions
    implementation/
      implementation.md                # Concise feature index and workflow gates
      users/users.md                    # Users tasks and sanitized evidence
    report/project-status.md           # Concise project-wide status
  AGENTS.md
```

**Confirmed current files**, not generic placeholders:

```text
modules/users/domain/user.type.ts
modules/users/domain/user.repository.ts
modules/users/application/count-users.usecase.ts
modules/users/application/list-users.usecase.ts
modules/users/application/list-users-for-subject.usecase.ts
modules/users/infrastructure/keycloak-user.repository.ts
modules/access/domain/permission-policy.ts
modules/access/application/authorize-permission.usecase.ts
modules/access/infrastructure/keycloak-access.repository.ts
lib/infrastructure/keycloak-admin.client.ts
lib/infrastructure/users-read.composition.ts
scripts/test-keycloak.mjs
tests/infrastructure/keycloak-admin.client.test.mjs
tests/users/count-users.usecase.test.mjs
tests/users/keycloak-user.repository.test.mjs
tests/users/list-users.usecase.test.mjs
src/app/(dashboard)/users/page.tsx
src/app/api/users/route.ts
src/app/api/users/count/route.ts
src/components/layout/vertical/VerticalMenu.tsx
```

The active DDD locations intentionally sit at root `modules/`, not under Vuexy's `src/`, so the approved `modules/<feature>/{domain,application,infrastructure}` shape and existing relative imports remain unchanged. Vuexy's `@/*` alias targets root `src/*`; no shadcn convention was imposed on the template.

### Layer ownership and dependency rule

| Layer | Owns | Depends on | Must not import |
| --- | --- | --- | --- |
| Domain | Entity/types, invariants, repository contracts | Plain TS, local Domain | Keycloak SDK, Next.js, React, env |
| Application | Use Cases, normalization, business decisions, trusted-caller authorization | Domain contracts | Direct SDK, network, UI state |
| Infrastructure | SDK-based repository implementation, config, external mapping | Domain contracts + external libraries | Client Components or browser state |
| Presentation | Next.js route handlers, RSC/UI, response DTOs, session guards | Application and server composition | Privileged credentials in Client Components |

Dependency example (**source direction, not a runtime dependency cycle**):

```text
Next.js protected API
  -> trusted encrypted-session subject
  -> AuthorizePermissionUseCase
      -> AccessRepository <- KeycloakAccessRepository
          -> current enabled User + direct management-web Client Roles
  -> ListUsersForSubjectUseCase / CountUsersForSubjectUseCase
      -> ListUsersUseCase / CountUsersUseCase (Application)
      -> UserRepository (Domain port)
          <- KeycloakUserRepository (Infrastructure implementation)
              -> @keycloak/keycloak-admin-client -> Keycloak Admin REST
```

### Existing Users slice details

- `User`: `{ id: string; username: string; enabled: boolean; email?: string }`; does not expose Keycloak credential/role internals.
- `UserRepository`: `list({ first, max, search? }): Promise<User[]>` and `count({ search? }): Promise<number>` Domain abstractions.
- `ListUsersUseCase`: `first` safe integer 0..2,147,483,647; `max` integer 1..100; optional `search` trimmed, omitted when empty, <=256 chars.
- `CountUsersUseCase`: validates and normalizes optional filtered search before delegation.
- `KeycloakUserRepository`: SDK `users.find` and `users.count`, explicit configured Realm, minimal User mapping and non-negative safe-integer Count validation with sanitized errors.
- `createKeycloakAdminClient`: configuration validation and `client_credentials` factory; the normal configured path was verified for List/Count reads on 2026-10-20 with the test-token override unset.
- `scripts/test-keycloak.mjs`: current List/Count composition root. A test-only token path still exists and must not be confused with the verified normal machine-credential path.
- `ListUsersForSubjectUseCase` and `CountUsersForSubjectUseCase` authorize the trusted subject before invoking the existing validated use cases, so denial or role-resolution failure cannot reach Users data operations.
- Route handlers map only the minimal User DTO and never serialize raw SDK errors, roles, credentials or OAuth tokens.

## 3. Runtime and credentials

Current observed deployment:

```text
Ubuntu local machine
  Active app: repository root (Vuexy 5.0.1, Next.js 16.4.2, React 19.2.3, MUI 7.3.6)
  Package manager: pnpm 10.18.3
  Browser presentation: authenticated Vuexy App Router layout and read-only Users page
  Keycloak container: Keycloak 24.0.4, local Docker development runtime
  Realm: configurable; company-dev is the current development value
  Human Client: management-web; machine Client: management-service
```

The current `management-service` uses a confidential Client plus enabled Service Accounts. Its current read permissions have been manually verified for Users List/Count and the Phase 2 subject/client-role lookup endpoints. Scope and actual authorization for every future endpoint must still be verified; token success alone does not prove endpoint permission.

Server-only environment variable **names** (do not commit values):

```dotenv
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=company-dev
KEYCLOAK_ADMIN_CLIENT_ID=management-service
KEYCLOAK_ADMIN_CLIENT_SECRET=<private local secret>
KEYCLOAK_WEB_CLIENT_ID=management-web
KEYCLOAK_WEB_CLIENT_SECRET=<private local secret>
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<private local secret>
```

The private configuration is available to the active application as ignored root `.env.local` with mode `0600`; values remain undisclosed. The root file was byte-identical to the previously verified nested copy before cleanup, and the normal configured service-account path was re-verified from the root without the test-token override. `KEYCLOAK_TEST_ACCESS_TOKEN` is a **test-only override**, not normal authentication. Secret values are not included in documentation, Postman exports, Git or logs. If Next.js later runs in Docker, `localhost` from that container refers to itself; configure reachable service hostnames and consistent OIDC issuers.

## 4. Human authentication and read authorization architecture

1. `management-web` handles human Authorization Code + PKCE login through Auth.js. The encrypted cookie stores only subject, sanitized name and server-controlled lifetime claims; the public session exposes name and expiry only.
2. Users APIs resolve the trusted subject directly from the encrypted cookie. Missing, malformed or expired sessions return JSON 401; page navigation continues to redirect to `/login`.
3. `KeycloakAccessRepository` checks the subject still exists and is enabled, resolves exactly one configured `management-web` Client, then fetches only its direct role mappings. It does not request Realm, other-client, group or composite roles.
4. `AuthorizePermissionUseCase` applies the pure default-deny matrix. Authorization completes before List/Count can invoke `UserRepository`.
5. Allowed requests invoke the separate `management-service` credential through server-only infrastructure. The Admin SDK is externalized from browser bundles; credentials and tokens never enter response DTOs or public sessions.
6. Query validation, safe error mapping and `Cache-Control: no-store` apply to every Users API response. Keycloak and role-resolution failures return a generic 503 and deny access.
7. All mutations remain out of scope. Before writes: define audit persistence, action/resource permission rules, allowlists, privilege-escalation protection and last-Super-Admin safeguards.

### Examples of business invariants

- Every newly created ordinary account receives the platform's default user classification via an approved, explicit configuration; merely defining a Realm Role does not assign every application's `user` Client Role.
- Giving `LMS:user` does not remove `Dashboard:viewer`.
- Adding a Client Role does not replace existing roles: calculate specific add/remove operations.
- Never authorize changes based only on hidden UI controls or client-provided `isAdmin` flags.
- Admin cannot self-promote; protect last active Super Admin; role changes may not affect existing access tokens until refresh/session actions.

## 5. UI approach and future integration

Retain the Vuexy Starter Kit's MUI theme, settings providers, vertical/horizontal layout system, Sidebar/navigation, fonts, styles and assets. Active routes include `/home`, `/about`, `/login` and `/users`; `/` redirects to `/home`. The read-only Users page uses the protected APIs and implements search, server pagination, loading, empty, forbidden and retryable error states. Navigation is not an authorization boundary: all authenticated users may see the link, while the API independently enforces permissions.

`resources/full-version/` is the relocated, reference-only Vuexy Full Version source tree. It is ignored by the root Git rules and is outside the active app, TypeScript, ESLint and build roots. Future UI work may inspect it and selectively adapt only a required compatible component and dependencies; never import or build the entire Full Version. The pre-promotion recovery commit still contains the commercial source at its former path, so the repository and its history must remain private unless the purchaser confirms redistribution rights or separately authorizes an appropriate history-remediation plan.

Implemented read path:

```text
Authenticated browser -> protected Next.js /api/... -> validate + authorize
 -> Application Use Case -> Domain Repository -> server-only Infrastructure
 -> Keycloak -> sanitized user-facing DTO
```

The real Keycloak REST routes are **not** the same as Next.js application routes. User-facing routes are protected and do not accept a caller-supplied Realm.

## 6. Constraints and decisions

- Preserve the root Vuexy foundation and Modular DDD paths. The former shadcn UI, duplicate backend paths and npm configuration are absent from the active tree and recoverable from the verified pre-promotion Git snapshot.
- No standalone NestJS/Express backend needed for initial MVP; Next.js server runtime can host protected routes.
- Do not introduce redundant `services/`, `controllers/` or `stores/` in place of approved DDD layers.
- Avoid extra application DB until required (notably independent audit persistence).
- Use Node 24 and pnpm 10.18.3 for the currently verified root workflow; a repository-wide Node version pin remains pending.
- Root `next.config.ts` keeps `turbopack.root: process.cwd()` as an explicit repository-root boundary; there is no nested active app or competing root npm lockfile.
- The Keycloak Admin SDK is a server-external package. Next build typechecking uses the installed TypeScript compiler API because detached CLI output capture is unreliable in the managed verification environment.
- Root `tsconfig.json` and `.eslintrc.js` explicitly exclude `resources/full-version/`; tests target root `tests/`, and the production build manifests contain no Full Version reference.
- Vuexy's ESLint 8 scripts explicitly select the root `.eslintrc.js`; the former shadcn flat ESLint configuration is no longer active.
- Treat all Vuexy source as commercial. The configured remote was verified private, but no local purchase certificate or license text was found; do not commit, push, publish or share template source unless entitlement and collaborator access are confirmed.
- Multi-Realm is separate architecture approval; neither a dynamic Realm selector nor a broad `master` admin token is permitted as an incidental MVP feature.

See the [implementation index](../implementation/implementation.md) for workflow gates, [Users feature documentation](../implementation/users/users.md) for current feature tasks, [API conventions](../api/api.md) for endpoint usage, and [project status](../report/project-status.md) for summary evidence and blockers.
