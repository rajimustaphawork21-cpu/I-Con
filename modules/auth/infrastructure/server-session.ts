import "server-only";

import { getServerSession } from "next-auth";
import type { Session } from "next-auth";

import { getAuthOptions } from "./auth-options";

/**
 * Returns the session only while both lifetime limits hold, otherwise null.
 * Authentication only: it carries no roles and grants no administrative access.
 */
export async function getAuthenticatedSession(): Promise<Session | null> {
  const session = await getServerSession(getAuthOptions());

  return session?.user?.name ? session : null;
}
