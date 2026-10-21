# Implementation — Feature Index

**Last reviewed:** 2026-10-21. The repository root is the single active Vuexy Starter Kit application; the former shadcn application is absent from the active tree and recoverable from the verified Git snapshot. This document is the concise implementation index. Detailed requirements, task checklists and sanitized evidence belong in a feature document once that feature enters active planning. Project-wide architecture, shared API conventions and current summary evidence remain in the [architecture](../architecture/architecture.md), [API](../api/api.md) and [project status](../report/project-status.md) documents.

## Development workflow

Every feature follows the same gates. A later phase must not be treated as approved merely because it appears in this index.

| Phase | Required outcome | Exit gate |
| --- | --- | --- |
| **1. PLAN** | Scope, endpoints, permissions, expected responses, negative cases and acceptance criteria | User reviews the feature plan |
| **2. POSTMAN FIRST** | Real requests against the approved local target with sanitized actual results | User confirms the evidence; no application code or `.env.local` changes |
| **3. IMPLEMENTATION PLAN** | Exact DDD, authorization, API, test and UI changes | User explicitly approves implementation |
| **4. APPLICATION INTEGRATION** | Approved Domain/Application/Infrastructure work, protected server API and UI integration | Authentication, authorization and relevant tests pass |
| **5. VERIFY & DOCUMENT** | Automated/end-to-end results and accurate documentation updates | Only owning documents are updated; no duplicated evidence |

## Feature index

| Feature | Current status | Feature documentation | Next gate |
| --- | --- | --- | --- |
| Users | **PARTIAL — read-only List/Count DDD verified in the root Vuexy app** | [Users](users/users.md) | Wait for approval to plan human OIDC/session, RBAC and a protected Users API |
| Authentication and Sessions | **BLOCKED — planning required** | No dedicated feature document yet | Approve human OIDC/session scope before planning browser integration |
| Platform Admin Roles and RBAC | **BLOCKED — planning required** | No dedicated feature document yet | Decide role representation, delegation and bootstrap safeguards |
| Clients | **PLANNED** | No dedicated feature document yet | Begin read-only endpoint and permission planning after the Users gate |
| Client Roles | **PLANNED** | No dedicated feature document yet | Resolve Client UUID workflow and plan read-only verification |
| Access and Role Mappings | **BLOCKED** | No dedicated feature document yet | Plan direct/effective reads; writes additionally require RBAC, audit and explicit approval |
| Dashboard Integration | **BLOCKED — Vuexy scaffold only** | No dedicated feature document yet | Wait for human authentication, server authorization and protected APIs |

Only Users has entered active feature-document tracking. Do not create placeholder documents for the other rows.

## Deferred scope

| Feature | Status and prerequisite |
| --- | --- |
| Groups | **DEFERRED** — requires approved scope and Postman read evidence |
| Audit Logging | **DEFERRED**, but mandatory before privileged write operations |
| User Mutations | **DEFERRED** — requires approved synthetic targets, Postman evidence, RBAC, audit and explicit write authorization |
| Client or Role Mutations | **DEFERRED** — requires least-privilege scope, confirmation, audit and separate approval |
| Multi-Realm Management | **DEFERRED** — requires separate architecture and security approval |
| Production Deployment | **DEFERRED** — requires HTTPS, production Keycloak/DB, secret management, backups and monitoring |

## Status meanings

- **PARTIAL:** some source or evidence exists, but the feature is not complete end to end.
- **PLANNED:** documented as future work; no implementation or runtime success is implied.
- **BLOCKED:** a required security, evidence or approval gate is missing.
- **DEFERRED:** intentionally outside the current implementation sequence.

The Vuexy root promotion and [Users Count DDD slice](users/users.md) are complete. Stop before another feature or browser/API integration; human authentication and server-side authorization require a separately approved plan.
