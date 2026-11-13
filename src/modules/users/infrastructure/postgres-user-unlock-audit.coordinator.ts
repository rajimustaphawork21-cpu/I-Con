import 'server-only'

// Third-party Imports
import { Pool } from 'pg'
import type { PoolClient, PoolConfig, QueryResult } from 'pg'

// User Imports
import { UserUnlockDispatchOutcomeUnknownError } from '@/modules/users/application/unlock-user.usecase'
import type {
  UserUnlockAuditBase,
  UserUnlockAuditCoordinator,
  UserUnlockAuditEvent,
  UserUnlockAuditExecutionResult
} from '@/modules/users/application/unlock-user.usecase'

export type AuditDatabaseSslMode = 'disable' | 'require' | 'verify-full'

export type AuditDatabaseConfiguration = {
  host: string
  port: number
  database: string
  user: string
  password: string
  sslMode: AuditDatabaseSslMode
}

export class AuditDatabaseConfigurationError extends Error {
  constructor() {
    super('PostgreSQL audit configuration is invalid')
    this.name = 'AuditDatabaseConfigurationError'
  }
}

export class AuditDatabaseWriteError extends Error {
  constructor() {
    super('PostgreSQL audit event was not durably confirmed')
    this.name = 'AuditDatabaseWriteError'
  }
}

export type AuditDatabaseClient = Pick<PoolClient, 'query' | 'release'>

export type AuditDatabasePool = {
  connect(): Promise<AuditDatabaseClient>
}

const readRequired = (value: string | undefined) => {
  const normalized = value?.trim()

  if (!normalized) throw new AuditDatabaseConfigurationError()

  return normalized
}

export const readAuditDatabaseConfiguration = (
  environment: NodeJS.ProcessEnv = process.env,
  databaseOverride?: string
): AuditDatabaseConfiguration => {
  const portValue = readRequired(environment.ICON_AUDIT_DB_PORT)
  const port = Number(portValue)
  const sslMode = readRequired(environment.ICON_AUDIT_DB_SSL_MODE)

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new AuditDatabaseConfigurationError()

  if (sslMode !== 'disable' && sslMode !== 'require' && sslMode !== 'verify-full') {
    throw new AuditDatabaseConfigurationError()
  }

  return {
    host: readRequired(environment.ICON_AUDIT_DB_HOST),
    port,
    database: readRequired(databaseOverride ?? environment.ICON_AUDIT_DB_NAME),
    user: readRequired(environment.ICON_AUDIT_DB_USER),
    password: readRequired(environment.ICON_AUDIT_DB_PASSWORD),
    sslMode
  }
}

export const readAuditReconcilerDatabaseConfiguration = (
  environment: NodeJS.ProcessEnv = process.env,
  databaseOverride?: string
): AuditDatabaseConfiguration => ({
  ...readAuditDatabaseConfiguration(environment, databaseOverride),
  user: readRequired(environment.ICON_AUDIT_RECONCILER_DB_USER),
  password: readRequired(environment.ICON_AUDIT_RECONCILER_DB_PASSWORD)
})

const toPoolConfiguration = (configuration: AuditDatabaseConfiguration): PoolConfig => ({
  host: configuration.host,
  port: configuration.port,
  database: configuration.database,
  user: configuration.user,
  password: configuration.password,
  application_name: 'i-con-audit',
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
  max: 5,
  ssl: configuration.sslMode === 'disable' ? false : { rejectUnauthorized: configuration.sslMode === 'verify-full' }
})

export const createAuditDatabasePool = (configuration = readAuditDatabaseConfiguration()) =>
  new Pool(toPoolConfiguration(configuration))

type TerminalOutcome = 'SUCCESS' | 'FAILURE' | 'UNKNOWN'

type TransactionStatement = {
  text: string
  values: readonly unknown[]
}

const decisionOutcome = (event: UserUnlockAuditEvent) => event.outcome.toUpperCase()
const decisionSeverity = (event: UserUnlockAuditEvent) => event.severity.toUpperCase()

export class PostgresUserUnlockAuditCoordinator implements UserUnlockAuditCoordinator {
  constructor(private readonly pool: AuditDatabasePool) {}

  async record(event: UserUnlockAuditEvent): Promise<void> {
    const confirmed = await this.commitStatement({
      text: 'SELECT audit.record_unlock_decision($1::uuid, $2, $3, $4, $5, $6)',
      values: [
        event.correlationId,
        event.operatorSubject,
        event.targetUserId ?? null,
        decisionOutcome(event),
        event.code,
        decisionSeverity(event)
      ]
    })

    if (!confirmed) throw new AuditDatabaseWriteError()
  }

  async execute(
    operationContext: UserUnlockAuditBase,
    operation: () => Promise<void>
  ): Promise<UserUnlockAuditExecutionResult> {
    const attemptConfirmed = await this.commitStatement({
      text: 'SELECT audit.begin_unlock_audit_attempt($1::uuid, $2, $3)',
      values: [operationContext.correlationId, operationContext.operatorSubject, operationContext.targetUserId ?? null]
    })

    if (!attemptConfirmed) return { outcome: 'unavailable', reason: 'ATTEMPT_NOT_CONFIRMED' }

    try {
      await operation()
    } catch (error) {
      if (error instanceof UserUnlockDispatchOutcomeUnknownError) {
        const unknownConfirmed = await this.commitTerminal(operationContext.correlationId, 'UNKNOWN')

        return unknownConfirmed
          ? { outcome: 'unknown', reason: 'KEYCLOAK_OUTCOME_AMBIGUOUS' }
          : { outcome: 'unknown', reason: 'TERMINAL_AUDIT_NOT_CONFIRMED' }
      }

      const failureConfirmed = await this.commitTerminal(operationContext.correlationId, 'FAILURE')

      return failureConfirmed ? { outcome: 'failure' } : { outcome: 'unknown', reason: 'TERMINAL_AUDIT_NOT_CONFIRMED' }
    }

    const successConfirmed = await this.commitTerminal(operationContext.correlationId, 'SUCCESS')

    return successConfirmed ? { outcome: 'success' } : { outcome: 'unknown', reason: 'TERMINAL_AUDIT_NOT_CONFIRMED' }
  }

  private commitTerminal(correlationId: string, outcome: TerminalOutcome) {
    return this.commitStatement({
      text: 'SELECT audit.finish_unlock_audit($1::uuid, $2::audit.unlock_audit_outcome)',
      values: [correlationId, outcome]
    })
  }

  /**
   * A resolved COMMIT is the durability boundary. A rejected or lost COMMIT acknowledgement is
   * never treated as confirmed, even when PostgreSQL may have committed it; reconciliation uses
   * the correlation ID and the database-enforced single terminal event.
   */
  private async commitStatement(statement: TransactionStatement): Promise<boolean> {
    let client: AuditDatabaseClient | undefined

    try {
      client = await this.pool.connect()
      await client.query('BEGIN')
      await client.query(statement.text, [...statement.values])
      await client.query('COMMIT')

      return true
    } catch {
      if (client) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // The connection may have failed after dispatch or after a committed acknowledgement was lost.
        }
      }

      return false
    } finally {
      client?.release()
    }
  }
}

export const queryAuditEvents = async (
  pool: { query: (text: string, values?: unknown[]) => Promise<QueryResult> },
  correlationId: string
) =>
  pool.query(
    `SELECT event_id, correlation_id, operator_subject, target_user_id, action,
            outcome::text AS outcome, code, severity, occurred_at,
            encode(previous_event_hash, 'hex') AS previous_event_hash,
            encode(event_hash, 'hex') AS event_hash
       FROM audit.unlock_audit_events
      WHERE correlation_id = $1::uuid
      ORDER BY event_id`,
    [correlationId]
  )

export const queryUnlockAuditReconciliation = async (
  pool: { query: (text: string, values?: unknown[]) => Promise<QueryResult> },
  gracePeriodMilliseconds: number
) => {
  if (!Number.isSafeInteger(gracePeriodMilliseconds) || gracePeriodMilliseconds < 1) {
    throw new AuditDatabaseConfigurationError()
  }

  return pool.query(
    `WITH operations AS (
       SELECT attempt.event_id::text AS operation_id,
              attempt.correlation_id,
              attempt.target_user_id,
              attempt.occurred_at AS attempted_at,
              terminal.occurred_at AS terminal_at,
              terminal.outcome::text AS terminal_outcome
         FROM audit.unlock_audit_events AS attempt
         LEFT JOIN audit.unlock_audit_events AS terminal
           ON terminal.correlation_id = attempt.correlation_id
          AND terminal.outcome <> 'ATTEMPT'::audit.unlock_audit_outcome
        WHERE attempt.outcome = 'ATTEMPT'::audit.unlock_audit_outcome
     ), reviewable AS (
       SELECT operations.*,
              CASE
                WHEN terminal_outcome = 'UNKNOWN' THEN 'PERSISTED_UNKNOWN_OUTCOME'
                ELSE 'ATTEMPT_GRACE_PERIOD_EXCEEDED'
              END AS review_reason
         FROM operations
        WHERE terminal_outcome = 'UNKNOWN'
           OR (
                terminal_outcome IS NULL
                AND attempted_at <= clock_timestamp() - ($1::double precision * interval '1 millisecond')
              )
     )
     SELECT CASE WHEN resolution.reconciliation_id IS NULL THEN 'PENDING' ELSE 'RESOLVED' END
              AS reconciliation_status,
            reviewable.operation_id,
            reviewable.correlation_id,
            reviewable.target_user_id,
            reviewable.attempted_at,
            reviewable.terminal_at,
            reviewable.review_reason,
            latest_review.reconciliation_id::text AS latest_reconciliation_id,
            latest_review.reviewer_subject,
            latest_review.reviewed_at,
            latest_review.evidence_kind::text AS evidence_kind,
            latest_review.evidence_reference,
            latest_review.rationale,
            resolution.resolved_outcome::text AS resolved_outcome
       FROM reviewable
       LEFT JOIN LATERAL (
         SELECT reconciliation_id,
                resolved_outcome
           FROM audit.unlock_audit_reconciliations
          WHERE attempt_event_id = reviewable.operation_id::bigint
            AND status = 'RESOLVED'
          LIMIT 1
       ) AS resolution ON true
       LEFT JOIN LATERAL (
         SELECT reconciliation_id,
                reviewer_subject,
                reviewed_at,
                evidence_kind,
                evidence_reference,
                rationale
           FROM audit.unlock_audit_reconciliations
          WHERE attempt_event_id = reviewable.operation_id::bigint
          ORDER BY reconciliation_id DESC
          LIMIT 1
       ) AS latest_review ON true
      ORDER BY reconciliation_status, attempted_at, operation_id`,
    [gracePeriodMilliseconds]
  )
}

export type UnlockReconciliationEvidenceKind =
  | 'KEYCLOAK_ADMIN_EVENT'
  | 'KEYCLOAK_SERVER_LOG'
  | 'BACKEND_LOG'
  | 'OTHER_AUTHORITATIVE'

export type UnlockReconciliationInput = {
  operationId: string
  resolvedOutcome: 'SUCCESS' | 'FAILURE' | null
  reviewerSubject: string
  evidenceKind: UnlockReconciliationEvidenceKind
  evidenceReference: string
  rationale: string
  evidenceIsDefinitive: boolean
  gracePeriodMilliseconds: number
}

export const recordUnlockAuditReconciliation = async (
  pool: { query: (text: string, values?: unknown[]) => Promise<QueryResult> },
  input: UnlockReconciliationInput
) => {
  if (!/^[1-9][0-9]*$/.test(input.operationId)) throw new AuditDatabaseConfigurationError()

  if (!Number.isSafeInteger(input.gracePeriodMilliseconds) || input.gracePeriodMilliseconds < 1) {
    throw new AuditDatabaseConfigurationError()
  }

  return pool.query(
    `SELECT audit.record_unlock_reconciliation(
       $1::bigint,
       $2::audit.unlock_audit_outcome,
       $3,
       $4::audit.unlock_reconciliation_evidence_kind,
       $5,
       $6,
       $7,
       $8::bigint
     ) AS reconciliation_id`,
    [
      input.operationId,
      input.resolvedOutcome,
      input.reviewerSubject,
      input.evidenceKind,
      input.evidenceReference,
      input.rationale,
      input.evidenceIsDefinitive,
      input.gracePeriodMilliseconds
    ]
  )
}
