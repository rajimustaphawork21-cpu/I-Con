import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { promisify } from 'node:util'

import auditModule from '../../src/modules/users/infrastructure/postgres-user-unlock-audit.coordinator.ts'
import unlockUseCaseModule from '../../src/modules/users/application/unlock-user.usecase.ts'
import unlockRouteHandlerModule from '../../src/app/api/users/[id]/unlock/route-handler.ts'

const {
  PostgresUserUnlockAuditCoordinator,
  createAuditDatabasePool,
  queryAuditEvents,
  queryUnlockAuditReconciliation,
  readAuditDatabaseConfiguration,
  readAuditReconcilerDatabaseConfiguration,
  recordUnlockAuditReconciliation
} = auditModule

const { UnlockUserUseCase, UserUnlockDispatchOutcomeUnknownError } = unlockUseCaseModule
const { createUserUnlockPostHandler } = unlockRouteHandlerModule
const execFileAsync = promisify(execFile)

const integrationEnabled = Boolean(
  process.env.ICON_AUDIT_DB_HOST &&
    process.env.ICON_AUDIT_DB_PORT &&
    process.env.ICON_AUDIT_DB_USER &&
    process.env.ICON_AUDIT_DB_PASSWORD &&
    process.env.ICON_AUDIT_DB_SSL_MODE &&
    process.env.ICON_AUDIT_RECONCILER_DB_USER &&
    process.env.ICON_AUDIT_RECONCILER_DB_PASSWORD &&
    process.env.ICON_AUDIT_TEST_DB_NAME
)

const outageConfiguration =
  process.env.ICON_AUDIT_OUTAGE_TEST_PG_CTL &&
  process.env.ICON_AUDIT_OUTAGE_TEST_PG_DATA &&
  process.env.ICON_AUDIT_OUTAGE_TEST_PG_LOG &&
  process.env.ICON_AUDIT_OUTAGE_TEST_PG_OPTIONS
    ? {
        pgCtl: process.env.ICON_AUDIT_OUTAGE_TEST_PG_CTL,
        dataDirectory: process.env.ICON_AUDIT_OUTAGE_TEST_PG_DATA,
        logFile: process.env.ICON_AUDIT_OUTAGE_TEST_PG_LOG,
        serverOptions: process.env.ICON_AUDIT_OUTAGE_TEST_PG_OPTIONS
      }
    : null

const operator = {
  subject: 'operator-1',
  roles: ['OPS-N1'],
  delegatedApplicationIds: [],
  delegableRoleIds: [],
  delegableGroupIds: [],
  modifiableProfileFields: []
}

const unprotected = {
  hasRealmManagementRole: false,
  hasRealmAdministrationRole: false,
  isSsoAdministratorsGroupMember: false,
  hasProtectedAttribute: false,
  isServiceAccount: false
}

const approvedScope = {
  resolution: 'approved',
  value: { mode: 'account-ids', accountIds: ['user-1'] }
}

const createFaultPool = (pool, mode) => {
  let commits = 0

  return {
    async connect() {
      const client = await pool.connect()

      return {
        async query(text, values) {
          if (String(text).trim().toUpperCase() === 'COMMIT') {
            commits += 1

            if (mode === 'attempt-ack-lost' && commits === 1) {
              await client.query('COMMIT')
              throw new Error('simulated ATTEMPT commit acknowledgement loss')
            }

            if (mode === 'terminal-ack-lost' && commits === 2) {
              await client.query('COMMIT')
              throw new Error('simulated terminal commit acknowledgement loss')
            }
          }

          return client.query(text, values)
        },
        release: () => client.release()
      }
    }
  }
}

const createConnectionTerminationPool = (pool, disconnectBeforeCommit) => {
  let commits = 0

  return {
    async connect() {
      const client = await pool.connect()

      client.on('error', () => {
        // Expected when this test deliberately terminates the checked-out backend.
      })

      return {
        async query(text, values) {
          if (String(text).trim().toUpperCase() === 'COMMIT') {
            commits += 1

            if (commits === disconnectBeforeCommit) {
              await client.query('SELECT pg_terminate_backend(pg_backend_pid())')
              throw new Error('PostgreSQL did not terminate the audit connection')
            }
          }

          return client.query(text, values)
        },
        release: () => client.release()
      }
    }
  }
}

const createInstanceController = configuration => {
  let stopped = false

  return {
    async stop() {
      await execFileAsync(configuration.pgCtl, ['-D', configuration.dataDirectory, 'stop', '-m', 'fast', '-w'])
      stopped = true
    },
    async start() {
      if (!stopped) return

      await execFileAsync(configuration.pgCtl, [
        '-D',
        configuration.dataDirectory,
        '-l',
        configuration.logFile,
        '-o',
        configuration.serverOptions,
        'start',
        '-w'
      ])
      stopped = false
    }
  }
}

const createInstanceOutagePool = (pool, controller, stopBeforeCommit) => {
  let commits = 0

  return {
    async connect() {
      const client = await pool.connect()

      client.on('error', () => {
        // Expected when this test stops the disposable PostgreSQL instance.
      })

      return {
        async query(text, values) {
          if (String(text).trim().toUpperCase() === 'COMMIT') {
            commits += 1

            if (commits === stopBeforeCommit) await controller.stop()
          }

          return client.query(text, values)
        },
        release: () => client.release()
      }
    }
  }
}

const createRoute = ({ coordinator, correlationId, unlock }) => {
  const useCase = new UnlockUserUseCase({
    userDirectory: {
      getById: async accountId => ({
        id: accountId,
        username: 'ordinary-user',
        enabled: true
      })
    },
    isAccountIdInScope: (scope, accountId) => scope.mode === 'account-ids' && scope.accountIds.includes(accountId),
    protectionResolver: {
      resolve: async () => ({ resolution: 'resolved', value: unprotected })
    },
    lockReader: { isLocked: async () => true },
    unlocker: { unlock },
    auditCoordinator: coordinator
  })

  return createUserUnlockPostHandler({
    getSession: async () => ({ user: { id: operator.subject }, clientRoles: operator.roles }),
    resolveVisibilityScope: async () => approvedScope,
    executeUnlock: (accountId, request, trusted) => useCase.execute(accountId, request, trusted),
    createCorrelationId: () => correlationId
  })
}

const postUnlock = (handler, accountId = 'user-1') =>
  handler(
    new Request('http://localhost/api/users/user-1/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true })
    }),
    { params: Promise.resolve({ id: accountId }) }
  )

test(
  'PostgreSQL unlock audit commits ATTEMPT before dispatch and enforces immutable, single-terminal records',
  { skip: !integrationEnabled, concurrency: false },
  async t => {
    const configuration = readAuditDatabaseConfiguration(process.env, process.env.ICON_AUDIT_TEST_DB_NAME)

    const reconcilerConfiguration = readAuditReconcilerDatabaseConfiguration(
      process.env,
      process.env.ICON_AUDIT_TEST_DB_NAME
    )

    const pool = createAuditDatabasePool(configuration)
    const reconcilerPool = createAuditDatabasePool(reconcilerConfiguration)

    try {
      const identity = await pool.query('SELECT current_database() AS database, current_user AS role')

      const reconcilerIdentity = await reconcilerPool.query(
        'SELECT current_database() AS database, current_user AS role'
      )

      assert.equal(identity.rows[0].database, process.env.ICON_AUDIT_TEST_DB_NAME)
      assert.equal(identity.rows[0].role, process.env.ICON_AUDIT_DB_USER)
      assert.equal(reconcilerIdentity.rows[0].database, process.env.ICON_AUDIT_TEST_DB_NAME)
      assert.equal(reconcilerIdentity.rows[0].role, process.env.ICON_AUDIT_RECONCILER_DB_USER)

      await t.test('ATTEMPT is visible from another connection before the writer and SUCCESS is terminal', async () => {
        const correlationId = randomUUID()
        const coordinator = new PostgresUserUnlockAuditCoordinator(pool)
        let writes = 0

        const result = await coordinator.execute(
          {
            correlationId,
            operatorSubject: operator.subject,
            targetUserId: 'user-1',
            action: 'user:unlock'
          },
          async () => {
            const independentPool = createAuditDatabasePool(configuration)

            try {
              const visibleAttempt = await independentPool.query(
                'SELECT outcome::text AS outcome FROM audit.unlock_audit_events WHERE correlation_id = $1::uuid',
                [correlationId]
              )

              assert.deepEqual(
                visibleAttempt.rows.map(row => row.outcome),
                ['ATTEMPT']
              )
              writes += 1
            } finally {
              await independentPool.end()
            }
          }
        )

        assert.deepEqual(result, { outcome: 'success' })
        assert.equal(writes, 1)

        const persisted = await queryAuditEvents(pool, correlationId)

        assert.deepEqual(
          persisted.rows.map(row => row.outcome),
          ['ATTEMPT', 'SUCCESS']
        )

        await assert.rejects(
          pool.query("SELECT audit.finish_unlock_audit($1::uuid, 'UNKNOWN'::audit.unlock_audit_outcome)", [
            correlationId
          ]),
          error => error.code === '23505'
        )
      })

      await t.test('an unconfirmed ATTEMPT commit acknowledgement performs zero writes', async () => {
        const correlationId = randomUUID()
        const coordinator = new PostgresUserUnlockAuditCoordinator(createFaultPool(pool, 'attempt-ack-lost'))
        let writes = 0

        const result = await coordinator.execute(
          {
            correlationId,
            operatorSubject: operator.subject,
            targetUserId: 'user-1',
            action: 'user:unlock'
          },
          async () => {
            writes += 1
          }
        )

        assert.deepEqual(result, { outcome: 'unavailable', reason: 'ATTEMPT_NOT_CONFIRMED' })
        assert.equal(writes, 0)
        assert.deepEqual(
          (await queryAuditEvents(pool, correlationId)).rows.map(row => row.outcome),
          ['ATTEMPT']
        )
      })

      await t.test('a real connection failure before ATTEMPT commit fails closed at the API', async () => {
        const correlationId = randomUUID()
        const failurePool = createAuditDatabasePool(configuration)

        try {
          const coordinator = new PostgresUserUnlockAuditCoordinator(createConnectionTerminationPool(failurePool, 1))
          let writes = 0

          const route = createRoute({
            coordinator,
            correlationId,
            unlock: async () => {
              writes += 1
            }
          })

          const response = await postUnlock(route)

          assert.equal(response.status, 503)
          assert.equal(response.headers.get('x-correlation-id'), correlationId)
          assert.deepEqual(await response.json(), { error: 'USER_UNLOCK_AUDIT_UNAVAILABLE' })
          assert.equal(writes, 0)
          assert.deepEqual((await queryAuditEvents(pool, correlationId)).rows, [])
        } finally {
          await failurePool.end()
        }
      })

      await t.test('an ambiguous dispatched write returns UNKNOWN with correlation and is not retried', async () => {
        const correlationId = randomUUID()
        const coordinator = new PostgresUserUnlockAuditCoordinator(pool)
        let writes = 0

        const route = createRoute({
          coordinator,
          correlationId,
          unlock: async () => {
            writes += 1
            throw new UserUnlockDispatchOutcomeUnknownError()
          }
        })

        const response = await postUnlock(route)

        assert.equal(response.status, 503)
        assert.equal(response.headers.get('x-correlation-id'), correlationId)
        assert.deepEqual(await response.json(), {
          error: 'USER_UNLOCK_OUTCOME_UNKNOWN',
          correlationId
        })
        assert.equal(writes, 1)
        assert.deepEqual(
          (await queryAuditEvents(pool, correlationId)).rows.map(row => row.outcome),
          ['ATTEMPT', 'UNKNOWN']
        )
      })

      await t.test(
        'lost terminal COMMIT acknowledgement returns UNKNOWN without retry or competing terminal',
        async () => {
          const correlationId = randomUUID()
          const coordinator = new PostgresUserUnlockAuditCoordinator(createFaultPool(pool, 'terminal-ack-lost'))
          let writes = 0

          const route = createRoute({
            coordinator,
            correlationId,
            unlock: async () => {
              writes += 1
            }
          })

          const response = await postUnlock(route)

          assert.equal(response.status, 503)
          assert.equal(response.headers.get('x-correlation-id'), correlationId)
          assert.deepEqual(await response.json(), {
            error: 'USER_UNLOCK_OUTCOME_UNKNOWN',
            correlationId
          })
          assert.equal(writes, 1)
          assert.deepEqual(
            (await queryAuditEvents(pool, correlationId)).rows.map(row => row.outcome),
            ['ATTEMPT', 'SUCCESS']
          )
        }
      )

      await t.test('a real connection failure after dispatch returns UNKNOWN and preserves ATTEMPT', async () => {
        const correlationId = randomUUID()
        const failurePool = createAuditDatabasePool(configuration)

        try {
          const coordinator = new PostgresUserUnlockAuditCoordinator(createConnectionTerminationPool(failurePool, 2))
          let writes = 0

          const route = createRoute({
            coordinator,
            correlationId,
            unlock: async () => {
              writes += 1
            }
          })

          const response = await postUnlock(route)

          assert.equal(response.status, 503)
          assert.equal(response.headers.get('x-correlation-id'), correlationId)
          assert.deepEqual(await response.json(), {
            error: 'USER_UNLOCK_OUTCOME_UNKNOWN',
            correlationId
          })
          assert.equal(writes, 1)
          assert.deepEqual(
            (await queryAuditEvents(pool, correlationId)).rows.map(row => row.outcome),
            ['ATTEMPT']
          )
        } finally {
          await failurePool.end()
        }
      })

      await t.test('reconciliation reports only old orphaned ATTEMPT and persisted UNKNOWN operations', async () => {
        const oldOrphanCorrelationId = randomUUID()
        const freshAttemptCorrelationId = randomUUID()
        const unknownCorrelationId = randomUUID()
        const successCorrelationId = randomUUID()

        const beginAttempt = correlationId =>
          pool.query('SELECT audit.begin_unlock_audit_attempt($1::uuid, $2, $3)', [
            correlationId,
            operator.subject,
            'user-1'
          ])

        const finishAttempt = (correlationId, outcome) =>
          pool.query('SELECT audit.finish_unlock_audit($1::uuid, $2::audit.unlock_audit_outcome)', [
            correlationId,
            outcome
          ])

        await beginAttempt(oldOrphanCorrelationId)
        await pool.query('SELECT pg_sleep(1.1)')
        await beginAttempt(freshAttemptCorrelationId)
        await beginAttempt(unknownCorrelationId)
        await finishAttempt(unknownCorrelationId, 'UNKNOWN')
        await beginAttempt(successCorrelationId)
        await finishAttempt(successCorrelationId, 'SUCCESS')

        const report = await queryUnlockAuditReconciliation(pool, 1000)
        const operations = new Map(report.rows.map(row => [row.correlation_id, row]))
        const oldOrphan = operations.get(oldOrphanCorrelationId)
        const unknown = operations.get(unknownCorrelationId)

        assert.ok(oldOrphan)
        assert.equal(oldOrphan.reconciliation_status, 'PENDING')
        assert.match(oldOrphan.operation_id, /^[1-9][0-9]*$/)
        assert.equal(oldOrphan.target_user_id, 'user-1')
        assert.ok(oldOrphan.attempted_at instanceof Date)
        assert.equal(oldOrphan.terminal_at, null)
        assert.equal(oldOrphan.review_reason, 'ATTEMPT_GRACE_PERIOD_EXCEEDED')

        assert.ok(unknown)
        assert.equal(unknown.reconciliation_status, 'PENDING')
        assert.match(unknown.operation_id, /^[1-9][0-9]*$/)
        assert.equal(unknown.target_user_id, 'user-1')
        assert.ok(unknown.attempted_at instanceof Date)
        assert.ok(unknown.terminal_at instanceof Date)
        assert.equal(unknown.review_reason, 'PERSISTED_UNKNOWN_OUTCOME')

        assert.equal(operations.has(freshAttemptCorrelationId), false)
        assert.equal(operations.has(successCorrelationId), false)
      })

      await t.test('manual reconciliation is append-only, evidence-gated, and concurrency-safe', async () => {
        const orphanCorrelationId = randomUUID()
        const insufficientCorrelationId = randomUUID()
        const unknownCorrelationId = randomUUID()
        const concurrentCorrelationId = randomUUID()

        const beginAttempt = async correlationId => {
          const result = await pool.query('SELECT audit.begin_unlock_audit_attempt($1::uuid, $2, $3)', [
            correlationId,
            operator.subject,
            'user-1'
          ])

          return String(result.rows[0].begin_unlock_audit_attempt)
        }

        const finishUnknown = correlationId =>
          pool.query("SELECT audit.finish_unlock_audit($1::uuid, 'UNKNOWN'::audit.unlock_audit_outcome)", [
            correlationId
          ])

        const reconciliationInput = input => ({
          reviewerSubject: 'security-reviewer-1',
          evidenceKind: 'BACKEND_LOG',
          evidenceReference: 'backend-log:unlock-request-1',
          rationale: 'Authoritative evidence was reviewed for this operation.',
          gracePeriodMilliseconds: 1000,
          ...input
        })

        const reconcile = input => recordUnlockAuditReconciliation(reconcilerPool, reconciliationInput(input))
        const reconcileAsRuntime = input => recordUnlockAuditReconciliation(pool, reconciliationInput(input))

        const orphanOperationId = await beginAttempt(orphanCorrelationId)
        const insufficientOperationId = await beginAttempt(insufficientCorrelationId)

        const selfReviewCorrelationId = randomUUID()

        const selfReviewAttempt = await pool.query(
          'SELECT audit.begin_unlock_audit_attempt($1::uuid, $2, $3) AS event_id',
          [selfReviewCorrelationId, 'security-reviewer-1', 'user-1']
        )

        const selfReviewOperationId = String(selfReviewAttempt.rows[0].event_id)

        await pool.query('SELECT pg_sleep(1.1)')

        const unknownOperationId = await beginAttempt(unknownCorrelationId)

        await finishUnknown(unknownCorrelationId)

        const concurrentOperationId = await beginAttempt(concurrentCorrelationId)

        await finishUnknown(concurrentCorrelationId)

        await assert.rejects(
          reconcileAsRuntime({
            operationId: orphanOperationId,
            resolvedOutcome: 'FAILURE',
            evidenceIsDefinitive: true
          }),
          error => error.code === '42501'
        )
        await assert.rejects(
          reconcilerPool.query('SELECT audit.begin_unlock_audit_attempt($1::uuid, $2, $3)', [
            randomUUID(),
            operator.subject,
            'user-1'
          ]),
          error => error.code === '42501'
        )
        await assert.rejects(
          reconcile({
            operationId: selfReviewOperationId,
            resolvedOutcome: 'FAILURE',
            evidenceIsDefinitive: true
          }),
          error => error.code === '42501' && error.constraint === 'unlock_reconciliation_distinct_reviewer'
        )

        const selfReviewCount = await pool.query(
          'SELECT count(*)::integer AS count FROM audit.unlock_audit_reconciliations WHERE attempt_event_id = $1::bigint',
          [selfReviewOperationId]
        )

        assert.equal(selfReviewCount.rows[0].count, 0)

        await reconcile({
          operationId: orphanOperationId,
          resolvedOutcome: 'FAILURE',
          evidenceIsDefinitive: true
        })
        await reconcile({
          operationId: unknownOperationId,
          resolvedOutcome: 'SUCCESS',
          evidenceKind: 'KEYCLOAK_ADMIN_EVENT',
          evidenceReference: 'keycloak-admin-event:event-123',
          evidenceIsDefinitive: true
        })
        await reconcile({
          operationId: insufficientOperationId,
          resolvedOutcome: null,
          evidenceReference: 'backend-log:inconclusive-search-1',
          rationale: 'Available evidence did not establish whether the unlock was applied.',
          evidenceIsDefinitive: false
        })

        await assert.rejects(
          reconcile({
            operationId: insufficientOperationId,
            resolvedOutcome: 'SUCCESS',
            evidenceKind: 'CURRENT_LOCK_STATE',
            evidenceReference: 'keycloak-current-lock-state:user-1',
            evidenceIsDefinitive: true
          }),
          error => error.code === '22P02'
        )

        const concurrentResults = await Promise.allSettled([
          reconcile({
            operationId: concurrentOperationId,
            resolvedOutcome: 'SUCCESS',
            evidenceReference: 'backend-log:concurrent-review-a',
            evidenceIsDefinitive: true
          }),
          reconcile({
            operationId: concurrentOperationId,
            resolvedOutcome: 'SUCCESS',
            reviewerSubject: 'security-reviewer-2',
            evidenceReference: 'backend-log:concurrent-review-b',
            evidenceIsDefinitive: true
          })
        ])

        assert.equal(concurrentResults.filter(result => result.status === 'fulfilled').length, 1)
        assert.equal(concurrentResults.filter(result => result.status === 'rejected').length, 1)
        assert.equal(concurrentResults.find(result => result.status === 'rejected').reason.code, '23505')

        const report = await queryUnlockAuditReconciliation(pool, 1000)
        const operations = new Map(report.rows.map(row => [row.correlation_id, row]))
        const orphan = operations.get(orphanCorrelationId)
        const unknown = operations.get(unknownCorrelationId)
        const insufficient = operations.get(insufficientCorrelationId)
        const concurrent = operations.get(concurrentCorrelationId)

        assert.ok(orphan)
        assert.equal(orphan.reconciliation_status, 'RESOLVED')
        assert.equal(orphan.resolved_outcome, 'FAILURE')
        assert.equal(orphan.reviewer_subject, 'security-reviewer-1')
        assert.equal(orphan.evidence_kind, 'BACKEND_LOG')
        assert.ok(orphan.reviewed_at instanceof Date)

        assert.ok(unknown)
        assert.equal(unknown.reconciliation_status, 'RESOLVED')
        assert.equal(unknown.resolved_outcome, 'SUCCESS')
        assert.equal(unknown.review_reason, 'PERSISTED_UNKNOWN_OUTCOME')
        assert.equal(unknown.evidence_kind, 'KEYCLOAK_ADMIN_EVENT')

        assert.ok(insufficient)
        assert.equal(insufficient.reconciliation_status, 'PENDING')
        assert.equal(insufficient.resolved_outcome, null)
        assert.equal(insufficient.reviewer_subject, 'security-reviewer-1')
        assert.equal(insufficient.evidence_reference, 'backend-log:inconclusive-search-1')

        assert.ok(concurrent)
        assert.equal(concurrent.reconciliation_status, 'RESOLVED')

        assert.deepEqual(
          (await queryAuditEvents(pool, orphanCorrelationId)).rows.map(row => row.outcome),
          ['ATTEMPT']
        )
        assert.deepEqual(
          (await queryAuditEvents(pool, unknownCorrelationId)).rows.map(row => row.outcome),
          ['ATTEMPT', 'UNKNOWN']
        )

        const integrity = await pool.query(
          'SELECT audit.verify_unlock_audit_chain() AS audit_valid, ' +
            'audit.verify_unlock_reconciliation_chain() AS reconciliation_valid, ' +
            '(SELECT count(*)::integer FROM audit.unlock_audit_reconciliations ' +
            "WHERE attempt_event_id = $1::bigint AND status = 'RESOLVED') AS concurrent_resolution_count",
          [concurrentOperationId]
        )

        assert.deepEqual(integrity.rows[0], {
          audit_valid: true,
          reconciliation_valid: true,
          concurrent_resolution_count: 1
        })

        await assert.rejects(
          pool.query('UPDATE audit.unlock_audit_reconciliations SET rationale = rationale'),
          error => error.code === '42501'
        )
        await assert.rejects(
          pool.query('INSERT INTO audit.unlock_audit_reconciliations DEFAULT VALUES'),
          error => error.code === '42501'
        )
        await assert.rejects(
          pool.query('DELETE FROM audit.unlock_audit_reconciliations'),
          error => error.code === '42501'
        )
        await assert.rejects(pool.query('TRUNCATE audit.unlock_audit_reconciliations'), error => error.code === '42501')

        for (const statement of [
          'INSERT INTO audit.unlock_audit_reconciliations DEFAULT VALUES',
          'UPDATE audit.unlock_audit_reconciliations SET rationale = rationale',
          'DELETE FROM audit.unlock_audit_reconciliations',
          'TRUNCATE audit.unlock_audit_reconciliations'
        ]) {
          await assert.rejects(reconcilerPool.query(statement), error => error.code === '42501')
        }
      })

      await t.test('records persist across connections and the runtime role cannot bypass or mutate them', async () => {
        const independentPool = createAuditDatabasePool(configuration)

        try {
          const persistedCount = await independentPool.query(
            'SELECT count(*)::integer AS count FROM audit.unlock_audit_events'
          )

          assert.ok(persistedCount.rows[0].count >= 6)

          const privileges = await independentPool.query(
            "SELECT has_table_privilege(current_user, 'audit.unlock_audit_events', 'SELECT') AS can_select, " +
              "has_table_privilege(current_user, 'audit.unlock_audit_events', 'INSERT') AS can_insert, " +
              "has_table_privilege(current_user, 'audit.unlock_audit_events', 'UPDATE') AS can_update, " +
              "has_table_privilege(current_user, 'audit.unlock_audit_events', 'DELETE') AS can_delete, " +
              "has_table_privilege(current_user, 'audit.unlock_audit_events', 'TRUNCATE') AS can_truncate"
          )

          assert.deepEqual(privileges.rows[0], {
            can_select: true,
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_truncate: false
          })

          const separatedWriterPrivileges = await independentPool.query(`
            SELECT
              has_function_privilege(
                'icon_audit_runtime',
                'audit.begin_unlock_audit_attempt(uuid,text,text)',
                'EXECUTE'
              ) AS runtime_can_begin_attempt,
              has_function_privilege(
                'icon_audit_runtime',
                'audit.finish_unlock_audit(uuid,audit.unlock_audit_outcome)',
                'EXECUTE'
              ) AS runtime_can_finish_attempt,
              has_function_privilege(
                'icon_audit_runtime',
                'audit.record_unlock_reconciliation(bigint,audit.unlock_audit_outcome,text,audit.unlock_reconciliation_evidence_kind,text,text,boolean,bigint)',
                'EXECUTE'
              ) AS runtime_can_reconcile,
              has_function_privilege(
                'icon_audit_reconciler',
                'audit.begin_unlock_audit_attempt(uuid,text,text)',
                'EXECUTE'
              ) AS reconciler_can_begin_attempt,
              has_function_privilege(
                'icon_audit_reconciler',
                'audit.record_unlock_reconciliation(bigint,audit.unlock_audit_outcome,text,audit.unlock_reconciliation_evidence_kind,text,text,boolean,bigint)',
                'EXECUTE'
              ) AS reconciler_can_reconcile
          `)

          assert.deepEqual(separatedWriterPrivileges.rows[0], {
            runtime_can_begin_attempt: true,
            runtime_can_finish_attempt: true,
            runtime_can_reconcile: false,
            reconciler_can_begin_attempt: false,
            reconciler_can_reconcile: true
          })

          const functionPrivileges = await independentPool.query(`
            WITH audit_functions AS (
              SELECT
                p.oid,
                EXISTS (
                  SELECT 1
                    FROM pg_depend AS d
                    JOIN pg_extension AS e ON e.oid = d.refobjid
                   WHERE d.classid = 'pg_proc'::regclass
                     AND d.objid = p.oid
                     AND d.deptype = 'e'
                     AND e.extname = 'pgcrypto'
                ) AS is_pgcrypto,
                EXISTS (
                  SELECT 1
                    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
                   WHERE acl.grantee = 0
                     AND acl.privilege_type = 'EXECUTE'
                ) AS public_execute
              FROM pg_proc AS p
              JOIN pg_namespace AS n ON n.oid = p.pronamespace
              WHERE n.nspname = 'audit'
            )
            SELECT
              count(*) FILTER (WHERE public_execute)::integer AS public_execute_count,
              count(*) FILTER (
                WHERE is_pgcrypto AND has_function_privilege(current_user, oid, 'EXECUTE')
              )::integer AS runtime_pgcrypto_execute_count,
              count(*) FILTER (
                WHERE is_pgcrypto AND has_function_privilege('icon_dev', oid, 'EXECUTE')
              )::integer AS icon_dev_pgcrypto_execute_count,
              count(*) FILTER (
                WHERE is_pgcrypto AND has_function_privilege('icon_audit_owner', oid, 'EXECUTE')
              )::integer AS owner_pgcrypto_execute_count,
              has_function_privilege(
                'icon_audit_owner',
                'audit.digest(bytea,text)',
                'EXECUTE'
              ) AS owner_can_digest
            FROM audit_functions
          `)

          assert.deepEqual(functionPrivileges.rows[0], {
            public_execute_count: 0,
            runtime_pgcrypto_execute_count: 0,
            icon_dev_pgcrypto_execute_count: 0,
            owner_pgcrypto_execute_count: 1,
            owner_can_digest: true
          })

          await assert.rejects(
            independentPool.query('UPDATE audit.unlock_audit_events SET code = code'),
            error => error.code === '42501'
          )
          await assert.rejects(
            independentPool.query('DELETE FROM audit.unlock_audit_events'),
            error => error.code === '42501'
          )
          await assert.rejects(
            independentPool.query('TRUNCATE audit.unlock_audit_events'),
            error => error.code === '42501'
          )
          await assert.rejects(
            independentPool.query('INSERT INTO audit.unlock_audit_events DEFAULT VALUES'),
            error => error.code === '42501'
          )

          const integrity = await independentPool.query(
            'SELECT audit.verify_unlock_audit_chain() AS valid, ' +
              "(SELECT tableowner FROM pg_tables WHERE schemaname = 'audit' " +
              "AND tablename = 'unlock_audit_events') AS owner"
          )

          assert.deepEqual(integrity.rows[0], { valid: true, owner: 'icon_audit_owner' })
        } finally {
          await independentPool.end()
        }
      })
    } finally {
      await reconcilerPool.end()
      await pool.end()
    }
  }
)

test(
  'TS-20 stops and restarts the disposable audit database around unlock dispatch',
  { skip: !integrationEnabled || !outageConfiguration, concurrency: false },
  async t => {
    const configuration = readAuditDatabaseConfiguration(process.env, process.env.ICON_AUDIT_TEST_DB_NAME)
    const controller = createInstanceController(outageConfiguration)

    await t.test('a full outage before ATTEMPT commit refuses the write', async () => {
      const correlationId = randomUUID()
      const failurePool = createAuditDatabasePool(configuration)

      failurePool.on('error', () => {
        // Expected while every connection is terminated by the instance shutdown.
      })

      let response
      let responseBody
      let writes = 0

      try {
        const coordinator = new PostgresUserUnlockAuditCoordinator(createInstanceOutagePool(failurePool, controller, 1))

        const route = createRoute({
          coordinator,
          correlationId,
          unlock: async () => {
            writes += 1
          }
        })

        response = await postUnlock(route)
        responseBody = await response.json()
      } finally {
        await controller.start()
        await failurePool.end()
      }

      assert.equal(response.status, 503)
      assert.equal(response.headers.get('x-correlation-id'), correlationId)
      assert.deepEqual(responseBody, { error: 'USER_UNLOCK_AUDIT_UNAVAILABLE' })
      assert.equal(writes, 0)

      const recoveryPool = createAuditDatabasePool(configuration)

      try {
        assert.deepEqual((await queryAuditEvents(recoveryPool, correlationId)).rows, [])
      } finally {
        await recoveryPool.end()
      }
    })

    await t.test('a full outage after dispatch returns UNKNOWN and preserves ATTEMPT', async () => {
      const correlationId = randomUUID()
      const failurePool = createAuditDatabasePool(configuration)

      failurePool.on('error', () => {
        // Expected while every connection is terminated by the instance shutdown.
      })

      let response
      let responseBody
      let writes = 0

      try {
        const coordinator = new PostgresUserUnlockAuditCoordinator(createInstanceOutagePool(failurePool, controller, 2))

        const route = createRoute({
          coordinator,
          correlationId,
          unlock: async () => {
            writes += 1
          }
        })

        response = await postUnlock(route)
        responseBody = await response.json()
      } finally {
        await controller.start()
        await failurePool.end()
      }

      assert.equal(response.status, 503)
      assert.equal(response.headers.get('x-correlation-id'), correlationId)
      assert.deepEqual(responseBody, {
        error: 'USER_UNLOCK_OUTCOME_UNKNOWN',
        correlationId
      })
      assert.equal(writes, 1)

      const recoveryPool = createAuditDatabasePool(configuration)

      try {
        assert.deepEqual(
          (await queryAuditEvents(recoveryPool, correlationId)).rows.map(row => row.outcome),
          ['ATTEMPT']
        )
      } finally {
        await recoveryPool.end()
      }
    })
  }
)
