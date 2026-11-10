This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Auth.js deployment origin

For local development and local production testing, set:

```env
AUTH_URL=http://localhost:3000
```

For deployment, replace it with the exact public HTTPS origin, for example
`AUTH_URL=https://icon.example.com`. Register the matching Keycloak redirect URI:
`https://icon.example.com/api/auth/callback/keycloak`.

When Next.js is behind a reverse proxy, set `AUTH_TRUST_HOST=true` only if all of the following are true:

- the proxy overwrites `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto`;
- clients cannot inject or append their own forwarding headers;
- the Next.js process is reachable only through that proxy.

Terminate TLS at the trusted proxy (or at Next.js), forward `X-Forwarded-Proto: https`, and use HTTPS for
the production Keycloak issuer and JWKS endpoint. Do not set `AUTH_TRUST_HOST=true` on a directly exposed
Next.js server with untrusted forwarding headers.

## Keycloak client-role claims

Portal authorization uses the exact Client Roles `OPS-N1`, `ADM-APP`, `AUD`, and `ADM-CONSOLE` from
`resource_access["icon-bff"].roles`. Realm Roles, roles belonging to other Clients, unknown roles, and
browser-provided values do not grant access. An authenticated user without one of these roles receives 403.

The preferred source is the ID token already validated by Auth.js. If that claim is absent, I-Con verifies
the access-token RS256 signature against the Realm JWKS and validates its issuer, subject, expiry, and
`azp=icon-bff` before reading the same Client Role claim. The subject must match the validated ID token.
Provider tokens are never returned in the Auth.js session. No Keycloak configuration is changed by this
repository.

## Keycloak SSO logout

I-Con uses Keycloak's discovered OIDC `end_session_endpoint` and sends an `id_token_hint`, the client ID,
and an exact post-logout return URI. The ID token is retained only inside the encrypted, HTTP-only Auth.js
session cookie and is never returned by `/api/auth/session` or passed to a client component.

In Keycloak Admin Console, open realm `I-Con`, then **Clients** > `icon-bff` > **Settings** >
**Logout settings**. Add this exact **Valid post logout redirect URI** for local production testing:

```text
http://localhost:3000/login
```

Do not use a wildcard. For a future deployment, add the exact HTTPS equivalent (for example,
`https://icon.example.com/login`) matching `AUTH_URL`. Keep the reverse-proxy requirements above in place.
This repository does not modify the Keycloak realm automatically.

## Read-only Keycloak user directory

The server-only user-directory adapter uses the official `@keycloak/keycloak-admin-client` SDK pinned to `26.8.0`,
matching the deployed Keycloak `26.8.0` server, together with a dedicated confidential Keycloak client. All current
MVP reads use SDK methods; no raw Admin REST fallback is required. For local development, create
`icon-directory-reader` in the `I-Con` realm with client authentication and service accounts enabled.
Disable browser flows for this client and grant its service account only the read roles needed for the Admin REST
user endpoints: `realm-management` client roles `query-users` and `view-users`. Do not grant `manage-users`,
`realm-admin`, or other write-capable roles.

Set these server-only variables in `.env` or `.env.local`:

```env
ICON_KEYCLOAK_ADMIN_URL=http://localhost:8080
ICON_KEYCLOAK_REALM=I-Con
ICON_KEYCLOAK_DIRECTORY_CLIENT_ID=icon-directory-reader
ICON_KEYCLOAK_DIRECTORY_CLIENT_SECRET=replace-with-the-directory-reader-client-secret
ICON_KEYCLOAK_REALM_MANAGEMENT_CLIENT_UUID=replace-with-the-internal-realm-management-client-uuid
ICON_KEYCLOAK_REALM_MANAGEMENT_CLIENT_UUID_VALIDATED=false
ICON_KEYCLOAK_REALM_MANAGEMENT_ROLE_VISIBILITY_VALIDATED=false
ICON_KEYCLOAK_REALM_ADMINISTRATION_ROLES=admin,create-realm
ICON_KEYCLOAK_REALM_ADMINISTRATION_ROLE_VISIBILITY_VALIDATED=false
ICON_KEYCLOAK_SSO_ADMINISTRATORS_GROUP_PATH=/Administrateurs-SSO
```

Never prefix these variables with `NEXT_PUBLIC_`. The service-account token is requested and consumed only by the
BFF. Directory access also requires an explicit trusted visibility scope: either a realm-wide scope approved by a
future server-side scope resolver, or a concrete set of approved Keycloak account IDs. The adapter never infers
realm-wide access from a missing or malformed scope.

These values are required for complete RG-37 account-protection resolution. The client UUID is Keycloak's internal
UUID for the built-in `realm-management` client, not its `clientId`. During privileged provisioning, resolve
`GET /admin/realms/I-Con/clients?clientId=realm-management`, require exactly one result, then verify
`GET /admin/realms/I-Con/clients/{uuid}` still has `clientId=realm-management`. Pin that UUID and set
`ICON_KEYCLOAK_REALM_MANAGEMENT_CLIENT_UUID_VALIDATED=true`. The BFF deliberately performs no runtime client
discovery. An absent validation attestation leaves that protection source unresolved.

`ICON_KEYCLOAK_REALM_ADMINISTRATION_ROLES` is the approved inventory of effective Realm roles that RG-37 treats as
administrative. The example contains the roles identified by the CDCF/CDCT; reconcile it with the approved IAM
inventory during provisioning. Use the exact value `[]` only when provisioning has explicitly approved an empty
Realm-administration role inventory. In that case, the resolver sets only the Realm-administration protection fact
to false without querying effective Realm-role mappings. A missing variable, a blank value, whitespace around `[]`,
or another malformed inventory leaves that fact unresolved. The group path must be the approved absolute Keycloak
path for `Administrateurs-SSO`.

Protection resolution reads the full user representation, effective `realm-management` client-role mappings,
effective Realm-role mappings, and complete group membership. With the directory-reader identity, provisioning must
verify that a known-positive client-role fixture and a known-positive approved Realm-role fixture are both visible
from their respective `/composite` endpoints before setting the corresponding `*_VISIBILITY_VALIDATED=true`
attestations. This is necessary because Keycloak 26.8 can return HTTP 200 with a filtered empty role list.

The directory reader needs read-only visibility of the `realm-management` client (for example, an exact fine-grained
read permission for that client, or the broader `view-clients`) and read visibility of the approved administrative
Realm roles. Keep `query-users` and `view-users`; do not grant `manage-users`, `manage-clients`, `realm-admin`, or
another write-capable role. Do not set either visibility attestation merely because the endpoint returns HTTP 200.
A failed or unvalidated source remains unresolved; a confirmed protected signal from another trusted source is
preserved. The BFF returns an unprotected result only after every required RG-37 source is conclusively false.

## Guarded user unlock BFF

`POST /api/users/{id}/unlock` accepts only `{ "confirmed": true }`. The BFF authorizes the operation from the
server-side Auth.js session, checks the trusted account scope before loading the target, reloads the user from
Keycloak, resolves RG-37 without the development read override, reads the current per-user brute-force status, and
then reapplies the complete Lot 1 policy. It never changes `enabled`, passwords, or Realm brute-force settings.

Live unlock is intentionally disabled: the repository has no durable append-only audit store or coordinator capable
of satisfying RG-46 and RG-47 across the Keycloak mutation. Until that dependency exists, the production route
returns `USER_UNLOCK_AUDIT_UNAVAILABLE` before constructing the write adapter or reading the target. Tests use an
in-memory coordinator only as a test double; it is not a production audit implementation.

After the durable audit design is approved and implemented, provision a separate confidential service-account
client such as `icon-user-unlocker`. Do not add write roles to `icon-directory-reader`. The server-only write adapter
expects `ICON_KEYCLOAK_USER_UNLOCK_CLIENT_ID` and `ICON_KEYCLOAK_USER_UNLOCK_CLIENT_SECRET`, in addition to the shared
admin URL and Realm variables. On Keycloak 26.8, the per-user brute-force delete checks the Users `manage` permission
for the target. The narrowest supported grant is therefore a Fine-Grained Admin Permissions Users `manage` scope
restricted to the explicitly approved target population and a policy matching the write service account. Do not
grant `realm-admin`; avoid the coarse `realm-management/manage-users` role unless IAM explicitly accepts its broader
access after testing proves the fine-grained grant cannot support the endpoint.

### Local simulated unlock UI

The Sécurité tab can demonstrate the confirmation flow without changing Keycloak. It is disabled by default and is
available only when the Next.js server is running with `NODE_ENV=development`, the explicit demo flag is `true`, and
the requested account matches the configured demo account ID. Production ignores the flag even if it is present.

Enable it for one development process without editing `.env.local`:

```bash
ICON_KEYCLOAK_DIRECTORY_APPROVED_TEST_ACCOUNT_IDS=replace-with-an-approved-test-account-id \
ICON_SIMULATED_UNLOCK_DEMO_ENABLED=true \
ICON_SIMULATED_UNLOCK_DEMO_ACCOUNT_ID=replace-with-the-same-approved-test-account-id \
pnpm dev
```

The configured account must also be inside the existing server-resolved visibility scope and must pass the normal
Lot 1 operation policy and trusted RG-37 resolution. The development unprotected-account override is not used. The
browser reads only `/api/users/{id}/unlock-demo`; confirmation changes React state locally and never calls the real
`POST /api/users/{id}/unlock` route or a Keycloak write operation.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
