# Implementation — Feature Index

**Last reviewed:** 2026-10-26. The repository root is the single active Vuexy Starter Kit application. This document is the concise implementation index. Detailed requirements, task checklists and sanitized evidence belong in the owning feature document.

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
| Users | **IMPLEMENTED — protected read-only List/Count APIs and Vuexy page; automated verification passed** | [Users](users/users.md) | Perform optional live browser/API verification; writes require a new approved phase |
| Authentication and Sessions | **IMPLEMENTED — Phase 1 verified and regression-tested** | [Authentication](authentication/authentication.md) | Preserve current login/session/logout behavior |
| Platform Admin Roles and RBAC | **IMPLEMENTED for Users Read only** | [Access/RBAC](access/access.md) | Define a new action/resource matrix before any additional feature or write |
| Clients | **PLANNED** | No dedicated feature document yet | Begin read-only endpoint and permission planning after the Users gate |
| Client Roles | **PLANNED** | No dedicated feature document yet | Resolve Client UUID workflow and plan read-only verification |
| Access and Role Mappings | **PARTIAL — current caller's direct management-web roles are read only for authorization** | [Access/RBAC](access/access.md) | General role-mapping UI/writes require separate planning, audit and approval |
| Dashboard Integration | **IMPLEMENTED for Users Read** | [Users](users/users.md) | Expand only after each feature's security gate |

Only implemented or actively evidenced features receive dedicated records; do not create placeholder documents for future rows.

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

Phase 2 Users Read and its scoped RBAC are complete in source and automated verification. Stop before Users mutations, general role management or another administrative feature; each requires its own plan, Postman evidence and explicit approval.
