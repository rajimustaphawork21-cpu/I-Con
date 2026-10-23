import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildKeycloakLogoutUrl,
  isSameOriginRequest,
  verifyCsrfToken,
} from "../../modules/auth/infrastructure/logout-request.ts";

const SECRET = "t".repeat(40);
const TOKEN = "a1b2c3";

function cookieFor(token, secret = SECRET) {
  const hash = createHash("sha256").update(`${token}${secret}`).digest("hex");

  return `${token}|${hash}`;
}

test("buildKeycloakLogoutUrl uses client_id and the registered post-logout URI", () => {
  const url = new URL(
    buildKeycloakLogoutUrl({
      logoutEndpoint:
        "http://localhost:8080/realms/company-dev/protocol/openid-connect/logout",
      clientId: "management-web",
      postLogoutRedirectUri: "http://localhost:3000/login",
    }),
  );

  assert.equal(url.origin, "http://localhost:8080");
  assert.equal(url.searchParams.get("client_id"), "management-web");
  assert.equal(
    url.searchParams.get("post_logout_redirect_uri"),
    "http://localhost:3000/login",
  );
  assert.equal(url.searchParams.has("id_token_hint"), false);
});

test("isSameOriginRequest accepts only the application origin", () => {
  const app = "http://localhost:3000";

  assert.equal(isSameOriginRequest({ origin: app, secFetchSite: "same-origin" }, app), true);
  assert.equal(isSameOriginRequest({ origin: app, secFetchSite: null }, app), true);
  assert.equal(isSameOriginRequest({ origin: null, secFetchSite: null }, app), false);
  assert.equal(isSameOriginRequest({ origin: "http://evil.test", secFetchSite: "cross-site" }, app), false);
  assert.equal(isSameOriginRequest({ origin: app, secFetchSite: "cross-site" }, app), false);
  assert.equal(isSameOriginRequest({ origin: "null", secFetchSite: null }, app), false);
});

test("verifyCsrfToken accepts a matching double-submit token", () => {
  assert.equal(
    verifyCsrfToken({ cookieValue: cookieFor(TOKEN), submittedToken: TOKEN, secret: SECRET }),
    true,
  );
});

test("verifyCsrfToken rejects missing, mismatched and forged tokens", () => {
  assert.equal(verifyCsrfToken({ cookieValue: undefined, submittedToken: TOKEN, secret: SECRET }), false);
  assert.equal(verifyCsrfToken({ cookieValue: cookieFor(TOKEN), submittedToken: undefined, secret: SECRET }), false);
  assert.equal(verifyCsrfToken({ cookieValue: cookieFor(TOKEN), submittedToken: "other", secret: SECRET }), false);
  assert.equal(verifyCsrfToken({ cookieValue: cookieFor(TOKEN, "x".repeat(40)), submittedToken: TOKEN, secret: SECRET }), false);
  assert.equal(verifyCsrfToken({ cookieValue: TOKEN, submittedToken: TOKEN, secret: SECRET }), false);
  assert.equal(verifyCsrfToken({ cookieValue: `${cookieFor(TOKEN)}|extra`, submittedToken: TOKEN, secret: SECRET }), false);
});
