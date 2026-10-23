'use client'

// React Imports
import { useEffect } from 'react'

// Third-party Imports
import { useSession } from 'next-auth/react'

// Real user interactions only. Timers, polling and focus events are deliberately excluded.
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

// Matches the server renewal interval; the server enforces the throttle independently.
const SYNC_INTERVAL_MS = 5 * 60 * 1000
const STORAGE_KEY = 'kc-management:last-activity-sync'

const readLastSync = () => {
  try {
    return Number(window.localStorage.getItem(STORAGE_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

const writeLastSync = (value: number | null) => {
  try {
    if (value === null) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    }
  } catch {
    // Storage may be unavailable; the server throttle still applies.
  }
}

/**
 * Asks the server to record activity. The request carries no identity or time;
 * it is only a trigger. The throttle timestamp is shared across tabs so an
 * idle tab never renews, and an active tab keeps every tab's shared cookie fresh.
 * A tab that discovers an expired session only navigates to /login; it never
 * calls sign-out, so it cannot clear a newer session created in another tab.
 */
const ActivityTracker = () => {
  const { status, update } = useSession()

  useEffect(() => {
    if (status === 'unauthenticated') {
      window.location.replace('/login')
    }
  }, [status])

  useEffect(() => {
    if (status !== 'authenticated') return

    let inFlight = false

    const onActivity = async (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== 'visible' || inFlight) return

      const now = Date.now()

      if (now - readLastSync() < SYNC_INTERVAL_MS) return

      writeLastSync(now)
      inFlight = true

      try {
        const next = await update()

        if (!next) {
          window.location.replace('/login')
        }
      } catch {
        // Allow a retry on the next interaction after a transient failure.
        writeLastSync(null)
      } finally {
        inFlight = false
      }
    }

    ACTIVITY_EVENTS.forEach(name => window.addEventListener(name, onActivity, { passive: true, capture: true }))

    return () => {
      ACTIVITY_EVENTS.forEach(name => window.removeEventListener(name, onActivity, { capture: true }))
    }
  }, [status, update])

  return null
}

export default ActivityTracker
