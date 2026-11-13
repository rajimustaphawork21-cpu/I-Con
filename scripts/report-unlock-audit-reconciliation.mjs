import auditModule from '../src/modules/users/infrastructure/postgres-user-unlock-audit.coordinator.ts'

const { createAuditDatabasePool, queryUnlockAuditReconciliation, readAuditDatabaseConfiguration } = auditModule

const readGracePeriodMinutes = () => {
  const arguments_ = process.argv.slice(2)
  let value = process.env.ICON_AUDIT_RECONCILIATION_GRACE_MINUTES ?? '15'

  if (arguments_[0] === '--') arguments_.shift()

  if (arguments_.length === 1 && arguments_[0].startsWith('--grace-minutes=')) {
    value = arguments_[0].slice('--grace-minutes='.length)
  } else if (arguments_.length === 2 && arguments_[0] === '--grace-minutes') {
    value = arguments_[1]
  } else if (arguments_.length > 0) {
    throw new Error('Usage: --grace-minutes <positive integer>')
  }

  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('Grace period must be a positive integer')

  const minutes = Number(value)

  if (!Number.isSafeInteger(minutes) || minutes > 525600) {
    throw new Error('Grace period is outside the supported range')
  }

  return minutes
}

let pool

try {
  const gracePeriodMinutes = readGracePeriodMinutes()
  const gracePeriodMilliseconds = gracePeriodMinutes * 60 * 1000

  pool = createAuditDatabasePool(readAuditDatabaseConfiguration())

  const report = await queryUnlockAuditReconciliation(pool, gracePeriodMilliseconds)
  const pending = report.rows.filter(row => row.reconciliation_status === 'PENDING')
  const resolved = report.rows.filter(row => row.reconciliation_status === 'RESOLVED')

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        gracePeriodMinutes,
        pending,
        resolved
      },
      null,
      2
    )
  )
} catch {
  console.error('Unable to generate the unlock audit reconciliation report')
  process.exitCode = 1
} finally {
  await pool?.end()
}
