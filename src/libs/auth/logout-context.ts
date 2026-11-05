import 'server-only'

// Node Imports
import { AsyncLocalStorage } from 'node:async_hooks'

type LogoutContext = {
  idToken?: string
}

const logoutContextStorage = new AsyncLocalStorage<LogoutContext>()

/** Called only by Auth.js's signOut event while it still has the decrypted JWT session payload. */
export const captureLogoutIdToken = (token: { idToken?: unknown } | null) => {
  const context = logoutContextStorage.getStore()

  if (context && typeof token?.idToken === 'string' && token.idToken.length > 0) {
    context.idToken = token.idToken
  }
}

/**
 * Isolates logout token capture to the current server action so concurrent sign-outs cannot share state.
 * The callback must invoke Auth.js signOut, which emits the event before clearing the session cookie.
 */
export const captureIdTokenDuringSignOut = async (callback: () => Promise<unknown>) => {
  const context: LogoutContext = {}

  await logoutContextStorage.run(context, callback)

  return context.idToken
}
