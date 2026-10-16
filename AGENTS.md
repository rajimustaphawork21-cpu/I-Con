# AGENTS.md — Keycloak Management Platform

> **Purpose:** This file is the authoritative project handoff for a coding agent continuing the existing Keycloak Management web application. Read it before editing the project. Distinguish **confirmed current state** from **planned work**. Do not treat example names, paths, users, realms, or code sketches as pre-existing resources.
>
> **Project context updated:** 2026-10-15.  
> **Local working directory (on the user's Ubuntu machine):** `~/Desktop/keycloak-management`  
> **MVP focus:** one **configurable** Keycloak Realm containing multiple web application Clients that share SSO and have independent Client Roles.

---

## 1. Product vision

Build a **custom web administration platform for an existing local Keycloak server**. It is not a replacement for Keycloak, not a custom identity provider, and not a clone of the entire Keycloak Admin Console.

The platform must let authorized people manage **users and each user's roles in individual Clients** in one interface. The same Keycloak user can have different permissions in different web applications, even though they authenticate via the same Realm and benefit from Single Sign-On (SSO).

The platform has three **platform administration levels**:

- **User**: the default classification for every newly created account; can see/manage only their permitted profile and non-administrative functions.
- **Admin**: can manage only explicitly delegated operations/resources; its precise scope must be defined and enforced on the server.
- **Super Admin**: can administer all platform-supported user/client role assignments in the configured Realm and can create users, assign delegated admin roles, and manage custom roles subject to safety rules.

A Super Admin may create an account with a selected role, or promote/demote an existing User; ordinary users cannot promote themselves. Roles within each application are **independent** of platform-level roles.

**Canonical example:** User `Youssef` in a Realm has `viewer` in `Dashboard`, `admin` in `LMS`, and `editor` in `Projects`. A Super Admin changes the LMS assignment to `user` **without changing the other two Clients**. This is a Client Role Mapping operation, not a user-account migration.

### Explicit clarifications agreed in conversation

1. `realm-x` is **only an example name**. Never hard-code it as the real Realm. Realm names are chosen in Keycloak and must be configurable.
2. The intended SSO setup for the first MVP is **many Clients inside one Realm**. Each person has **one user account in that Realm**, not one account per Client.
3. Different Clients can have different role names and permission models.
4. The application manages real Keycloak users and role mappings via the **official Keycloak Admin REST API** (prefer the official TypeScript Admin Client).
5. A platform Super Admin can manage roles for other persons in any supported Client inside the configured Realm. This is not blanket access for every ordinary person.
6. Although the future design may support more than one Realm, **cross-Realm aggregated management and cross-Realm shared accounts are not MVP requirements**. Do not conflate a user account in one Realm with an account in another.
7. A role called `user` in a Client is distinct from the default **platform user** role. Setting a Realm default role does **not** automatically assign all Client-specific `user` roles.

### Non-goals for MVP

- Rebuild Keycloak itself or maintain duplicate passwords/identities in an application database.
- Automatically share a Keycloak account across separate Realms.
- Multi-tenant SaaS, payments, subscriptions, billing, or unrelated administration features.
- Full replication of the native Keycloak Console (authentication flows, identity brokers, certificates, etc.).
- Production deployment before access control, secret handling, and testing are in place.

---

## 2. Technology stack and confirmed versions

| Component | Choice / state |
|---|---|
| Operating system | User is developing on Ubuntu Linux (HP ProDesk desktop) |
| Application directory | `~/Desktop/keycloak-management` |
| Next.js | **16.4.1** reported by successful build |
| Build tooling | Turbopack; App Router; TypeScript; Tailwind CSS v4 |
| UI kit | **shadcn/ui CLI 4.21.5**, **Base UI**, **Nova** preset |
| Starter dashboard | shadcn **`dashboard-01`**, installed and generating files |
| Keycloak | **26.8.0** (version stated by user) |
| Docker | **29.9.0** (version stated by user) |
| Keycloak SDK | **`@keycloak/keycloak-admin-client@26.8.0`**, installed |
| Architectural style | **Modular DDD** (Domain-Driven Design), one Next.js application for MVP |
| Admin integration | Server-side SDK calls to Keycloak Admin REST API |
| Login | Keycloak OpenID Connect; to be implemented |
| Database | No extra application database required at start; Keycloak is the identity/roles source of truth |

**Package versions are from user terminal output.** Verify `package.json`, `package-lock.json`, and installed versions before changing dependencies.

### Current install commands already completed successfully

```bash
# Executed from ~/Desktop/keycloak-management
npx shadcn@latest init
npx shadcn@latest add dashboard-01
npm install @keycloak/keycloak-admin-client@26.8.0
```

`npx shadcn@latest init` selected **Base UI (Recommended)** and **Nova**. It wrote `components.json`, `app/globals.css`, and common UI utilities and components.

The user was already in `~/Desktop/keycloak-management`, so an earlier `cd keycloak-management` returned `No such file or directory`; it was **not a project failure**.

### Confirmed build and security test results

```text
npm audit --omit=dev
found 0 vulnerabilities

npm run build
> next build
▲ Next.js 16.4.1 (Turbopack)
✓ Compiled successfully
✓ TypeScript finished
✓ Static page generation finished
Routes: /, /_not-found, /dashboard
```

Prior full `npm audit` output reported **9 high severity advisories**, largely through `braces -> micromatch -> fast-glob`, with `shadcn` and related tooling in the dependency chain. Earlier `--omit=dev` reported 7, but **the latest reported `--omit=dev` result is 0**. `shadcn@4.21.5` is confirmed in `devDependencies`, not regular dependencies. Do **not** use `npm audit fix --force` reflexively; it suggested a breaking change to `shadcn@1.0.0`. Continue security monitoring and assess full audit separately. A clean production-dependency audit is not proof of perfect security.

`/dashboard` currently builds as **static output**. No confirmed live Keycloak integration is present in that page.

### Not yet confirmed

- Whether the Keycloak Docker Container is currently running and on which port.
- The real Realm name; `realm-x`, `company`, and similar names in discussions were **examples only**.
- Whether a `management-service` Client, client secret, or service account exists.
- Whether `.env.local`, DDD modules, scripts, or authentication routes have actually been created.
- Whether the dashboard has been opened successfully in a browser (build succeeded, runtime UI not independently confirmed).
- Whether `TooltipProvider` has been added to root layout as requested by the Base UI CLI.
- The precise delegation policy for the intermediate `Admin` level.
- Whether a dedicated audit store or external database will be needed later.

Do not claim any of the above are finished without inspecting files or testing.

---

## 3. Existing starter files (created by CLI)

The project uses **root-level `app/`, `components/`, and `lib/`**, not a confirmed `src/` layout. Retain this convention unless an explicit migration is approved.

Files confirmed in the shadcn CLI output include:

```text
app/
  dashboard/
    page.tsx
    data.json               # Starter/demo data; not Keycloak data
  globals.css
  layout.tsx                # Existing from Next.js project, inspect before editing
components/
  app-sidebar.tsx
  chart-area-interactive.tsx
  data-table.tsx
  nav-documents.tsx
  nav-main.tsx
  nav-secondary.tsx
  nav-user.tsx
  section-cards.tsx
  site-header.tsx
  ui/
    avatar.tsx badge.tsx breadcrumb.tsx button.tsx card.tsx
    chart.tsx checkbox.tsx drawer.tsx dropdown-menu.tsx
    input.tsx label.tsx select.tsx separator.tsx sheet.tsx
    sidebar.tsx skeleton.tsx sonner.tsx table.tsx tabs.tsx
    toggle.tsx toggle-group.tsx tooltip.tsx
hooks/
  use-mobile.ts
lib/
  utils.ts
components.json
package.json
package-lock.json
```

`TooltipProvider` was requested by the CLI. Check `app/layout.tsx` and, if missing, wrap `{children}` in the appropriate provider **without destroying existing fonts, metadata, CSS, or layout functionality**.

The starter includes charts and a sample Data Table. These are only UI scaffolding; they do not imply any business API implementation.

---

## 4. Identity, roles, and authorization model

### One Realm / many Clients

```text
Existing Keycloak Server 26.8.0
└── <CONFIGURED_REALM_NAME>      # e.g. internal-company, not fixed
    ├── Users                  # one identity/account per person in this Realm
    │   ├── Youssef
    │   ├── Ahmed
    │   └── ...
    ├── Web Clients
    │   ├── LMS                 # app-specific roles
    │   ├── Dashboard           # app-specific roles
    │   └── Projects            # app-specific roles
    ├── Platform Management Client
    ├── Platform Roles
    └── Groups (as needed)
```

One user may log into multiple Clients using the same Keycloak Realm SSO session. **Authentication/SSO is not authorization**; each app/Backend must enforce its own permissions.

### Two different levels of roles

**A. Platform admin roles (proposed names, to create)**

- `platform-user` — default platform-level role.
- `platform-admin` — a restricted management role, with explicit policy/scope.
- `platform-super-admin` — full management rights for **the platform's supported resources within the configured Realm**.

These could be dedicated Client Roles for a management application or Realm Roles; select one canonical model in implementation and document how it is mapped into validated tokens. Do not silently alternate between models. The initial recommendation from prior discussion was dedicated platform roles with separation from business Client Roles.

**B. Application/Client Roles (defined per Client)**

- `LMS`: e.g., `user`, `admin`.
- `Dashboard`: e.g., `viewer`, `admin`.
- `Projects`: e.g., `editor`, `admin`.

The exact existing roles must be **read from Keycloak**, not fabricated; these values are examples.

**Keycloak administrative privileges are a third concept.** A role named `platform-super-admin` does not inherently give the server rights to call Keycloak Admin REST API. A trusted backend service account needs actual Keycloak administrative privileges such as necessary `realm-management` roles (e.g. `view-users`, `manage-users`, `view-clients`, `manage-clients` only where necessary), or an equivalent approved fine-grained configuration. Do **not** grant all users Keycloak admin privileges.

### Role assignment rules (MVP)

1. Newly registered/created user starts as `platform-user` by default, unless Super Admin deliberately creates a privileged account (with explicit policy).
2. Only Super Admin can grant/revoke `platform-super-admin` or promote ordinary users to unrestricted admin authority.
3. `platform-admin` can perform only delegated operations; exact permissions still to be designed.
4. Client Role Mapping changes are scoped to the **selected Client + selected User**.
5. Assigning a Client Role **adds** it; it does not replace all existing roles. For a replacement, compute explicit add/remove operations and avoid touching other Clients' roles.
6. If a role is inherited through Group or Composite Roles, removing a direct role mapping may not remove effective access. Inspect **direct vs effective** role mappings.
7. Protect the last active Super Admin from accidental demotion/deletion/lockout. Require an auditable process for privilege elevation.
8. Ordinary users never directly invoke arbitrary Keycloak admin operations. Every server route authorizes the **caller, resource/Client, action, and target role**.
9. Never determine sensitive permissions solely from a hidden UI button or a user-supplied `isAdmin` field.
10. Role changes can be reflected only in newly issued tokens until existing tokens expire or sessions are appropriately refreshed/revoked.

### User example: Youssef

| Client | Before | After changing LMS role |
|---|---|---|
| Dashboard | `viewer` | `viewer` |
| LMS | `admin` | `user` |
| Projects | `editor` | `editor` |

If `admin` is directly assigned in LMS, use role mapping DELETE for that role and POST for LMS `user` role; verify both. If `admin` is inherited, follow the inheritance source rather than assuming DELETE of the direct mapping is effective.

### Group membership vs custom permissions

Keycloak Groups and Composite Roles can reduce per-user manual role duplication. The UI should eventually show **direct roles**, **group/composite effective roles**, and **source of inherited access** when technically available. Do not manufacture one unique Role per user unless there is an explicit business need.

---

## 5. Architecture: Modular DDD

Use one deployable Next.js application initially, with DDD boundaries. **DDD is an architectural approach, not an algorithm.** Keep all Keycloak SDK imports out of Domain and Application business rules.

Dependency direction:

```text
Presentation (Next.js pages, route handlers, UI)
   -> Application (use cases, orchestration, authorization checks)
       -> Domain (entities, invariants, value objects, repository ports)
Infrastructure (Keycloak Admin SDK adapter) -> Domain repository ports
Composition root wires interfaces to infrastructure
```

Use **bounded contexts / modules**:

- `auth` — OIDC login/session, validated identity, platform roles/permissions.
- `users` — user listing, creation, editing, status, profile representations.
- `clients` — reading Clients and available Client Roles.
- `access` — Client Role Mappings, custom roles, privilege assignment, policy enforcement.
- `audit` (subsequent phase) — record sensitive administrative actions.

### Proposed minimal folder structure (NOT YET VERIFIED CREATED)

```text
keycloak-management/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (admin)/dashboard/page.tsx           # Reuse/migrate starter cautiously
│   ├── (admin)/users/page.tsx
│   ├── (admin)/clients/page.tsx
│   ├── (admin)/access/page.tsx
│   └── api/
│       ├── users/route.ts
│       ├── clients/route.ts
│       └── users/[userId]/client-roles/route.ts
├── components/
│   ├── ui/                                 # generated shadcn components
│   └── ...                                 # current starter components
├── modules/
│   ├── auth/
│   │   ├── domain/
│   │   ├── application/
│   │   └── infrastructure/
│   ├── users/
│   │   ├── domain/
│   │   │   ├── user.type.ts
│   │   │   └── user.repository.ts
│   │   ├── application/
│   │   │   └── list-users.usecase.ts
│   │   └── infrastructure/
│   │       └── keycloak-user.repository.ts
│   ├── clients/
│   └── access/
├── lib/
│   ├── infrastructure/
│   │   └── keycloak-admin.client.ts
│   └── utils.ts
├── scripts/
│   └── test-keycloak.ts
├── tests/                                    # add when implementing tests
├── .env.local                               # local-only secrets, not committed
├── components.json
└── package.json
```

The exact routes and folder grouping are proposals, not proof of current files. Use the actual root-level App Router. Avoid pointless nesting for only one or two files; split files by bounded responsibilities when their size or number warrants it. Prefer short, focused TypeScript files and singular names such as `auth.service.ts`, `user.type.ts`.

### Design contracts

Example Domain type, **not yet implemented**:

```ts
export interface User {
  id: string;
  username: string;
  enabled: boolean;
  email?: string;
}

export interface UserRepository {
  list(input: { first: number; max: number; search?: string }): Promise<User[]>;
}
```

Example application operation:

```text
ListUsersUseCase
  - accepts validated pagination/search input
  - checks caller permission to list users
  - calls UserRepository port
  - returns domain/presentation DTOs, never secret-bearing Keycloak objects
```

Example write operation:

```text
ChangeUserClientRolesUseCase
  - validated caller must have sufficient platform policy
  - validates target user ID and Client internal ID
  - confirms allowed target role IDs and current direct/effective roles
  - computes precise add/remove changes for that Client
  - invokes repository adapter
  - verifies result and records audit event
  - never edits mappings of another Client
```

Repositories are adapters to Keycloak; **Keycloak is the source of truth** for existing identities, Clients and role mappings. Avoid mirroring full identity data into an application database without a requirement.

---

## 6. Official Keycloak API / SDK integration

**Primary library:** `@keycloak/keycloak-admin-client@26.8.0`, used **server-side only**.

**API base shape:**

```text
{KEYCLOAK_URL}/admin/realms/{REALM_NAME}
```

The Realm is a **configurable value**. Many Client Role Mapping routes require the **internal Client UUID**, not the visible `clientId`. Likewise, user operations require the internal user ID. Find the IDs first.

### Critical endpoints

| Method | Keycloak Admin REST path | Use |
|---|---|---|
| GET | `/admin/realms/{realm}/users` | Search/list users, paginate |
| POST | `/admin/realms/{realm}/users` | Create user |
| GET | `/admin/realms/{realm}/users/{userId}` | User details |
| PUT | `/admin/realms/{realm}/users/{userId}` | Update user |
| GET | `/admin/realms/{realm}/clients?clientId={clientId}` | Look up Client UUID |
| GET | `/admin/realms/{realm}/clients` | List Clients |
| GET | `/admin/realms/{realm}/clients/{clientUuid}/roles` | List Client Roles |
| GET | `/admin/realms/{realm}/clients/{clientUuid}/roles/{roleName}` | Fetch role representation |
| GET | `/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUuid}` | Direct Client roles |
| GET | `/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUuid}/composite` | Effective Client roles, including composite inheritance |
| POST | `/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUuid}` | Add direct Client roles |
| DELETE | `/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUuid}` | Remove direct Client roles |
| GET | `/admin/realms/{realm}/groups` | List groups |
| PUT | `/admin/realms/{realm}/users/{userId}/groups/{groupId}` | Add user to group |

**POST and DELETE role mapping requests typically accept arrays of RoleRepresentation** with at least role `id` and `name`. Confirm against the deployed 26.8.0 contract and SDK types before coding.

### Keycloak administration authentication

- Create a **dedicated confidential Client** for backend management, e.g. `management-service` (example, not confirmed existing).
- Enable client authentication/service accounts and assign only necessary admin privileges via appropriate administrative roles/policies.
- Use the OAuth2 `client_credentials` grant server-side for backend calls.
- **Separately** configure interactive user login (OIDC Authorization Code + PKCE or secure Next.js BFF pattern). A backend service-account token is **not** a substitute for authenticating the human administrator.
- Verify JWT issuer, audience, signature, expiry, and access-control policy before any admin request.
- Never send client secrets or privileged service tokens to browsers.

Suggested environment variables (names are proposals; do not assume already created):

```dotenv
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=<YOUR_REALM_NAME>
KEYCLOAK_ADMIN_CLIENT_ID=management-service
KEYCLOAK_ADMIN_CLIENT_SECRET=<SECRET_STORED_LOCALLY>
```

For the management UI's OIDC login, additional public client IDs / callback URLs / session-related secrets may be needed after choosing a specific auth adapter. No secret values belong in tracked source files.

**Docker networking:** `localhost` inside the **Next.js runtime container** is not the host or Keycloak Container. If Next.js later runs in Docker, configure a reachable internal hostname/service and ensure browser-visible issuer/callback URLs are consistent.

### Reference links

- REST reference: https://www.keycloak.org/docs-api/latest/rest-api/index.html
- Keycloak docs: https://www.keycloak.org/documentation
- Official JS Admin Client source: https://github.com/keycloak/keycloak/tree/main/js/libs/keycloak-admin-client
- shadcn dashboard block: https://ui.shadcn.com/blocks?category=dashboard
- Next.js App Router: https://nextjs.org/docs/app

The user previously supplied a `Pasted text.txt` containing an extensive copy of the Keycloak Admin REST API documentation (Users, Clients, Client Role Mappings, etc.). That **was documentation, not executable project code**. Do not assume it exists inside the local repository.

---

## 7. UI/UX starter and MVP screens

UI choice is **shadcn `dashboard-01`** with **Base UI / Nova** preset. Reuse the existing generated sidebar, table, charts, header, and reusable components instead of replacing them wholesale. Do not introduce a second component library or a different authentication vendor.

Suggested navigation:

```text
KEYCLOAK MANAGEMENT
├── Dashboard
├── Identity Management
│   ├── Users
│   └── Groups (after core MVP)
├── Applications
│   ├── Clients
│   └── Client Roles
├── Access Management
│   ├── User Permissions
│   └── Admin Management
└── Settings (later)
```

Core screens, in preferred implementation order:

1. **Login** — Keycloak interactive OIDC flow.
2. **Dashboard** — number of real users/Clients and relevant role summaries (after securing route).
3. **Users** — search, pagination, basic profile, user creation, status; real data.
4. **Clients** — all Clients in configured Realm; identify internal vs display IDs.
5. **User Access** — select a person and Client, view direct/effective roles, assign/revoke authorized roles.
6. **Platform Admin Management** — Super Admin can promote/demote with explicit confirmation and safety checks.
7. **Custom Role Management** — optionally create/reuse Client Roles; avoid arbitrary role grants to unauthorized caller.

UI components should reflect permissions, but **API authorization is mandatory**. Display permission errors appropriately; don't claim success until SDK operations return successfully and readback verification is complete.

### Example user stories / acceptance tests

- As a `platform-user`, when I open an admin write API directly, I receive **403**.
- As a Super Admin, I can list real Keycloak Users in the configured Realm with pagination.
- As a Super Admin, I can see existing Clients and Roles for a selected Client.
- As a Super Admin, I can assign `LMS:user` to Youssef; Dashboard/Projects mappings are unchanged.
- When replacing direct `LMS:admin` with `LMS:user`, the old direct assignment is removed, and effective permissions are re-checked for inheritance.
- I can distinguish direct vs inherited roles; the UI does not falsely claim access was removed when it persists through a group/composite.
- Every new account created by the normal flow starts as `platform-user`, except explicit authorized bootstrap or special creation flow.
- An Admin cannot promote themselves or any person to `platform-super-admin`.
- The last active Super Admin cannot be accidentally removed by standard operations.
- Keycloak/SDK connection errors give actionable server-side logs without leaking secrets.

---

## 8. Recommended near-term implementation plan

**Do not skip the integration-test stage and jump directly into privileged role mutation.** Progress one verifiable slice at a time.

### Stage 0 — Inspect repository and local services (next action)

On the user's machine:

```bash
cd ~/Desktop/keycloak-management
pwd
cat package.json
find app components lib -maxdepth 2 -type f | sort | head -n 120
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

The Docker Container name and actual port have **not yet been provided**. Do not assert Keycloak is reachable at 8080 until tested.

If the port is 8080, optionally use the **existing** public OIDC endpoint without credentials:

```bash
curl -i http://localhost:8080/realms/master/.well-known/openid-configuration
```

After confirming the actual Realm name, verify that Realm's discovery endpoint. Keep `master` only as a diagnostic example; the app's target Realm is configurable.

### Stage 1 — Create DDD core skeleton

Implement first the `users` Domain/Application/Infrastructure port/adapter and one small read-only use case. Don't create all planned module directories and placeholder files if unneeded yet. Keep files focused and independently testable.

Suggested initial files:

```text
modules/users/domain/user.type.ts
modules/users/domain/user.repository.ts
modules/users/application/list-users.usecase.ts
modules/users/infrastructure/keycloak-user.repository.ts
lib/infrastructure/keycloak-admin.client.ts
scripts/test-keycloak.ts
.env.local                 # never commit
```

### Stage 2 — Set up read-only Keycloak service-account access

1. Identify actual Realm and Keycloak base URL.
2. Create or inspect a backend management confidential Client.
3. Grant **read-only** admin privileges needed for Users/Clients queries, not blanket superuser privileges.
4. Store secret in `.env.local` or proper secret manager.
5. Connect via `@keycloak/keycloak-admin-client@26.8.0` from server code only.

Illustrative SDK pattern:

```ts
import KcAdminClient from "@keycloak/keycloak-admin-client";

export async function createKeycloakAdminClient() {
  const kc = new KcAdminClient({
    baseUrl: process.env.KEYCLOAK_URL!,
    realmName: process.env.KEYCLOAK_REALM!,
  });

  await kc.auth({
    grantType: "client_credentials",
    clientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID!,
    clientSecret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET!,
  });

  return kc;
}
```

Validate env variables and handle authentication failures rather than relying only on non-null assertions in production. This pattern is illustrative and **not confirmation the file already exists**.

### Stage 3 — Integration test on local Keycloak

- Query first 10 real users and Clients **read-only** using a local script.
- Test pagination, Client lookups, nonexistent users, and forbidden service-account permissions.
- For each Client Role Mapping, resolve Client **UUID** and user **ID**.
- Avoid changing real users during initial smoke tests.

### Stage 4 — OIDC login and server authorization

- Configure a dedicated UI OIDC Client; use Authorization Code Flow with PKCE (or server-side BFF handling where applicable).
- Implement server session and permission guard.
- Provision first Super Admin via a secure bootstrap/admin procedure, not public self-registration.
- Guard every admin route before activating privileged SDK calls.

### Stage 5 — Connect Starter Dashboard and Users/Clients lists

- Replace starter `data.json` only when a secured data flow is ready.
- Implement loading/error/empty states with shadcn components.
- Use pagination and avoid unnecessarily retrieving all users in one request.

### Stage 6 — Role Mapping mutations on test accounts

- Make write operations role-scoped and allowlisted.
- Test on disposable users/Clients in an isolated test Realm or dedicated test data, not actual production identities.
- Verify ADD/REMOVE and effective role mappings, including inherited access.
- Protect changes to platform admin roles and last Super Admin.
- Record administrator, target, Client, before/after mappings and result in an audit trail.

### Stage 7 — Finalize MVP and validation

- Run unit tests for Domain/Application without Keycloak.
- Run integration tests against local Keycloak.
- Run `npm run build` and `npm audit --omit=dev`; review full `npm audit` separately.
- Confirm role visibility, correct UI navigation, no secret leakage, and no access beyond authorized scope.

---

## 9. Commands and development workflow

```bash
cd ~/Desktop/keycloak-management
npm run dev               # local Next.js development
npm run build             # production build and TypeScript check
npm audit --omit=dev      # current production dependency audit
npm audit                 # full dependency audit including development tooling
npm ls shadcn --depth=0
```

Local dashboard route from CLI: `http://localhost:3000/dashboard` (port may change if 3000 is occupied).

Useful diagnostic commands:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
npm pkg get dependencies.shadcn devDependencies.shadcn
npm ls braces --omit=dev
npm explain braces
```

Don't run `npm audit fix --force`, downgrade `shadcn`, or recreate the Next.js project as a first response to dependency warnings. The baseline build already passed.

### Coding workflow for the agent

1. **Inspect first**, then propose the smallest change that advances a concrete user story.
2. Preserve installed Base UI/Nova/shadcn starter assets and Next.js conventions.
3. Follow DDD dependency boundaries and inject infrastructure behind ports.
4. Do not commit `.env.local` or print sensitive tokens/secrets in logs.
5. Validate and authorize every mutation on the server.
6. Use real Keycloak integration for actual read/write operations; do not silently replace failures with mock success.
7. Test changed code; report tests actually run and any unverified behavior.
8. Explain each completed phase and the next practical step clearly and succinctly.

---

## 10. Critical decisions / open items

| Question | Current state / safe default |
|---|---|
| Realm name | Not supplied; configurable via environment, never hard-coded |
| Multiple Realms | Not in initial MVP; scope first to one configurable Realm |
| Existing Keycloak Docker port/name | Unconfirmed; inspect with `docker ps` |
| Existing service account/client secret | Unconfirmed; create/read only when authorized |
| Super Admin bootstrap | Must be performed securely by an existing authorized Keycloak administrator |
| Platform role placement | Choose one dedicated canonical model (management Client roles or Realm roles) and document it |
| Admin delegation | Fine-grained target/actions not yet specified; default deny unauthorized writes |
| Per-Client default `user` roles | Not automatically established; define if/when clients need them |
| Groups / inherited permissions | Must be considered for effective role calculations |
| Extra database | No for initial identity/role operations; audit persistence may require one later |
| UI authentication adapter | To select; must integrate Keycloak, not Clerk or another identity provider |
| Keycloak host/issuer for deployment | Verify against real environment; distinguish browser-facing and service connectivity |

---

## 11. Bottom-line handoff

**The user's latest confirmed achievement** is a working Next.js **16.4.1** build with a **shadcn dashboard-01/Base UI/Nova** scaffold, **Keycloak Admin Client 26.8.0** installed, and the latest production dependency audit reporting **zero vulnerabilities**. The project is **not yet connected** to the Keycloak server.

**Next concrete implementation target:** inspect the existing repository, confirm the local Keycloak Docker endpoint and actual Realm name, create the small DDD `users` read path, then run a **read-only local integration test** listing users from the configured Realm. Only after that, build authentication/authorization guards and controlled Client Role Mapping mutations.

**Never revert to an assumed hard-coded `realm-x` or accidentally interpret multiple Clients as multiple Realms.** This is the key product clarification from the conversation.
