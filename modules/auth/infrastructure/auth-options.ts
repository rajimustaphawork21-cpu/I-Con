import "server-only";

import type { NextAuthOptions, Session } from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";

import {
  readSessionClaims,
  resolveTokenClaims,
  toPublicSession,
} from "../domain/session-policy";
import { loadAuthConfig } from "./auth-config";

let cachedOptions: NextAuthOptions | undefined;

/**
 * Auth.js options are built lazily so a missing environment variable fails the
 * request that needs authentication instead of the build.
 */
export function getAuthOptions(): NextAuthOptions {
  if (cachedOptions === undefined) {
    cachedOptions = buildAuthOptions();
  }

  return cachedOptions;
}

function buildAuthOptions(): NextAuthOptions {
  const config = loadAuthConfig();

  return {
    secret: config.secret,
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      KeycloakProvider({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        issuer: config.issuer,
        authorization: { params: { scope: "openid profile" } },
        checks: ["pkce", "state", "nonce"],

        // Only the subject and display name are ever read from the provider.
        profile(profile: {
          sub: string;
          name?: string;
          preferred_username?: string;
        }) {
          return {
            id: profile.sub,
            name: profile.name ?? profile.preferred_username ?? null,
          };
        },
      }),
    ],
    callbacks: {
      async jwt({ token, user, account, trigger }) {
        // Sign-in builds a brand-new minimal token. `update()` is only a
        // trigger: its payload is never read, expired sessions are not revived
        // and renewal is throttled. All other reads never renew.
        const claims = resolveTokenClaims(token, Date.now(), {
          signIn: account && user ? { subject: user.id, displayName: user.name } : undefined,
          activityTrigger: trigger === "update",
        });

        return claims ? { ...claims } : {};
      },
      async session({ token }) {
        const claims = readSessionClaims(token);
        const publicSession = claims ? toPublicSession(claims, Date.now()) : null;

        if (!publicSession) {
          // Empty session object: the client and getServerSession treat it as signed out.
          return {} as Session;
        }

        return {
          user: { name: publicSession.name },
          expires: publicSession.expires,
        };
      },
    },
  };
}
