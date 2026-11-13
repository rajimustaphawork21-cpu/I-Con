# Local PostgreSQL audit database

## Scope

This setup supports the minimum Débloquer audit path on the existing native PostgreSQL instance. It does not use
Docker and does not enable live Keycloak writes. The supplied CDCF/CDCT source document is outside this checkout; it
was reviewed as specification evidence alongside the existing `UserUnlockAuditCoordinator` contract and RG-45 through
RG-48. The explicit reconciliation authorization decision is recorded in
`docs/decisions/DEC-AUDIT-RECON-001-security-reviewers.md`.

## Local roles and databases

- `icon_audit_owner`: NOLOGIN owner of the audit schema, type, table, functions, triggers, and indexes.
- `icon_audit_runtime`: restricted LOGIN used by I-Con. It can read audit/reconciliation records and execute only the
  normal unlock audit append/verify functions; it cannot append a reconciliation or perform direct table mutation.
- `icon_audit_reconciler`: separate restricted LOGIN used only by the local manual reconciliation CLI. It can execute
  `audit.record_unlock_reconciliation(...)`, but cannot execute normal unlock audit append functions, read or mutate
  audit tables directly, use sequences, own objects, manage roles, create databases, bypass RLS, or act as superuser.
- `icon_dev`: local developer/DBeaver login with CONNECT, schema USAGE, SELECT, and hash-chain verification only.
- `icon_audit`: local application audit database.
- `icon_audit_test`: separate integration-test database using the same restricted runtime role.

## Setup

Start the existing cluster if needed:

    sudo pg_ctlcluster 18 main start

Then run:

    pnpm db:audit:setup-local

The setup script generates separate runtime and reconciler passwords without printing them, updates `.env.local` with
mode 0600, prompts locally for a new `icon_dev` password, creates only missing roles/databases, applies all four
migrations to both databases, verifies the TCP identity, and runs the integration suite. Re-running it rotates only
the two restricted service passwords and reapplies the idempotent migration definitions.

## Server-side environment variables

- `ICON_AUDIT_DB_HOST`
- `ICON_AUDIT_DB_PORT`
- `ICON_AUDIT_DB_NAME`
- `ICON_AUDIT_DB_USER`
- `ICON_AUDIT_DB_PASSWORD`
- `ICON_AUDIT_DB_SSL_MODE`: `disable`, `require`, or `verify-full`; local native PostgreSQL uses `disable`.
- `ICON_AUDIT_RECONCILER_DB_USER`
- `ICON_AUDIT_RECONCILER_DB_PASSWORD`
- `ICON_AUDIT_TEST_DB_NAME`: the separate integration-test database.

No audit variable may use a `NEXT_PUBLIC_` prefix.

## DBeaver

Use the PostgreSQL driver and these fields:

- Host: `127.0.0.1`
- Port: `5432`
- Database: `icon_audit`
- Username: `icon_dev`
- Password: the value entered locally during setup; do not send it in chat or commit it.
- SSL: disabled for this loopback-only local connection.

Press **Test Connection** after the setup script's psql verification succeeds. DBeaver is an independent check; a
successful psql command does not prove that DBeaver has saved the same password or connection fields.

## Migration guarantees

`database/migrations/001_unlock_audit.sql` provides:

- a fixed-column event model with no password, token, secret, arbitrary payload, or raw upstream-response column;
- committed ATTEMPT before the writer is invoked;
- controlled SECURITY DEFINER append functions and no runtime direct INSERT;
- one ATTEMPT and at most one terminal event per correlation ID;
- valid transitions: SUCCESS/FAILURE/UNKNOWN require a prior ATTEMPT;
- database-generated timestamps;
- immutable UPDATE/DELETE/TRUNCATE triggers in addition to privilege revocation;
- no `PUBLIC`, runtime, or `icon_dev` execution of pgcrypto functions; the no-login owner receives only
  `digest(bytea, text)` for hash-chain calculation;
- a serialized SHA-256 hash chain across every event and a read-only verification function.

`database/migrations/002_unlock_audit_reconciliation.sql` adds a separate append-only reconciliation history with its
own SHA-256 chain, controlled evidence-gated append function, multiple PENDING reviews, and at most one RESOLVED record
per original ATTEMPT.

`database/migrations/003_separate_reconciliation_writer.sql` confines controlled reconciliation appends to the
dedicated database role. `database/migrations/004_reconciliation_reviewer_separation.sql` rejects an append when the
authenticated/local reviewer subject equals the operator subject on the original ATTEMPT.

The hash chain detects interior edits/deletions when verified, while object ownership, triggers, and privileges stop
the runtime role from performing them. PostgreSQL superusers and the no-login object owner remain trusted
administrative boundaries.

## Verification commands

Application identity over TCP:

    psql -X -h 127.0.0.1 -p 5432 -U icon_dev -d icon_audit \
      -c 'SELECT current_database(), current_user;'

Integration suite:

    pnpm test:audit:integration

Disposable whole-instance outage suite (creates, stops, restarts, and removes a PostgreSQL cluster under `/tmp`):

    pnpm test:audit:outage

All repository tests:

    pnpm test

Read-only DBeaver inspection:

    SELECT
      event_id,
      correlation_id,
      operator_subject,
      target_user_id,
      action,
      outcome,
      code,
      severity,
      occurred_at,
      encode(previous_event_hash, 'hex') AS previous_event_hash,
      encode(event_hash, 'hex') AS event_hash
    FROM audit.unlock_audit_events
    ORDER BY event_id DESC;

    SELECT audit.verify_unlock_audit_chain() AS hash_chain_valid;

## Read-only unlock reconciliation report

Run the report with the restricted runtime role. The default grace period is 15 minutes; override it with a positive
whole number of minutes:

    pnpm audit:reconciliation-report -- --grace-minutes 15

The command performs one parameterized `SELECT` and emits separate `pending` and `resolved` JSON arrays. It never calls
an unlock writer or an audit append function. `operation_id` is the immutable ATTEMPT event ID. Each row also contains
the correlation ID, target user ID, ATTEMPT timestamp, optional terminal timestamp, and one of these reasons:

- `ATTEMPT_GRACE_PERIOD_EXCEEDED`: no terminal event exists after the configured grace period;
- `PERSISTED_UNKNOWN_OUTCOME`: the operation has a durable UNKNOWN terminal event.

The current Keycloak write adapter receives only the target account ID. It does not send the I-Con correlation ID to
Keycloak, so that ID is not available in Keycloak evidence today. An operator can actually compare the target user ID,
the narrow ATTEMPT/UNKNOWN timestamp window, the dedicated Keycloak service-account/client identity, and any available
Keycloak admin-event or server-access log for the brute-force reset endpoint. Current lock state is supporting evidence,
not proof of which request changed it, and this repository does not prove that Keycloak admin-event logging is enabled.

### Manual reconciliation

Record an inconclusive review without closing the item:

    pnpm audit:reconcile -- \
      --operation-id 123 \
      --pending \
      --reviewer security-reviewer-subject \
      --evidence-kind BACKEND_LOG \
      --evidence-reference backend-log:request-reference \
      --rationale "The available evidence does not establish whether the unlock was applied."

Record a definitive resolution only after authoritative evidence establishes SUCCESS or FAILURE:

    pnpm audit:reconcile -- \
      --operation-id 123 \
      --evidence-confirmed \
      --outcome SUCCESS \
      --reviewer security-reviewer-subject \
      --evidence-kind KEYCLOAK_ADMIN_EVENT \
      --evidence-reference keycloak-admin-event:event-reference \
      --rationale "The referenced Keycloak admin event confirms that the unlock was applied."

Allowed evidence kinds are `KEYCLOAK_ADMIN_EVENT`, `KEYCLOAK_SERVER_LOG`, `BACKEND_LOG`, and `OTHER_AUTHORITATIVE`.
There is deliberately no current-lock-state evidence kind. The CLI never invokes or retries an unlock operation.
The local CLI connects as `icon_audit_reconciler`. Its `--reviewer` value is local-only metadata; it is neither
authenticated nor an authorization decision and must not be treated as a production reviewer identity.

### Authenticated server reconciliation

Designated Security reviewers receive the exact `icon-bff` Client Role `audit:unlock:reconcile` in addition to exactly
one ordinary portal role. The permission applies across I-Con and allows both PENDING reviews and definitive
resolutions, but the CDCF/CDCT read-only `AUD` profile is always denied this write. An eligible reviewer therefore
needs exactly one of `OPS-N1`, `ADM-APP`, or `ADM-CONSOLE` plus the permission. DEC-AUTH-001 still rejects a session
with zero or multiple recognized portal roles.

The endpoint is `POST /api/audit/unlock-reconciliations/{operationId}`. It derives `reviewer_subject` only from the
validated Auth.js `session.user.id`; `reviewer`, `reviewerSubject`, and `reviewer_subject` request fields are rejected.
It connects through `icon_audit_reconciler`, never sends or retries an unlock, and PostgreSQL rejects a reviewer who
was the original unlock operator.

PENDING body:

    {
      "status": "PENDING",
      "evidenceKind": "BACKEND_LOG",
      "evidenceReference": "backend-log:request-reference",
      "rationale": "The available evidence does not establish a definitive outcome."
    }

Definitive body:

    {
      "status": "RESOLVED",
      "outcome": "SUCCESS",
      "evidenceConfirmed": true,
      "evidenceKind": "KEYCLOAK_ADMIN_EVENT",
      "evidenceReference": "keycloak-admin-event:event-reference",
      "rationale": "The authoritative event confirms that the unlock succeeded."
    }

Migration `002_unlock_audit_reconciliation.sql` adds a separately hash-chained, append-only reconciliation table. It
allows multiple PENDING reviews but at most one RESOLVED record per ATTEMPT. The original ATTEMPT and UNKNOWN remain
unchanged in `unlock_audit_events`, so its hash chain and one-terminal-event constraint are preserved. A resolution
references the ATTEMPT event ID and appends reviewer, evidence, rationale, review time, and definitive outcome as a new
fact rather than rewriting history.

Migration `003_separate_reconciliation_writer.sql` revokes the reconciliation function from `icon_audit_runtime` and
grants it only to `icon_audit_reconciler`, without changing the runtime role's normal unlock audit functions.

Migration `004_reconciliation_reviewer_separation.sql` adds the database-level different-reviewer gate without
changing either append-only hash chain.

## Production enablement gaps

- Obtain formal Security/Product approval for UNKNOWN plus mandatory reconciliation as the RG-46/TS-20 behavior after
  Keycloak dispatch.
- Define production retention, archival, backup/restore, monitoring, alerting, clock synchronization, and independent
  hash-chain/anchor verification procedures.
- Establish operational ownership, alerting, review cadence, and a runbook for the manual reconciliation report.
- Provision and periodically review the designated `audit:unlock:reconcile` Keycloak Client Role assignments; the
  local `--reviewer` metadata remains outside production authentication.
- Classify Keycloak network failures into confirmed failure versus ambiguous post-dispatch outcome at the write
  adapter boundary.
- Exercise crash/restart and real network-partition fault tests against the production PostgreSQL topology.
- Provision and verify production TLS (`verify-full`) and certificate handling.
- Complete security/DBA review, production role provisioning, and live Keycloak fine-grained permission tests.
- Only after those gates should the production route inject the PostgreSQL coordinator and enable the Keycloak writer.
