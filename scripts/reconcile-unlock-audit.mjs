import auditModule from '../src/modules/users/infrastructure/postgres-user-unlock-audit.coordinator.ts'

const { createAuditDatabasePool, readAuditReconcilerDatabaseConfiguration, recordUnlockAuditReconciliation } =
  auditModule

const evidenceKinds = new Set(['KEYCLOAK_ADMIN_EVENT', 'KEYCLOAK_SERVER_LOG', 'BACKEND_LOG', 'OTHER_AUTHORITATIVE'])

const readOptions = () => {
  const arguments_ = process.argv.slice(2)

  if (arguments_[0] === '--') arguments_.shift()

  const values = new Map()
  const flags = new Set()

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]

    if (argument === '--pending' || argument === '--evidence-confirmed') {
      if (flags.has(argument)) throw new Error('Duplicate flag')
      flags.add(argument)
      continue
    }

    if (!argument.startsWith('--') || index + 1 >= arguments_.length) throw new Error('Invalid arguments')
    if (values.has(argument)) throw new Error('Duplicate option')

    values.set(argument, arguments_[index + 1])
    index += 1
  }

  const allowedOptions = new Set([
    '--operation-id',
    '--outcome',
    '--reviewer',
    '--evidence-kind',
    '--evidence-reference',
    '--rationale',
    '--grace-minutes'
  ])

  for (const option of values.keys()) {
    if (!allowedOptions.has(option)) throw new Error('Unknown option')
  }

  if (flags.size !== 1) throw new Error('Choose exactly one reconciliation status')

  const pending = flags.has('--pending')
  const operationId = values.get('--operation-id')
  const outcome = values.get('--outcome') ?? null
  const reviewerSubject = values.get('--reviewer')
  const evidenceKind = values.get('--evidence-kind')
  const evidenceReference = values.get('--evidence-reference')
  const rationale = values.get('--rationale')
  const graceMinutesValue = values.get('--grace-minutes') ?? process.env.ICON_AUDIT_RECONCILIATION_GRACE_MINUTES ?? '15'

  if (!operationId || !/^[1-9][0-9]*$/.test(operationId)) throw new Error('Invalid operation ID')
  if (!reviewerSubject || !evidenceKind || !evidenceReference || !rationale) throw new Error('Missing required option')
  if (!evidenceKinds.has(evidenceKind)) throw new Error('Unsupported evidence kind')
  if (!/^[1-9][0-9]*$/.test(graceMinutesValue)) throw new Error('Invalid grace period')

  const gracePeriodMinutes = Number(graceMinutesValue)

  if (!Number.isSafeInteger(gracePeriodMinutes) || gracePeriodMinutes > 525600) {
    throw new Error('Grace period is outside the supported range')
  }

  if (pending && outcome !== null) throw new Error('Pending reviews cannot set an outcome')
  if (!pending && outcome !== 'SUCCESS' && outcome !== 'FAILURE') throw new Error('Definitive outcome is required')

  return {
    operationId,
    resolvedOutcome: pending ? null : outcome,
    reviewerSubject,
    evidenceKind,
    evidenceReference,
    rationale,
    evidenceIsDefinitive: !pending,
    gracePeriodMilliseconds: gracePeriodMinutes * 60 * 1000
  }
}

let pool

try {
  const input = readOptions()

  pool = createAuditDatabasePool(readAuditReconcilerDatabaseConfiguration())

  const result = await recordUnlockAuditReconciliation(pool, input)

  console.log(
    JSON.stringify(
      {
        status: input.evidenceIsDefinitive ? 'RESOLVED' : 'PENDING',
        operationId: input.operationId,
        reconciliationId: result.rows[0].reconciliation_id
      },
      null,
      2
    )
  )
} catch {
  console.error('Unable to record the unlock audit reconciliation')
  process.exitCode = 1
} finally {
  await pool?.end()
}
