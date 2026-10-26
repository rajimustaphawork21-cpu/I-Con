# Users — Read-Only Feature Record

- **Current status:** **IMPLEMENTED and automated-verified end to end**
- **Last reviewed:** 2026-10-26
- **Scope:** Authenticated, authorized Users List/Search/Pagination and filtered Count for one configured Realm

## Feature outcome

Authorized `admin` and `super-admin` humans can open `/users` and read minimal Keycloak User data through protected application APIs. A `user`, missing/unknown role, disabled/deleted subject, expired session or access-resolution failure cannot reach the Users repository.

User creation, updates, deletion, enable/disable, password operations and Role assignment remain out of scope and unapproved.

## DDD implementation

```text
modules/users/domain/
  user.type.ts                         # minimal User entity
  user.repository.ts                   # List + filtered Count port
modules/users/application/
  user-query.validation.ts             # shared search normalization
  list-users.usecase.ts                # pagination/search validation
  count-users.usecase.ts               # filtered Count validation
  list-users-for-subject.usecase.ts    # authorize, then List
  count-users-for-subject.usecase.ts   # authorize, then Count
modules/users/infrastructure/
  keycloak-user.repository.ts          # configured-Realm Admin SDK adapter
```

The authorized wrappers depend on the separate [Access/RBAC slice](../access/access.md). Presentation and infrastructure are composed only in server code through `lib/infrastructure/users-read.composition.ts`.

## Functional requirements

- [x] List minimal fields: `id`, `username`, `enabled`, optional `email`.
- [x] Keep Realm server-configured; no request parameter can select a Realm.
- [x] Validate `first` from 0 through 2,147,483,647 and `max` from 1 through 100.
- [x] Trim optional search, omit blank values and reject more than 256 characters.
- [x] Apply the same normalized search to Count for correct filtered pagination.
- [x] Authenticate and authorize before every Users data operation.
- [x] Return safe 400/401/403/503 JSON and `Cache-Control: no-store`.
- [x] Exclude raw SDK data, roles, tokens, credentials and error details from responses.
- [x] Implement a Vuexy table with search, pagination, loading, empty, forbidden and retryable error states.
- [x] Add Users to vertical and horizontal navigation without treating navigation visibility as authorization.

## Application API

The shared contract is defined in [API conventions](../../api/api.md#protected-application-api-contracts).

| Route | Permission | Success |
| --- | --- | --- |
| `GET /api/users?first={n}&max={n}&search={optional}` | `users:list` | 200 minimal Users + pagination echo |
| `GET /api/users/count?search={optional}` | `users:count` | 200 filtered non-negative Count |

The API matcher bypasses the page redirect proxy only for `/api/users...`, allowing route handlers to return JSON 401. Dashboard pages retain normal `/login` redirects.

## Keycloak endpoints and historical evidence

| Purpose | Endpoint | Evidence |
| --- | --- | --- |
| Service token | `POST /realms/{realm}/protocol/openid-connect/token` | Historical HTTP 200; token never recorded |
| Users List/Search | `GET /admin/realms/{realm}/users` | User-reported Postman Phase 2 pass; earlier configured SDK List returned 3 aggregate records |
| Users Count | `GET /admin/realms/{realm}/users/count` | User-reported Postman Phase 2 pass; earlier configured SDK Count returned 3 |
| Current caller details | `GET /admin/realms/{realm}/users/{subject}` | User reports Phase 2 manual verification complete |
| Human Client lookup | `GET /admin/realms/{realm}/clients?clientId={configured}` | User reports Phase 2 manual verification complete |
| Direct human Client roles | `GET /admin/realms/{realm}/users/{subject}/role-mappings/clients/{clientUuid}` | User reports Phase 2 manual verification complete |

Granular sanitized Phase 2 Postman outputs were not supplied in this handoff and are not reconstructed. No live request was run during implementation.

## Automated verification — 2026-10-26

| Check | Result |
| --- | --- |
| `pnpm test` | **PASS — 113/113** |
| `pnpm exec tsc --noEmit` | **PASS** |
| `pnpm lint` | **PASS** |
| `pnpm build` | **PASS — Next.js 16.4.2 Turbopack** |

Coverage includes the RBAC matrix; no/expired session; `test.ali` 403; `test.sara` and `test.youssef` 200; missing, unknown, disabled and deleted subjects; Realm/other-client isolation; denial-before-repository; fail-closed outages; query/search/pagination boundaries; filtered Count; response allowlisting; Phase 1 auth regression; and Users page loading, forbidden, empty and error state resolution.

The production build generated `/users`, `/api/users` and `/api/users/count`. The build required network access only for Vuexy's existing `next/font` Public Sans download.

## Manual verification status

- No live browser session was exercised during this implementation turn.
- No authenticated live call to the new application APIs was made.
- No fresh SDK integration run against Keycloak was made.
- No Keycloak or Docker configuration and no data/Role/Client mapping was changed.

Accordingly, browser behavior and live Keycloak 24.0.4 application integration remain **not manually verified**, despite complete automated verification.

## Compatibility boundary

Keycloak 24.0.4 with Admin SDK 26.8.0 is an acknowledged mismatch. Current acceptance is limited to the manually tested read-only endpoints above. Build and mocked automated tests do not prove general cross-version SDK compatibility, and no write endpoint may rely on this acceptance.

## Next action

Optionally perform a sanctioned live browser/API smoke with the three existing synthetic identities and sanitized results. Stop before all Users writes or broader administration features; they require a new gate, explicit targets, Postman evidence, audit design and approval.
