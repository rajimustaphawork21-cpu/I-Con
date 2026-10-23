export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const ACTIVITY_RENEWAL_INTERVAL_MS = 5 * 60 * 1000;

const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_SUBJECT_LENGTH = 256;
const FALLBACK_DISPLAY_NAME = "Authenticated user";

/**
 * The only identity and lifetime data kept in the application session.
 * Times are epoch milliseconds produced by the server clock.
 */
export interface SessionClaims {
  readonly sub: string;
  readonly name: string;
  readonly authTime: number;
  readonly lastActivity: number;
}

export interface PublicSession {
  readonly name: string;
  readonly expires: string;
}

export interface AuthenticatedIdentity {
  readonly subject?: unknown;
  readonly displayName?: unknown;
}

export function createSessionClaims(
  identity: AuthenticatedIdentity,
  now: number,
): SessionClaims | null {
  const subject = identity.subject;

  if (
    typeof subject !== "string" ||
    subject.trim().length === 0 ||
    subject.length > MAX_SUBJECT_LENGTH
  ) {
    return null;
  }

  return {
    sub: subject,
    name: sanitizeDisplayName(identity.displayName),
    authTime: now,
    lastActivity: now,
  };
}

/**
 * Extracts exactly the four known claims from an untrusted token object.
 * Any other property (email, roles, OAuth tokens, ...) is dropped.
 */
export function readSessionClaims(token: unknown): SessionClaims | null {
  if (typeof token !== "object" || token === null) {
    return null;
  }

  const { sub, name, authTime, lastActivity } = token as Record<
    string,
    unknown
  >;

  if (
    typeof sub !== "string" ||
    sub.length === 0 ||
    typeof name !== "string" ||
    !isEpochMilliseconds(authTime) ||
    !isEpochMilliseconds(lastActivity)
  ) {
    return null;
  }

  return { sub, name, authTime, lastActivity };
}

export function isSessionActive(claims: SessionClaims, now: number): boolean {
  if (claims.authTime > now + CLOCK_SKEW_TOLERANCE_MS) {
    return false;
  }

  if (claims.lastActivity < claims.authTime) {
    return false;
  }

  if (claims.lastActivity > now + CLOCK_SKEW_TOLERANCE_MS) {
    return false;
  }

  return now < sessionExpiresAt(claims);
}

/** The instant at which the session stops being valid. */
export function sessionExpiresAt(claims: SessionClaims): number {
  return Math.min(
    claims.lastActivity + INACTIVITY_TIMEOUT_MS,
    claims.authTime + ABSOLUTE_LIFETIME_MS,
  );
}

/**
 * Records user activity. A client request is only a trigger: identity and
 * `authTime` are never taken from it, an expired session is never revived,
 * and renewal is throttled to once per renewal interval.
 */
export function renewSessionActivity(
  claims: SessionClaims,
  now: number,
): SessionClaims | null {
  if (!isSessionActive(claims, now)) {
    return null;
  }

  if (now - claims.lastActivity < ACTIVITY_RENEWAL_INTERVAL_MS) {
    return claims;
  }

  return { ...claims, lastActivity: now };
}

export interface TokenTransition {

  /** Present only when a fresh sign-in just completed. */
  readonly signIn?: AuthenticatedIdentity;

  /** True when the client asked to record activity. Carries no data. */
  readonly activityTrigger?: boolean;
}

/**
 * Computes the next application token. Every path rebuilds the token from the
 * four known claims, so no other property can survive, and no client-supplied
 * data is an input.
 */
export function resolveTokenClaims(
  token: unknown,
  now: number,
  transition: TokenTransition = {},
): SessionClaims | null {
  if (transition.signIn) {
    return createSessionClaims(transition.signIn, now);
  }

  const claims = readSessionClaims(token);

  if (!claims) {
    return null;
  }

  if (transition.activityTrigger) {
    return renewSessionActivity(claims, now);
  }

  return claims;
}

export function toPublicSession(
  claims: SessionClaims,
  now: number,
): PublicSession | null {
  if (!isSessionActive(claims, now)) {
    return null;
  }

  return {
    name: claims.name,
    expires: new Date(sessionExpiresAt(claims)).toISOString(),
  };
}

function isEpochMilliseconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sanitizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    return FALLBACK_DISPLAY_NAME;
  }

  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);

  return cleaned.length > 0 ? cleaned : FALLBACK_DISPLAY_NAME;
}
