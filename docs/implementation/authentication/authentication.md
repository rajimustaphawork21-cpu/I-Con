# Authentication and Sessions — Feature Documentation

- **Current status:** **IMPLEMENTED — Phase 1 Human Authentication & Session Management verified in root Vuexy app**
- **Last reviewed:** 2026-10-26
- **Scope:** Human authentication, session lifecycle, and logout via Keycloak OIDC client `management-web` for the configured Realm

This document owns authentication-specific requirements, design implementation, and verification evidence. Shared boundaries remain in [architecture](../../architecture/architecture.md), feature index in [implementation index](../implementation.md), and project-wide summary in [project status](../../report/project-status.md).

## 1. Feature Overview

Authentication Phase 1 provides human authentication into the Keycloak Management platform using Keycloak's OIDC Authorization Code Flow with PKCE S256, State, and Nonce. It secures the Vuexy Dashboard Shell and user session without introducing an application session database.

Keycloak remains the identity provider and credentials collector. The application collects no credentials directly.

### Approved Clients Separation
- **`management-web` (Human OIDC Client):** Standard flow with PKCE S256, confidential client, user login callback `http://localhost:3000/api/auth/callback/keycloak`, post-logout redirect `http://localhost:3000/login`.
- **`management-service` (Admin API Client):** Separate client credentials / service account strictly for server-side Admin SDK operations.

Credentials, secrets, and configurations for these two clients remain completely isolated.

## 2. Architecture & Modular DDD Structure

```text
modules/auth/
├── domain/
│   └── session-policy.ts          # Pure session lifetime rules, claim sanitization, activity renewal logic
└── infrastructure/
    ├── auth-config.ts             # Server-only config loader for management-web and NextAuth
    ├── auth-options.ts            # NextAuth options, Keycloak provider, minimal claim callbacks
    ├── logout-request.ts          # CSRF validation and Keycloak RP-initiated logout URL builder
    └── server-session.ts          # Server-only session helper with dual-timeout validation

src/
├── proxy.ts                       # Next.js 16 Edge proxy route gate for page requests
├── types/next-auth.d.ts           # Type definitions for minimal public session
├── app/
│   ├── api/auth/
│   │   ├── [...nextauth]/route.ts # NextAuth Route Handler (GET, POST)
│   │   └── keycloak-logout/route.ts # CSRF-protected POST-only Keycloak SSO logout handler
│   ├── (blank-layout-pages)/login/page.tsx # Session-aware login page
│   └── (dashboard)/layout.tsx     # Server-side layout guard & session provider wrapping
├── components/auth/
│   ├── AuthSessionProvider.tsx    # NextAuth SessionProvider (polling/focus refetch disabled)
│   ├── ActivityTracker.tsx        # Client interaction listener with 5-minute renewal throttle
│   └── KeycloakLogoutButton.tsx   # CSRF-protected form POST button for SSO logout
└── views/Login.tsx                # "Continue with Keycloak" authentication view
```

## 3. Security Implementation Details

### 1. Minimal Session Claims
- Stored in encrypted, HttpOnly, SameSite=Lax JWT cookies.
- Contains only 4 fields: `sub` (Keycloak subject ID), `name` (sanitized display name), `authTime` (epoch ms), `lastActivity` (epoch ms).
- Provider access tokens, refresh tokens, ID tokens, email, and roles are never persisted in the session cookie or exposed to `/api/auth/session`.

### 2. Dual-Timeout Enforcement
- **Inactivity Timeout:** 30 minutes rolling window based on `lastActivity`.
- **Absolute Session Cap:** 8 hours maximum lifetime from `authTime`.
- Both limits are enforced strictly server-side in `isSessionActive` within `session-policy.ts`, the NextAuth `session` callback, `server-session.ts`, and `proxy.ts`.
- The public session `expires` field matches the exact earlier limit of the two, preventing client-side expiration skew.

### 3. Activity Renewal Safeguards
- Activity signals are triggers only; client requests cannot supply identity, change `authTime`, or revive an expired session.
- Client renewal requests are throttled to a minimum of 5 minutes (`ACTIVITY_RENEWAL_INTERVAL_MS`).
- Periodic background timers and focus events are excluded from activity listeners.
- Idle tabs do not send activity requests; active tabs renew the shared session cookie transparently.

### 4. Logout Security
- **Action 1 (Sign out of this app):** Calls standard NextAuth `signOut({ callbackUrl: '/login' })`, invalidating the local application session cookie.
- **Action 2 (Sign out of Keycloak SSO):** Submits a same-origin form POST to `/api/auth/keycloak-logout` carrying the NextAuth double-submit CSRF token.
- Validates Origin/Sec-Fetch-Site and CSRF token before clearing auth cookies and redirecting to Keycloak's RP-Initiated Logout endpoint (`/protocol/openid-connect/logout`) with the registered `post_logout_redirect_uri`.
- Keycloak confirmation prompt is permitted when no ID token hint is supplied.

## 4. Verification Evidence

| Verification Step | Result | Notes |
| --- | --- | --- |
| Original Phase 1 automated suite | **PASS (57/57)** | 28 existing Users/SDK tests + 29 focused Auth tests (`session-policy`, `auth-config`, `logout-request`) |
| Phase 2 full regression suite | **PASS (113/113)** | All 29 Phase 1 Auth tests remain passing on 2026-10-26 |
| TypeScript Check | **PASS (`tsc --noEmit`)** | Zero type errors across all modules, layouts, and route handlers |
| ESLint Check | **PASS (`eslint`)** | Conforms to Vuexy style guide and import rules |
| Production Build | **PASS (`next build`)** | Turbopack compiled in 4.6s, typecheck 23.6s, static pages generated |
| Security Audit | **PASS (`pnpm audit --prod`)** | 0 vulnerabilities found |
| Git Hygiene | **PASS (`git diff --check`)** | Clean whitespace check |

## 5. Current integration boundary

Authentication Phase 1 remains unchanged. Phase 2 reads the trusted `sub` directly from the encrypted cookie for server authorization while preserving the minimal public Session contract. Users APIs own JSON 401 responses; normal protected page navigation continues to redirect to `/login`. Login, activity expiry and both logout behaviors were not changed.
