# AGENTS.md — Keycloak Management

> **Agent entry point.** Keep this file short. Detailed project knowledge lives in the core documents under `docs/` and the relevant feature record under `docs/implementation/<feature>/`. Read the applicable documents before making changes.

## Project and documentation

- Project: existing `~/Desktop/keycloak-management` on Ubuntu; do not recreate it.
- Product: a secure custom Keycloak administration UI, initially **one configurable Realm containing many application Clients**.
- Active application: the repository root is the Vuexy Next.js Starter Kit application. Run application, build, lint, tests and SDK checks from the repository root.
- Architecture: **Modular DDD**, with `modules/<feature>/domain/`, `application/`, and `infrastructure/`. Preserve existing boundaries and the Vuexy MUI layout, navigation, theme and providers.
- Reference UI: `resources/full-version/` is commercial Vuexy source for local reference only. Do not compile it, import it wholesale, publish it, or assume redistribution rights.
- Source of truth: actual files/current runtime first; dated audit and screenshots are historical evidence, not a substitute for verification.

Read in this order:

1. [`docs/architecture/architecture.md`](docs/architecture/architecture.md) — product model, DDD rules, security, actual structure.
2. [`docs/report/project-status.md`](docs/report/project-status.md) — what exists, evidence level, tests, blockers.
3. [`docs/implementation/implementation.md`](docs/implementation/implementation.md) — concise feature index, statuses and phase gates.
4. [`docs/api/api.md`](docs/api/api.md) — Keycloak REST operations and Postman test procedure.
5. The relevant feature record, currently [`docs/implementation/users/users.md`](docs/implementation/users/users.md) for Users — feature-specific requirements, tasks and sanitized evidence.

## Mandatory development sequence — never skip a gate

For **each feature**:

1. **PLAN:** describe user story, required permissions, endpoint(s), happy/negative tests and acceptance criteria.
2. **POSTMAN ONLY:** guide the user to test the actual Keycloak REST request in Postman. **Wait for the user's actual results**; record sanitized evidence. Do not edit application code or create `.env.local` during this phase.
3. **IMPLEMENTATION PLAN:** propose exact DDD file changes, secured API route, tests, UI reuse and risks. **Wait for approval**.
4. **IMPLEMENT:** extend existing code; auth and server-side authorization must exist before exposing administrative data through browser/API.
5. **VERIFY:** run applicable tests; record actual outputs and update only the documents that own the changed information **without duplicating content**.

Do not infer that Postman success proves SDK or Dashboard success.

## Non-negotiable constraints

- Keep `KEYCLOAK_REALM` configurable. `company-dev` is the observed **local development Realm**, not a business-code constant. Do not silently select `master`.
- Official `@keycloak/keycloak-admin-client` is **server-side infrastructure only**. Domain and Application must not depend on the SDK, React, or Next.js.
- Separate three permission systems: application Client Roles, human platform administration Roles, and service-account `realm-management` permissions.
- Authenticate and authorize the **human caller**; a service-account token is not a human session. Default-deny privileged operations.
- No browser exposure of service tokens or secrets. Never echo, commit, screenshot or paste secrets, access tokens, `.env.local`, or real user data.
- No Keycloak writes (including test-user creation, Roles, Clients, mappings) without explicit authorization for the specific operation and targets. Read-only testing is the current phase.
- No multi-Realm implementation, further architecture migration, new dependencies, mass rewrites, or git-history edits without authorization.
- Preserve uncommitted changes. Inspect `git status` before editing. Do not overwrite or delete user work.
- Report **verified / historical / implemented / planned / blocked** accurately. Do not mark work done merely because a file or document exists.
- Prefer small focused files; avoid extra folders or duplicated Service/Use Case logic when not justified.

## Current next action

The Vuexy root promotion and [`Users Count DDD slice`](docs/implementation/users/users.md) are implemented and verified from the repository root through the configured read-only service-account path. The former shadcn application is no longer present in the active working tree and remains recoverable from the verified Git snapshot. **Stop and wait for separate approval** to plan human OIDC/session security, platform RBAC and trusted server-side authorization. Do not create public Users APIs or connect Vuexy to live Users data before those controls are approved and ready; keep [`project-status.md`](docs/report/project-status.md) to a summary.
