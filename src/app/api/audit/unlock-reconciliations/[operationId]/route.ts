// Auth Imports
import { auth } from '@/auth'

// Audit Imports
import {
  createAuditDatabasePool,
  readAuditReconcilerDatabaseConfiguration,
  recordUnlockAuditReconciliation
} from '@/modules/users/infrastructure/postgres-user-unlock-audit.coordinator'

// Local Imports
import { createUnlockAuditReconciliationPostHandler } from './route-handler'

let reconcilerPool: ReturnType<typeof createAuditDatabasePool> | undefined

const pool = () => {
  reconcilerPool ??= createAuditDatabasePool(readAuditReconcilerDatabaseConfiguration())

  return reconcilerPool
}

const getGracePeriodMilliseconds = () => {
  const rawMinutes = process.env.ICON_AUDIT_RECONCILIATION_GRACE_MINUTES ?? '15'

  if (!/^[1-9][0-9]*$/.test(rawMinutes)) throw new Error('Invalid reconciliation grace period')

  const minutes = Number(rawMinutes)

  if (!Number.isSafeInteger(minutes) || minutes > 525600) throw new Error('Invalid reconciliation grace period')

  return minutes * 60 * 1000
}

export const dynamic = 'force-dynamic'

export const POST = createUnlockAuditReconciliationPostHandler({
  getSession: () => auth(),
  getGracePeriodMilliseconds,
  recordReconciliation: async input => {
    const result = await recordUnlockAuditReconciliation(pool(), input)

    return { reconciliationId: String(result.rows[0].reconciliation_id) }
  }
})
