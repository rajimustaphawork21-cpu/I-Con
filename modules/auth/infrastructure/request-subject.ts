import "server-only";

import type { NextRequest } from "next/server";

import { getToken } from "next-auth/jwt";

import { isSessionActive, readSessionClaims } from "../domain/session-policy";

/** Resolves the trusted subject from the encrypted cookie without exposing it. */
export async function getAuthenticatedSubject(
  request: NextRequest,
): Promise<string | null> {
  const secret = process.env.NEXTAUTH_SECRET;

  if (!secret) {
    return null;
  }

  const secureCookie = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");

  const token = await getToken({ req: request, secret, secureCookie }).catch(
    () => null,
  );

  const claims = readSessionClaims(token);

  return claims && isSessionActive(claims, Date.now()) ? claims.sub : null;
}
