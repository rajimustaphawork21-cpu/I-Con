import assert from "node:assert/strict";
import test from "node:test";

import {
  ABSOLUTE_LIFETIME_MS,
  ACTIVITY_RENEWAL_INTERVAL_MS,
  INACTIVITY_TIMEOUT_MS,
  createSessionClaims,
  isSessionActive,
  readSessionClaims,
  renewSessionActivity,
  resolveTokenClaims,
  sessionExpiresAt,
  toPublicSession,
} from "../../modules/auth/domain/session-policy.ts";

const T0 = 1_800_000_000_000;
const MINUTE = 60 * 1000;

function newClaims(now = T0) {
  return createSessionClaims({ subject: "user-1", displayName: "Test Ali" }, now);
}

test("createSessionClaims keeps only subject, name and lifetime claims", () => {
  const claims = newClaims();

  assert.deepEqual(claims, {
    sub: "user-1",
    name: "Test Ali",
    authTime: T0,
    lastActivity: T0,
  });
});

test("createSessionClaims rejects a missing or invalid subject", () => {
  assert.equal(createSessionClaims({ subject: undefined }, T0), null);
  assert.equal(createSessionClaims({ subject: "  " }, T0), null);
  assert.equal(createSessionClaims({ subject: 42 }, T0), null);
});

test("createSessionClaims sanitizes the display name", () => {
  const messy = createSessionClaims(
    { subject: "s", displayName: "  Ali\u0000\n  " },
    T0,
  );
  const missing = createSessionClaims({ subject: "s", displayName: 5 }, T0);
  const long = createSessionClaims(
    { subject: "s", displayName: "x".repeat(500) },
    T0,
  );

  assert.equal(messy?.name, "Ali");
  assert.equal(missing?.name, "Authenticated user");
  assert.equal(long?.name.length, 100);
});

test("readSessionClaims drops every unknown property", () => {
  const claims = readSessionClaims({
    sub: "user-1",
    name: "Test Ali",
    authTime: T0,
    lastActivity: T0,
    email: "a@example.test",
    roles: ["admin"],
    accessToken: "secret",
    picture: "x",
  });

  assert.deepEqual(Object.keys(claims ?? {}).sort(), [
    "authTime",
    "lastActivity",
    "name",
    "sub",
  ]);
});

test("readSessionClaims rejects malformed tokens", () => {
  assert.equal(readSessionClaims(null), null);
  assert.equal(readSessionClaims({}), null);
  assert.equal(readSessionClaims({ sub: "s", name: "n", authTime: "1", lastActivity: 1 }), null);
  assert.equal(readSessionClaims({ sub: "s", name: "n", authTime: T0 }), null);
  assert.equal(readSessionClaims({ sub: "", name: "n", authTime: T0, lastActivity: T0 }), null);
  assert.equal(readSessionClaims({ sub: "s", name: "n", authTime: Number.NaN, lastActivity: T0 }), null);
});

test("a session is active before the inactivity limit and expired after it", () => {
  const claims = newClaims();

  assert.equal(isSessionActive(claims, T0 + INACTIVITY_TIMEOUT_MS - 1), true);
  assert.equal(isSessionActive(claims, T0 + INACTIVITY_TIMEOUT_MS), false);
});

test("the eight-hour cap expires a session even with continuous activity", () => {
  let claims = newClaims();

  for (let now = T0; now < T0 + ABSOLUTE_LIFETIME_MS; now += 10 * MINUTE) {
    const renewed = renewSessionActivity(claims, now);

    assert.notEqual(renewed, null);
    claims = renewed;
  }

  assert.equal(claims.authTime, T0);
  assert.equal(isSessionActive(claims, T0 + ABSOLUTE_LIFETIME_MS - 1), true);
  assert.equal(isSessionActive(claims, T0 + ABSOLUTE_LIFETIME_MS), false);
  assert.equal(renewSessionActivity(claims, T0 + ABSOLUTE_LIFETIME_MS), null);
});

test("expiry never exceeds the absolute cap, even right after renewal", () => {
  const claims = {
    sub: "s",
    name: "n",
    authTime: T0,
    lastActivity: T0 + ABSOLUTE_LIFETIME_MS - 5 * MINUTE,
  };

  assert.equal(sessionExpiresAt(claims), T0 + ABSOLUTE_LIFETIME_MS);
});

test("renewal inside the throttle window returns the same claims", () => {
  const claims = newClaims();
  const renewed = renewSessionActivity(claims, T0 + ACTIVITY_RENEWAL_INTERVAL_MS - 1);

  assert.equal(renewed, claims);
});

test("renewal after the throttle window moves only lastActivity", () => {
  const claims = newClaims();
  const now = T0 + ACTIVITY_RENEWAL_INTERVAL_MS;
  const renewed = renewSessionActivity(claims, now);

  assert.deepEqual(renewed, { ...claims, lastActivity: now });
});

test("an expired session cannot be revived by renewal", () => {
  const claims = newClaims();

  assert.equal(
    renewSessionActivity(claims, T0 + INACTIVITY_TIMEOUT_MS + MINUTE),
    null,
  );
});

test("claims with inconsistent or future times are rejected", () => {
  const future = { sub: "s", name: "n", authTime: T0 + 10 * MINUTE, lastActivity: T0 + 10 * MINUTE };
  const reversed = { sub: "s", name: "n", authTime: T0, lastActivity: T0 - MINUTE };
  const futureActivity = { sub: "s", name: "n", authTime: T0, lastActivity: T0 + 10 * MINUTE };

  assert.equal(isSessionActive(future, T0), false);
  assert.equal(isSessionActive(reversed, T0), false);
  assert.equal(isSessionActive(futureActivity, T0), false);
});

test("the public session exposes only the name and the enforced expiry", () => {
  const claims = newClaims();
  const publicSession = toPublicSession(claims, T0);

  assert.deepEqual(publicSession, {
    name: "Test Ali",
    expires: new Date(T0 + INACTIVITY_TIMEOUT_MS).toISOString(),
  });
  assert.equal(toPublicSession(claims, T0 + INACTIVITY_TIMEOUT_MS), null);
});

test("the public expiry never exceeds the actual enforced limit", () => {
  const claims = {
    sub: "s",
    name: "n",
    authTime: T0,
    lastActivity: T0 + ABSOLUTE_LIFETIME_MS - MINUTE,
  };
  const publicSession = toPublicSession(claims, T0 + ABSOLUTE_LIFETIME_MS - MINUTE);

  assert.equal(publicSession?.expires, new Date(T0 + ABSOLUTE_LIFETIME_MS).toISOString());
});

test("resolveTokenClaims builds a fresh minimal token at sign-in and ignores the old token", () => {
  const stale = { sub: "old", name: "Old", authTime: 1, lastActivity: 1, email: "x@example.test" };
  const claims = resolveTokenClaims(stale, T0, {
    signIn: { subject: "user-2", displayName: "Test Sara" },
  });

  assert.deepEqual(claims, { sub: "user-2", name: "Test Sara", authTime: T0, lastActivity: T0 });
});

test("resolveTokenClaims re-emits only known claims on a plain read and never renews", () => {
  const token = { ...newClaims(), email: "x@example.test", roles: ["admin"], accessToken: "t" };
  const claims = resolveTokenClaims(token, T0 + 10 * MINUTE);

  assert.deepEqual(claims, newClaims());
});

test("resolveTokenClaims renews only on an activity trigger and keeps identity and authTime", () => {
  const token = newClaims();
  const now = T0 + 10 * MINUTE;
  const claims = resolveTokenClaims(token, now, { activityTrigger: true });

  assert.deepEqual(claims, { ...token, lastActivity: now });
});

test("resolveTokenClaims cannot revive an expired or malformed session via the trigger", () => {
  assert.equal(
    resolveTokenClaims(newClaims(), T0 + INACTIVITY_TIMEOUT_MS + MINUTE, { activityTrigger: true }),
    null,
  );
  assert.equal(resolveTokenClaims({}, T0, { activityTrigger: true }), null);
  assert.equal(resolveTokenClaims(null, T0, { activityTrigger: true }), null);
});

test("resolveTokenClaims rejects a sign-in without a valid subject", () => {
  assert.equal(resolveTokenClaims({}, T0, { signIn: { subject: "" } }), null);
});
