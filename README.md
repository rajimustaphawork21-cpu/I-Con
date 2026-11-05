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

## Keycloak realm-role claim

Authorization requires the Realm Role `portal-ops-n1` in `realm_access.roles`. The preferred source is the
validated ID token. In Keycloak, review the realm-role protocol mapper used by client `icon-bff` (commonly
the built-in `roles` client scope) and enable **Add to ID token** and **Add to access token** with token claim
name `realm_access.roles`. No Keycloak configuration is changed by this repository.

If the ID-token mapper is absent, I-Con verifies the access-token RS256 signature against the realm JWKS,
then validates issuer, expiry, and `azp=icon-bff` before accepting the realm-role claim.

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
