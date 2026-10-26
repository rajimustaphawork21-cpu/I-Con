# Project Status — Keycloak Management

**Last updated:** 2026-10-26. This is the concise project-wide summary; feature detail and evidence live in the linked implementation records.

## Current snapshot

The repository root is the single active Vuexy Next.js application. Human Keycloak authentication/session management and the first server-authorized administrative feature—read-only Users List/Search/Pagination and filtered Count—are implemented. The Users Vuexy page, navigation and protected JSON APIs are present and the full automated suite passes.

| Area | Status |
| --- | --- |
| Vuexy root application | **IMPLEMENTED; VERIFIED BUILD** |
| Phase 1 human OIDC/session/logout | **IMPLEMENTED; REGRESSION VERIFIED** |
| Phase 2 Users Read RBAC | **IMPLEMENTED; AUTOMATED VERIFIED** |
| `GET /api/users` and `/api/users/count` | **IMPLEMENTED; AUTOMATED VERIFIED** |
| `/users` Vuexy UI and navigation | **IMPLEMENTED; AUTOMATED STATE VERIFIED** |
| Live browser/API smoke for Phase 2 | **NOT RUN in this implementation turn** |
| Users or Role writes | **UNAPPROVED / NOT IMPLEMENTED** |
| Clients, general Role management, Groups, Audit | **PLANNED or DEFERRED** |
| Multi-Realm | **DEFERRED** |

## Technical baseline

| Component | Current value |
| --- | --- |
| Host environment | Windows 11 project environment; Ubuntu workspace used for automated verification |
| Active application | Vuexy MUI Next.js Starter Kit 5.0.1 at repository root |
| Next.js / React | 16.4.2 / 19.2.3 |
| TypeScript / MUI | 5.9.3 / 7.3.6 |
| Package manager | pnpm 10.18.3 |
| Human OIDC | Auth.js 4.24.15 with `management-web` |
| Admin infrastructure | `@keycloak/keycloak-admin-client` 26.8.0 with `management-service` |
| Keycloak runtime | Docker Keycloak 24.0.4; configured Realm (`company-dev` in local development) |
| Branch | `migration/vuexy-starter-kit` |

The Keycloak 24.0.4 / Admin SDK 26.8.0 mismatch is accepted only for the read-only endpoints manually verified for this phase. It does not establish compatibility for any other SDK operation or write.

## Security boundary

- Public sessions expose only display name and expiry. The encrypted cookie retains the trusted subject and server-controlled lifetime claims; roles and OAuth tokens are not public session fields.
- The Access Domain policy allows Users List/Count only for exact direct `management-web` roles `admin` and `super-admin`; `user`, unknown and missing roles deny.
- Every request verifies that the Keycloak subject still exists and is enabled, then reads only direct role mappings for the configured human Client.
- Realm roles, other-client roles, group/composite roles and frontend permission flags are ignored.
- Authorization occurs before Users List/Count. Denial and role-resolution failure cannot invoke the Users repository.
- Users responses are allowlisted, safe-error mapped and `Cache-Control: no-store`; Keycloak outages fail closed.
- Service credentials, service tokens and OIDC tokens remain server-only and are neither logged nor returned.

## Verification — 2026-10-26

| Command | Result |
| --- | --- |
| `pnpm test` | **PASS — 113/113** |
| `pnpm exec tsc --noEmit` | **PASS** |
| `pnpm lint` | **PASS** |
| `pnpm build` | **PASS — Next.js 16.4.2 Turbopack; all expected routes generated** |
| `git diff --check` | **PASS** |

The build needed network access for Vuexy's existing `next/font` Public Sans download. No live Keycloak request, browser automation, Docker change, Keycloak configuration change or Keycloak write was performed during implementation.

## Feature records

- [Authentication and Sessions](../implementation/authentication/authentication.md)
- [Access and RBAC](../implementation/access/access.md)
- [Users Read](../implementation/users/users.md)
- [API contracts and Postman conventions](../api/api.md)

## Next gate

An optional live smoke may verify the three existing synthetic identities against the new application APIs/UI with sanitized evidence. Do not begin Users CRUD, role assignment, general access management or another administrative feature without its own plan, endpoint-specific Postman evidence and explicit approval. Writes additionally require durable audit and privilege-escalation safeguards.
