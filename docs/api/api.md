# API & Postman — Shared Conventions

**Last reviewed:** 2026-10-26. This document owns shared Keycloak REST conventions, application API contracts, Postman mechanics and safe evidence rules. Feature-specific evidence lives in [Users](../implementation/users/users.md) and [Access/RBAC](../implementation/access/access.md). `company-dev` is a development value, not a reusable code constant.

## How to use Postman during a testing-only phase

### Local variables — private, not exported/synced

| Variable | Example / rule |
| --- | --- |
| `baseUrl` | `http://localhost:8080` |
| `realm` | `company-dev` (dev test only) |
| `clientId` | `management-service` |
| `clientSecret` | Private **Secret** value; never print or commit |
| `accessToken` | Short-lived local Bearer token; omit from screenshots/reports/exports |

Create a local Environment such as `Keycloak Local`. Secret values should remain private/local, not shared or included in exported collections. Never show Authorization headers or JWT values in screenshots. Postman variables are a development convenience, not long-term secrets storage.

### Step A — Token

```http
POST {{baseUrl}}/realms/{{realm}}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded
```

Body `x-www-form-urlencoded`: `grant_type=client_credentials`, `client_id={{clientId}}`, `client_secret={{clientSecret}}`. Postman request can use **No Auth** when credentials are in Body. Do not include `GET`/`POST` literal text inside the URL textbox; choose the method in the selector.

Optional **Scripts → Post-response**:

```javascript
const data = pm.response.json();
if (pm.response.code === 200 && data.access_token) {
  pm.environment.set("accessToken", data.access_token);
}
```

This stores a short-lived local variable; inspect the Postman Environment security/sync/export controls. Token success proves client authentication, **not** authorization for a feature endpoint. Record actual feature results only in the applicable feature document.

### Step B — Call the feature endpoint

For example, the current Users read-only feature uses:

```http
GET {{baseUrl}}/admin/realms/{{realm}}/users?first=0&max=10
Authorization: Bearer {{accessToken}}
```

Set Postman **Authorization → Bearer Token → `{{accessToken}}`**. If the response is 401, check whether the token is absent, invalid or expired. If it is 403, inspect the minimum relevant service-account permissions; do not grant `realm-admin` reflexively. The [Users feature document](../implementation/users/users.md#7-phase-2--postman-tests-and-results) owns the actual Users test matrix and results.

## Feature evidence ownership

Each active feature document owns its Postman checklist, expected outcomes and sanitized actual results. Do not duplicate a feature's progress matrix here.

- [Users Postman tests and results](../implementation/users/users.md#7-phase-2--postman-tests-and-results)
- [Access/RBAC implementation and compatibility record](../implementation/access/access.md)

## Sanitized evidence format

Update a feature document only after the user's actual response:

```markdown
- Date/time: <user-observed timestamp>
- Realm: <approved local test realm>
- Feature/request: <feature and sanitized method/path>
- Authorization: Service Account Bearer (token redacted)
- HTTP status: <observed>
- Response shape/count: <observed; no personal data or raw response object>
- Environment/permissions notes: <sanitized>
- Source: user-tested Postman screenshot or sanitized export
- Result: PASS / FAIL / BLOCKED
```

## Keycloak Admin REST endpoint directory

All paths below are **Keycloak** endpoints, not application `/api` routes. Substitute `{realm}` from configuration in app code and user-selected dev Environment in Postman.

| Feature | Method | Keycloak API path | Control / evidence owner |
| --- | --- | --- | --- |
| Users List/Search | GET | `/admin/realms/{realm}/users` | Read-only; see [Users](../implementation/users/users.md) |
| Users Count | GET | `/admin/realms/{realm}/users/count` | Read-only; see [Users](../implementation/users/users.md) |
| User Details | GET | `/admin/realms/{realm}/users/{userId}` | Read-only; requires a future approved feature scope |
| User Creation | POST | `/admin/realms/{realm}/users` | **Write unapproved** |
| User Update | PUT | `/admin/realms/{realm}/users/{userId}` | **Write unapproved** |
| Clients List/Lookup | GET | `/admin/realms/{realm}/clients?clientId={clientId}` or `/clients` | Future Clients feature planning |
| Client Details | GET | `/admin/realms/{realm}/clients/{clientUuid}` | Future Clients feature planning |
| Client Roles | GET | `/admin/realms/{realm}/clients/{clientUuid}/roles` | Future Client Roles feature planning |
| Client Role Details | GET | `/admin/realms/{realm}/clients/{clientUuid}/roles/{roleName}` | Future Client Roles feature planning |
| Direct User-Client mappings | GET | `/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUuid}` | Current caller authorization only; see [Access/RBAC](../implementation/access/access.md) |
| Effective User-Client mappings | GET | `/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUuid}/composite` | Future Access feature planning |
| Add direct Client Roles | POST | `/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUuid}` | **Write unapproved** |
| Remove direct Client Roles | DELETE | `/admin/realms/{realm}/users/{userId}/role-mappings/clients/{clientUuid}` | **Write unapproved** |
| Groups List | GET | `/admin/realms/{realm}/groups` | Deferred feature scope |
| Add Group membership | PUT | `/admin/realms/{realm}/users/{userId}/groups/{groupId}` | **Write unapproved** |
| Realms List | GET | `/admin/realms` | Multi-Realm out of MVP |

**Important:** In Admin REST routes a Client's `{clientUuid}` is the internal UUID, not the display `clientId` (`LMS`, `Dashboard`). Resolve it first through Clients list/filter. For role mappings, User ID is also internal. Direct mappings exclude some effective Group/composite roles. POST/DELETE role-mapping bodies normally contain RoleRepresentation arrays; verify exact deployed contract/version and approval before any use.

## Permissions and error diagnosis

Each feature document must record its historically observed permissions, the permissions still requiring verification, and the least-privilege decision for every endpoint. A token response alone does not prove endpoint authorization. Never grant broad administrative Roles as a shortcut to resolve a 403.

| HTTP | Typical cause / interpretation |
| --- | --- |
| 200 | Request succeeded; inspect returned JSON shape and counts |
| 201 / 204 | Possible successful write; never test without authorized write plan |
| 400 | Malformed request or unsupported query/body |
| 401 | No/invalid/expired token; rerun Token and verify URL/Realm |
| 403 | Token understood but operation lacks permission; verify scope/roles before change |
| 404 | Realm/User/Client/Role identifier missing or wrong, or endpoint incorrect |
| 405 | HTTP method/path mismatch (e.g. posting to wrong OIDC endpoint) |
| 5xx | Keycloak/server-side failure; report sanitized details |

An API's observed status always beats guesses in this table. Never document a request as tested merely because its endpoint is listed.

## Protected application API contracts

These Next.js routes are not Keycloak Admin REST endpoints. Both use the configured Realm and authenticate the human subject from the encrypted server session.

### `GET /api/users`

Query parameters:

| Name | Default | Validation |
| --- | --- | --- |
| `first` | `0` | integer from 0 through 2,147,483,647 |
| `max` | `10` | integer from 1 through 100 |
| `search` | omitted | trimmed; blank omitted; maximum 256 characters |

HTTP 200 response:

```json
{
  "users": [
    { "id": "...", "username": "...", "enabled": true, "email": "optional" }
  ],
  "pagination": { "first": 0, "max": 10 }
}
```

### `GET /api/users/count`

Accepts the same optional normalized `search` value and returns filtered Count:

```json
{ "count": 3 }
```

### Shared response behavior

| HTTP | Meaning |
| --- | --- |
| 400 | Unsupported, duplicate or out-of-bound query parameter |
| 401 | Missing, malformed or expired human session |
| 403 | Authenticated subject is missing, disabled or lacks a direct allowed `management-web` role |
| 503 | Safe fail-closed response for configuration, role-resolution or Keycloak read failure |

Every response uses `Cache-Control: no-store`. Success DTOs allowlist only minimal User fields or Count; errors never include raw SDK messages, roles, credentials or tokens.

## Application integration boundaries

Keycloak Admin REST paths are not application `/api` routes. Browser code never calls the Admin REST API with service credentials or receives a service token. The implemented Users routes authenticate and authorize the human caller, invoke authorized Application use cases and return minimized DTOs with safe error mapping.

The [Users feature document](../implementation/users/users.md) owns the current integration state. Project-wide implementation summaries belong in [project status](../report/project-status.md); actual feature evidence remains in the feature document.
