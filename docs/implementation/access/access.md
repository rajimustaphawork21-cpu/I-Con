# Access and RBAC — Phase 2 Feature Record

- **Current status:** **IMPLEMENTED and automated-verified for Users List/Count**
- **Last reviewed:** 2026-10-26
- **Scope:** Current human caller authorization for read-only Users operations in one configured Realm

## Policy

Only exact, direct Client Roles from the configured human OIDC Client (`management-web` in development) participate in the current policy.

| Direct role | Users List | Users Count |
| --- | --- | --- |
| `user` | DENY | DENY |
| `admin` | ALLOW | ALLOW |
| `super-admin` | ALLOW | ALLOW |
| Missing or unknown | DENY | DENY |

Realm roles, roles from other Clients, group mappings, composite/effective roles and frontend flags are ignored. The Domain policy is pure and default-deny.

## DDD implementation

```text
modules/access/domain/
  permission-policy.ts              # exact permission matrix
  access.repository.ts              # subject access port
modules/access/application/
  authorize-permission.usecase.ts   # enabled-subject + policy enforcement
modules/access/infrastructure/
  keycloak-access.repository.ts     # Admin SDK adapter
```

For each protected operation the adapter:

1. Uses the trusted encrypted-session `sub`; no username or browser role flag is accepted.
2. reads `/admin/realms/{realm}/users/{subject}` and denies missing or disabled users;
3. resolves the configured human Client by `clientId` and requires exactly one valid internal UUID;
4. reads only `/users/{subject}/role-mappings/clients/{clientUuid}` direct mappings;
5. validates role representations and fails closed on malformed or unavailable upstream data.

`ListUsersForSubjectUseCase` and `CountUsersForSubjectUseCase` authorize before delegating to the existing Users use cases. A denial or resolution failure therefore cannot invoke Users List or Count.

## Security behavior

- Public Auth.js sessions remain name + expiry only. Roles, `sub` and OAuth tokens are not exposed through `/api/auth/session`.
- The server reads `sub` from the encrypted HttpOnly session cookie and revalidates the existing 30-minute inactivity and 8-hour absolute limits.
- The service account remains a machine credential and never substitutes for human authorization.
- Access resolution and Users reads use the server-only Admin SDK. Raw SDK errors, secrets and tokens are not logged or serialized.
- Missing/expired human session returns 401 JSON from Users APIs. Authenticated denial returns 403. Resolution or Keycloak outage returns safe 503.
- No Keycloak configuration or write operation was performed.

## Verification

The 2026-10-26 root suite passed 113/113 tests, including the role matrix, `test.ali` denial, `test.sara`/`test.youssef` allowance, missing/unknown roles, disabled/deleted users, Realm/other-client isolation, fail-closed resolution, and proof that denied operations do not invoke Users repositories.

Manual Phase 2 Postman verification was reported complete before implementation. No live browser, authenticated application API or fresh Keycloak SDK integration test was run during this implementation turn, so no such pass is claimed.

## Compatibility boundary

The configured runtime is Keycloak 24.0.4 and the Admin SDK is 26.8.0. The mismatch is accepted only for the manually tested read-only endpoints used by this phase: User details, Client lookup, direct Client Role mappings, Users List and filtered Count. It is not evidence for other SDK operations or any write.

## Next gate

General access-management screens, role assignment and every mutation remain unapproved. They require new endpoint-specific Postman evidence, a write-capable permission matrix, durable audit design, privilege-escalation safeguards and explicit authorization.
