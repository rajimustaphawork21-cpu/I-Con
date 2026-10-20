# Users — Feature Documentation

- **Current status:** **PARTIAL — read-only DDD List and Count verified; application integration blocked**
- **Last reviewed:** 2026-10-20
- **Scope:** read-only Users work for one configured Realm

This document owns Users-specific requirements, task progress and sanitized verification evidence. Shared request conventions remain in the [API document](../../api/api.md), durable boundaries in [architecture](../../architecture/architecture.md), feature navigation in the [implementation index](../implementation.md), and the concise project-wide state in [project status](../../report/project-status.md).

## 1. Feature Overview

The Users feature will let an authorized human administrator view, search, paginate and count Keycloak users in the application's one configured active Realm. The read-only List and Count DDD paths are implemented and verified against the configured local service-account connection.

The current code is a read-only backend DDD slice. It is not a completed browser feature: there is no human login, session, platform RBAC, protected application API or live Users Dashboard. `company-dev` is the observed local test Realm, not a reusable application constant.

User creation, updates, deletion, enable/disable operations, password management and Role assignment are outside the current slice. They remain unapproved Keycloak writes.

## 2. Current Status

| Capability | Status | Evidence |
| --- | --- | --- |
| User Domain type and repository List/Count contract | **IMPLEMENTED** | [`user.type.ts`](../../../modules/users/domain/user.type.ts) and [`user.repository.ts`](../../../modules/users/domain/user.repository.ts) |
| List/Search/Pagination use case | **IMPLEMENTED** | [`list-users.usecase.ts`](../../../modules/users/application/list-users.usecase.ts) validates and normalizes the query |
| Count use case | **IMPLEMENTED** | [`count-users.usecase.ts`](../../../modules/users/application/count-users.usecase.ts) delegates through the Domain port |
| Keycloak List/Count adapter | **IMPLEMENTED** | [`keycloak-user.repository.ts`](../../../modules/users/infrastructure/keycloak-user.repository.ts) uses the configured Realm, maps minimal fields and validates Count results |
| Automated source tests | **VERIFIED** | 28/28 individual cases passed on 2026-10-20; the original 18 List/configuration cases remain passing |
| Service-account access token | **HISTORICAL PASS** | Postman returned HTTP 200 on 2026-10-19; token was not retained in documentation |
| Empty Users list | **HISTORICAL PASS** | Postman returned HTTP 200 with JSON `[]` on 2026-10-19 |
| Users read-only Postman suite | **USER-REPORTED PASS** | User reports the suite completed; request-by-request sanitized results were not supplied in this handoff |
| Normal SDK client-credentials List | **VERIFIED** | Read-only integration returned 3 records on 2026-10-20 with the test-token override unset |
| Normal SDK client-credentials Count | **VERIFIED** | Read-only integration returned a total of 3 on 2026-10-20 with the configured Realm |
| Human login, session and platform RBAC | **NOT IMPLEMENTED** | No auth module, session flow or authorization policy exists |
| Protected Users application API | **NOT IMPLEMENTED** | No Users `app/api/**` Route Handler exists |
| Live Users Dashboard | **NOT IMPLEMENTED** | The existing Dashboard still uses demo data |

The live SDK results verify the configured machine credential's current read path only. They do not prove human authorization, protected application APIs or Dashboard integration.

## 3. Functional Requirements

- [x] Represent only the current minimal User fields: `id`, `username`, `enabled`, and optional `email`.
- [x] Read the Realm from server configuration; never hardcode `company-dev` in reusable feature code.
- [x] List users using `first`, `max`, and optional `search` inputs.
- [x] Require `first` to be a safe integer from 0 through 2,147,483,647.
- [x] Require `max` to be an integer from 1 through 100.
- [x] Trim search input, omit blank search, and reject values longer than 256 characters.
- [x] Map Keycloak responses to the minimal Domain representation and raise sanitized mapping errors for malformed records.
- [x] Return a Users count through the Domain repository, `CountUsersUseCase`, and Keycloak infrastructure adapter.
- [ ] Require an authenticated human session and server-side authorization before exposing Users through an application API.
- [ ] Return safe DTOs and error responses without service tokens, secrets, raw SDK errors or unnecessary personal data.
- [ ] Integrate real Users into the existing Dashboard only after the protected server API is ready.

## 4. Keycloak REST API Endpoints

The shared endpoint catalog and Postman conventions live in the [API document](../../api/api.md#keycloak-admin-rest-endpoint-directory). This feature currently depends on:

| Purpose | Method and path | Current evidence |
| --- | --- | --- |
| Service token | `POST /realms/{realm}/protocol/openid-connect/token` | Historical HTTP 200 |
| List users | `GET /admin/realms/{realm}/users?first={first}&max={max}` | Postman suite user-reported complete; live SDK returned 3 records |
| Search users | `GET /admin/realms/{realm}/users?first={first}&max={max}&search={search}` | Postman suite user-reported complete; granular result not supplied here |
| Paginate users | `GET /admin/realms/{realm}/users?first={first}&max={max}` | Postman suite user-reported complete; granular result not supplied here |
| Count users | `GET /admin/realms/{realm}/users/count` | Postman suite user-reported complete; DDD and live SDK Count verified at 3 |

User Details and every Users mutation are outside this active feature slice. Listing an endpoint in shared documentation is not proof that it was tested or authorized.

## 5. Required Permissions

- The backend machine credential is the confidential `management-service` service account, not a human login.
- Historical configuration showed direct `realm-management:view-users` and `query-users` mappings. The configured service account successfully executed current List and Count reads, but effective/inherited Roles and the final least-privilege policy remain unaudited.
- A successful token request proves client authentication only; each Users endpoint must be verified independently.
- Do not grant broad `realm-admin` or `manage-users` as a shortcut.
- Before application integration, the human caller needs a separate OIDC identity, a validated server session and an approved platform permission checked server-side.
- No service secret or access token may enter browser code, screenshots, committed files or shared Postman exports.
- No Users write is permitted without separate, operation-specific approval for synthetic targets in the isolated development Realm.

## 6. Phase 1 — Planning Tasks

- [x] Define the current slice as read-only List/Search/Pagination with Count planned separately.
- [x] Identify the Keycloak token, Users list/search/pagination and Count endpoints.
- [x] Record expected successful response shapes without treating them as actual results.
- [x] Record negative authentication cases and safe evidence rules.
- [x] Confirm the existing Modular DDD boundaries and reusable source files.
- [x] Separate the human authorization model from service-account permissions.
- [x] Exclude User mutations from the current authorization scope.
- [x] Confirm a populated approved test dataset through the user-completed Postman suite and live aggregate SDK result of 3; no identifiers were recorded.
- [x] Receive explicit approval in this task to implement and verify the Users Count DDD slice.

## 7. Phase 2 — Postman Tests and Results

### Sanitized evidence

| Date | Request | Actual result | Classification and limitation |
| --- | --- | --- | --- |
| 2026-10-19 | `POST /realms/company-dev/protocol/openid-connect/token` | HTTP 200 | **HISTORICAL PASS** from a user-supplied screenshot; token redacted; does not prove endpoint authorization |
| 2026-10-19 | `GET /admin/realms/company-dev/users?first=0&max=10` | HTTP 200, JSON `[]` | **HISTORICAL PASS** from a user-supplied screenshot; no populated behavior verified |
| 2026-10-20 | Users read-only Postman suite | Completed successfully | **USER-REPORTED PASS**; request-by-request sanitized statuses and response shapes were not supplied in this handoff |
| 2026-10-20 | Configured service-account SDK List | 3 records returned | **VERIFIED** by `env -u KEYCLOAK_TEST_ACCESS_TOKEN npm run test:keycloak`; no user records, token or secret printed |
| 2026-10-20 | Configured service-account SDK Count | Total of 3 | **VERIFIED** by the same read-only run using the configured Realm |

### Test checklist

- [x] User reports that the approved synthetic Users dataset and read-only Postman suite were completed successfully.
- [x] No agent-created Keycloak data or other Keycloak write was performed while implementing Count.
- [x] Populated List was included in the user-reported Postman suite; the live SDK List independently returned 3 aggregate records.
- [x] Count was included in the user-reported Postman suite; the live SDK Count independently returned the numeric total 3.
- [x] Search for the approved synthetic data was included in the user-reported suite; detailed match output was not supplied and is not invented here.
- [x] Two-page Pagination was included in the user-reported suite; detailed page membership/order was not supplied and is not invented here.
- [x] Missing, invalid and expired-token checks were included in the user-reported suite; individual observed statuses were not supplied and are not invented here.
- [ ] Test insufficient permission only if an approved restricted credential/setup already exists; HTTP 403 is expected, but do not create or alter credentials for this check without approval.
- [x] Record the supplied suite-level statement and live aggregate SDK results without Authorization headers, tokens, secrets, IDs, emails or usernames.
- [x] Receive explicit user approval to implement the Count DDD slice.

The Postman suite completion is user-reported; only the earlier HTTP 200 screenshots and the fresh aggregate SDK results have exact output recorded here. Use the shared [sanitized evidence format](../../api/api.md#sanitized-evidence-format) for any later request-level evidence.

## 8. Phase 3 — DDD Implementation Plan

### Existing implementation — preserve and extend

- [x] `modules/users/domain/user.type.ts` defines the minimal `User` type.
- [x] `modules/users/domain/user.repository.ts` defines `ListUsersQuery`, `UserRepository.list`, and `UserRepository.count`.
- [x] `modules/users/application/list-users.usecase.ts` validates, normalizes and delegates list queries.
- [x] `modules/users/application/count-users.usecase.ts` delegates Count through the Domain port.
- [x] `modules/users/infrastructure/keycloak-user.repository.ts` implements configured-Realm SDK List/Count reads, minimal User mapping and safe Count validation.
- [x] `lib/infrastructure/keycloak-admin.client.ts` contains configuration validation and the server-side `client_credentials` factory.
- [x] `scripts/test-keycloak.mjs` is the read-only List/Count integration composition root and prints aggregate results only.

### Count implementation completed in this approved slice

- [x] Extend `UserRepository` with the minimal `count(): Promise<number>` contract.
- [x] Implement `CountUsersUseCase` without duplicating List behavior.
- [x] Implement `KeycloakUserRepository.count` through `client.users.count({ realm: this.realmName })`.
- [x] Reject negative, fractional, non-finite, unsafe or non-number external Count results with a sanitized infrastructure error.
- [x] Preserve SDK/network errors for status-aware handling at the composition boundary; never substitute a false zero.
- [x] Add focused use-case and adapter tests while preserving every previous test.
- [x] Verify the normal SDK `client_credentials` path with `KEYCLOAK_TEST_ACCESS_TOKEN` explicitly unset; List and Count both returned 3.

### Remaining plan — requires separate approval

- [ ] Define the trusted-caller authorization contract and server composition needed before any application route calls the use cases.
- [ ] Present the exact authentication, authorization, protected API and UI plan for explicit user approval.

## 9. Phase 4 — Application Integration Tasks

- [ ] Implement approved human Authorization Code + PKCE/BFF/session handling with a separate human Client.
- [ ] Implement the approved platform role policy and default-deny server-side permission checks.
- [ ] Compose Users use cases only in server-only code.
- [ ] Add protected application endpoints for approved Users reads; do not accept an arbitrary browser-supplied Realm.
- [ ] Return safe validation, unauthenticated, forbidden and infrastructure error responses.
- [ ] Connect the existing shadcn Users table to the protected API with server pagination/search.
- [ ] Add loading, populated, empty, error and forbidden states.
- [ ] Add Count to the Dashboard only after the protected Count path is authorized and verified.
- [ ] Remove demo data only from the relevant view after the real authorized flow works.

All Phase 4 tasks are pending. The existing service account alone is not authorization to expose administrative data to a browser.

## 10. Phase 5 — Automated and End-to-End Tests

### Existing historical automated evidence

- [x] 10 `ListUsersUseCase` cases passed in the 2026-10-19 audit.
- [x] 3 `KeycloakUserRepository` cases passed in the 2026-10-19 audit.
- [x] 5 Keycloak configuration/factory cases passed in the 2026-10-19 audit.
- [x] The explicit non-isolated run passed 18/18 cases; typecheck and targeted DDD/infrastructure lint also passed in that audit.

### Current verification results and remaining tests

- [x] Add and run focused Count use-case and adapter tests, including invalid external results and infrastructure-error propagation.
- [x] Run `npm test`: 4/4 isolated test files passed on 2026-10-20.
- [x] Run `node --test --test-isolation=none tests/**/*.test.mjs`: 28/28 individual cases passed on 2026-10-20.
- [x] Run `npm run typecheck`: passed on 2026-10-20.
- [x] Run `npx eslint modules lib/infrastructure scripts tests`: passed on 2026-10-20.
- [x] Verify the normal service-account SDK read-only path: List returned 3 records and Count returned 3.
- [ ] Test protected API behavior for an authorized caller, unauthenticated 401, unauthorized 403, invalid query and sanitized infrastructure failure.
- [ ] Test that no secrets, tokens, raw SDK errors or excessive personal data appear in responses or logs.
- [ ] Run Dashboard end-to-end tests for populated, empty, search, pagination, loading, denied and error states.
- [ ] Update this document with actual results and keep project status to a concise summary.

Automated source tests do not prove current live Keycloak behavior, and Postman tests do not prove application authorization or UI behavior.

## 11. Blockers and Dependencies

| Blocker or dependency | Impact |
| --- | --- |
| Request-level sanitized Postman details were not supplied in this handoff | Suite completion is user-reported; exact per-request statuses must not be invented |
| Effective service-account permissions are not fully audited | Current List/Count reads work, but the complete least-privilege/effective Role set is not documented |
| Human OIDC/session and platform RBAC are absent | No administrative data may be exposed through browser APIs |
| No protected Users route or trusted-caller context exists | Dashboard integration remains blocked |
| Audit design is absent | Future privileged mutations remain blocked |
| Dashboard still imports demo JSON | There is no live Users UI to verify |

## 12. Next Action

The Users Count DDD slice is complete. Stop here and wait for separate approval to plan human OIDC sessions, platform RBAC and trusted server-side authorization. Those security boundaries must be designed and implemented before any protected Users application API or live Dashboard integration begins.
