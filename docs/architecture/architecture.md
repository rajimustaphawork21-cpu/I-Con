# Architecture — Keycloak Management

**Documentation consolidated:** 2026-10-21. **Evidence baseline:** source audit dated 2026-10-19 and root-promotion verification dated 2026-10-20; verify the local repository before treating any status as current. This document owns architecture and security decisions; the [implementation index](../implementation/implementation.md) links active feature records, while shared operational API conventions live in the [API document](../api/api.md).

## 1. Mission, scope, and definitions

Keycloak Management is a **custom administration application over an existing Keycloak 26.8.0 server**, not an identity provider or a replacement for Keycloak's native console. The initial MVP manages Users, Clients, Client Roles and User-to-Client Role assignments inside **one configured Realm**. Keycloak is the source of truth for identities, Clients, Groups and Role mappings. Avoid unnecessary data duplication.

- **Realm**: isolation boundary for users, Clients, sessions and Roles. `company-dev` is the local development example, selected by configuration and **never hardcoded**.
- **Client**: an application relying on Keycloak (e.g. `LMS`, `Dashboard`); each Client has its own Roles. `management-service` is a separate confidential backend machine Client.
- **SSO**: within one Realm, a person can authenticate once for several Clients; SSO **does not imply identical permissions**.
- **One person / one Realm user**: one account can have `LMS:admin` and `Dashboard:viewer`. Client Role changes must not alter assignments in other Clients.
- **Future Multi-Realm**: deferred. Separate Realms do not automatically share user identities. Centralized `master` delegation and per-Realm service accounts are potential designs, **not implemented or approved**.

### Role domains — keep them separate

| Role category | Examples | Meaning |
| --- | --- | --- |
| Application Client Roles | `LMS:user`, `Dashboard:viewer` | Permissions inside the respective application |
| Human platform administration Roles | proposed `platform-user`, `platform-admin`, `platform-super-admin` | What a signed-in human may do in the management UI; **not yet provisioned/implemented** |
| Keycloak service-account admin Roles | `realm-management:view-users`, `query-users`, later narrowly approved roles | What backend's machine credential can invoke on Admin REST API |

Default platform user = ordinary User; delegated Admin can only access specifically assigned resources; Super Admin may manage platform-supported resources in the configured Realm, subject to safeguards. Exact Role placement, delegation matrix, bootstrap and last-Super-Admin protection remain **open design decisions**. No role named `admin` may bypass server-side policy automatically.

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
    users/
      domain/                          # User, ListUsersQuery, UserRepository port
      application/                     # ListUsersUseCase + CountUsersUseCase
      infrastructure/                  # KeycloakUserRepository List/Count adapter
  lib/infrastructure/
    keycloak-admin.client.ts           # Server-side SDK configuration/authentication
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
modules/users/infrastructure/keycloak-user.repository.ts
lib/infrastructure/keycloak-admin.client.ts
scripts/test-keycloak.mjs
tests/infrastructure/keycloak-admin.client.test.mjs
tests/users/count-users.usecase.test.mjs
tests/users/keycloak-user.repository.test.mjs
tests/users/list-users.usecase.test.mjs
src/app/(dashboard)/home/page.tsx
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
Next.js protected API (future) / scripts/test-keycloak.mjs (current)
  -> ListUsersUseCase / CountUsersUseCase (Application)
      -> UserRepository (Domain port)
          <- KeycloakUserRepository (Infrastructure implementation)
              -> @keycloak/keycloak-admin-client -> Keycloak Admin REST
```

### Existing Users slice details

- `User`: `{ id: string; username: string; enabled: boolean; email?: string }`; does not expose Keycloak credential/role internals.
- `UserRepository`: `list({ first, max, search? }): Promise<User[]>` and `count(): Promise<number>` Domain abstractions.
- `ListUsersUseCase`: `first` safe integer 0..2,147,483,647; `max` integer 1..100; optional `search` trimmed, omitted when empty, <=256 chars.
- `CountUsersUseCase`: zero-input delegation through the Domain repository port.
- `KeycloakUserRepository`: SDK `users.find` and `users.count`, explicit configured Realm, minimal User mapping and non-negative safe-integer Count validation with sanitized errors.
- `createKeycloakAdminClient`: configuration validation and `client_credentials` factory; the normal configured path was verified for List/Count reads on 2026-10-20 with the test-token override unset.
- `scripts/test-keycloak.mjs`: current List/Count composition root. A test-only token path still exists and must not be confused with the verified normal machine-credential path.
- The Users use cases do **not yet accept a caller/permission context**. They remain safe only while no protected browser API exposes them.

Future work should extend existing ports/use cases rather than duplicating them; public API or UI integration requires an approved authentication/authorization implementation plan.

## 3. Runtime and credentials

Current observed deployment:

```text
Ubuntu local machine
  Active app: repository root (Vuexy 5.0.1, Next.js 16.1.1, React 19.2.3, MUI 7.3.6)
  Package manager: pnpm 10.18.3
  Browser presentation: Vuexy App Router layout; not yet bound to Keycloak browser flows
  Keycloak container: quay.io/keycloak/keycloak:26.8.0, start-dev, localhost:8080
  Realm: company-dev (public discovery and configured read-only List/Count SDK path verified)
  Clients seen historically in Admin Console: LMS, Dashboard, management-service
```

The current `management-service` uses a confidential Client plus enabled Service Accounts. Historical screenshots showed `realm-management:view-users` and `query-users` direct mappings and a successful `client_credentials` Postman token request. **Effective/inherited privileges remain unaudited.** Scope and actual authorization for each new admin endpoint must be verified; Token success alone does not prove an endpoint permission.

Server-only environment variable **names** (do not commit values):

```dotenv
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=company-dev
KEYCLOAK_ADMIN_CLIENT_ID=management-service
KEYCLOAK_ADMIN_CLIENT_SECRET=<private local secret>
```

The private configuration is available to the active application as ignored root `.env.local` with mode `0600`; values remain undisclosed. The root file was byte-identical to the previously verified nested copy before cleanup, and the normal configured service-account path was re-verified from the root without the test-token override. `KEYCLOAK_TEST_ACCESS_TOKEN` is a **test-only override**, not normal authentication. Secret values are not included in documentation, Postman exports, Git or logs. If Next.js later runs in Docker, `localhost` from that container refers to itself; configure reachable service hostnames and consistent OIDC issuers.

## 4. Human authentication and security architecture (not implemented)

1. Use a **separate human OIDC Client**, not the machine-only `management-service` Client. Choose a secure Next.js Authorization Code + PKCE/BFF/session design. Decide session lifetime, logout and state/nonce/issuer/audience validation.
2. Authenticate the caller and establish a trusted server session. Define platform-role representations and delegated admin permission matrix; authorize **action + selected resource/Client + target role** server-side, default deny.
3. On allowed operations, invoke the backend's least-privileged Keycloak Admin SDK through a server-only infrastructure adapter. Never expose its tokens/secret to browsers.
4. Validate inputs before executing Use Cases, map SDK failures to safe HTTP responses, minimize PII in DTOs and logs, protect against CSRF/origin issues for privileged writes.
5. Before mutations: define immutable/adequately protected audit trail, allowlist permitted Client/Role operations, prevent privilege escalation/self-promotion and last-Super-Admin lockout.
6. Direct and effective Role mappings differ: Group/composite inheritance may preserve access after a direct mapping is removed. Verify actual effective access.
7. Local Keycloak uses `start-dev`/HTTP. Production requires proper Keycloak deployment, HTTPS, secret management, backing DB, backups and monitoring.

### Examples of business invariants

- Every newly created ordinary account receives the platform's default user classification via an approved, explicit configuration; merely defining a Realm Role does not assign every application's `user` Client Role.
- Giving `LMS:user` does not remove `Dashboard:viewer`.
- Adding a Client Role does not replace existing roles: calculate specific add/remove operations.
- Never authorize changes based only on hidden UI controls or client-provided `isAdmin` flags.
- Admin cannot self-promote; protect last active Super Admin; role changes may not affect existing access tokens until refresh/session actions.

## 5. UI approach and future integration

Retain the Vuexy Starter Kit's MUI theme, settings providers, vertical/horizontal layout system, Sidebar/navigation, fonts, styles and assets. The verified active routes are `/home`, `/about` and `/login`; `/` redirects to `/home`. The Vuexy UI remains a template scaffold and is **not** a live Keycloak Users dashboard. Do not add privileged identities or copy the old shadcn dashboard into Vuexy until OIDC session, platform RBAC and protected APIs are ready.

`resources/full-version/` is the relocated, reference-only Vuexy Full Version source tree. It is ignored by the root Git rules and is outside the active app, TypeScript, ESLint and build roots. Future UI work may inspect it and selectively adapt only a required compatible component and dependencies; never import or build the entire Full Version. The pre-promotion recovery commit still contains the commercial source at its former path, so the repository and its history must remain private unless the purchaser confirms redistribution rights or separately authorizes an appropriate history-remediation plan.

Future safe path:

```text
Authenticated browser -> protected Next.js /api/... -> validate + authorize
 -> Application Use Case -> Domain Repository -> server-only Infrastructure
 -> Keycloak -> sanitized user-facing DTO
```

The real Keycloak REST routes are **not** the same as Next.js application routes. User-facing API routes must be protected and should not accept an arbitrary caller-supplied Realm in this MVP.

## 6. Constraints and decisions

- Preserve the root Vuexy foundation and Modular DDD paths. The former shadcn UI, duplicate backend paths and npm configuration are absent from the active tree and recoverable from the verified pre-promotion Git snapshot.
- No standalone NestJS/Express backend needed for initial MVP; Next.js server runtime can host protected routes.
- Do not introduce redundant `services/`, `controllers/` or `stores/` in place of approved DDD layers.
- Avoid extra application DB until required (notably independent audit persistence).
- Use Node 24 and pnpm 10.18.3 for the currently verified root workflow; a repository-wide Node version pin remains pending.
- Root `next.config.ts` keeps `turbopack.root: process.cwd()` as an explicit repository-root boundary; there is no nested active app or competing root npm lockfile.
- Root `tsconfig.json` and `.eslintrc.js` explicitly exclude `resources/full-version/`; tests target root `tests/`, and the production build manifests contain no Full Version reference.
- Vuexy's ESLint 8 scripts explicitly select the root `.eslintrc.js`; the former shadcn flat ESLint configuration is no longer active.
- Treat all Vuexy source as commercial. The configured remote was verified private, but no local purchase certificate or license text was found; do not commit, push, publish or share template source unless entitlement and collaborator access are confirmed.
- Multi-Realm is separate architecture approval; neither a dynamic Realm selector nor a broad `master` admin token is permitted as an incidental MVP feature.

See the [implementation index](../implementation/implementation.md) for workflow gates, [Users feature documentation](../implementation/users/users.md) for current feature tasks, [API conventions](../api/api.md) for endpoint usage, and [project status](../report/project-status.md) for summary evidence and blockers.
