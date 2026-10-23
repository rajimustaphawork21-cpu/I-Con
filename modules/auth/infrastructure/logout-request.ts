import { createHash, timingSafeEqual } from "node:crypto";

export const CSRF_COOKIE_NAMES = [
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
] as const;

export const AUTH_COOKIE_NAMES_TO_CLEAR = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
  ...CSRF_COOKIE_NAMES,
] as const;

export interface KeycloakLogoutTarget {
  readonly logoutEndpoint: string;
  readonly clientId: string;
  readonly postLogoutRedirectUri: string;
}

/**
 * RP-Initiated Logout URL. No `id_token_hint` is available in Phase 1, so
 * Keycloak may show its own logout confirmation page.
 */
export function buildKeycloakLogoutUrl(target: KeycloakLogoutTarget): string {
  const url = new URL(target.logoutEndpoint);

  url.searchParams.set("client_id", target.clientId);
  url.searchParams.set("post_logout_redirect_uri", target.postLogoutRedirectUri);

  return url.toString();
}

export interface RequestOriginHeaders {
  readonly origin: string | null;
  readonly secFetchSite: string | null;
}

/** Strict same-origin check: a missing or foreign Origin header is rejected. */
export function isSameOriginRequest(
  headers: RequestOriginHeaders,
  appOrigin: string,
): boolean {
  if (headers.origin === null || headers.origin !== appOrigin) {
    return false;
  }

  return headers.secFetchSite === null || headers.secFetchSite === "same-origin";
}

export interface CsrfCheckInput {
  readonly cookieValue: string | undefined;
  readonly submittedToken: string | undefined;
  readonly secret: string;
}

/**
 * Verifies the Auth.js double-submit CSRF token: the cookie holds
 * `<token>|<sha256(token + secret)>` and the form must echo `<token>`.
 */
export function verifyCsrfToken(input: CsrfCheckInput): boolean {
  const { cookieValue, submittedToken, secret } = input;

  if (!cookieValue || !submittedToken) {
    return false;
  }

  const [cookieToken, cookieHash, ...rest] = cookieValue.split("|");

  if (!cookieToken || !cookieHash || rest.length > 0) {
    return false;
  }

  const expectedHash = createHash("sha256")
    .update(`${cookieToken}${secret}`)
    .digest("hex");

  return (
    safeEqual(cookieHash, expectedHash) && safeEqual(cookieToken, submittedToken)
  );
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
