#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_dir}/.." && pwd)"
migration_files=(
  "${repository_root}/database/migrations/001_unlock_audit.sql"
  "${repository_root}/database/migrations/002_unlock_audit_reconciliation.sql"
  "${repository_root}/database/migrations/003_separate_reconciliation_writer.sql"
  "${repository_root}/database/migrations/004_reconciliation_reviewer_separation.sql"
)
postgres_bin="$(pg_config --bindir)"
postgres_port="${ICON_AUDIT_OUTAGE_TEST_PORT:-55434}"
test_directory="$(mktemp -d /tmp/i-con-audit-outage.XXXXXX)"
data_directory="${test_directory}/data"
log_file="${test_directory}/postgres.log"
server_options="-h 127.0.0.1 -p ${postgres_port} -k ${test_directory}"

cleanup() {
  "${postgres_bin}/pg_ctl" -D "${data_directory}" stop -m fast >/dev/null 2>&1 || true

  case "${test_directory}" in
    /tmp/i-con-audit-outage.*) rm -rf -- "${test_directory}" ;;
  esac
}
trap cleanup EXIT

if pg_isready -h 127.0.0.1 -p "${postgres_port}" >/dev/null 2>&1; then
  printf 'Port %s is already serving PostgreSQL; set ICON_AUDIT_OUTAGE_TEST_PORT to a free port.\n' "${postgres_port}" >&2
  exit 1
fi

"${postgres_bin}/initdb" -D "${data_directory}" -A trust --no-locale >/dev/null
"${postgres_bin}/pg_ctl" -D "${data_directory}" -l "${log_file}" -o "${server_options}" start -w >/dev/null

psql -qX -h 127.0.0.1 -p "${postgres_port}" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE icon_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE icon_audit_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE icon_audit_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE icon_audit_reconciler LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL

"${postgres_bin}/createdb" -h 127.0.0.1 -p "${postgres_port}" --owner=icon_audit_owner icon_audit_outage_test
psql -qX -h 127.0.0.1 -p "${postgres_port}" -d postgres -v ON_ERROR_STOP=1 \
  -c 'REVOKE CONNECT, TEMPORARY ON DATABASE icon_audit_outage_test FROM PUBLIC'
psql -qX -h 127.0.0.1 -p "${postgres_port}" -d postgres -v ON_ERROR_STOP=1 \
  -c 'GRANT CONNECT ON DATABASE icon_audit_outage_test TO icon_dev, icon_audit_runtime, icon_audit_reconciler'
for _migration_pass in 1 2; do
  for migration_file in "${migration_files[@]}"; do
    psql -qX -h 127.0.0.1 -p "${postgres_port}" -d icon_audit_outage_test -v ON_ERROR_STOP=1 \
      -f - < "${migration_file}"
  done
done

runtime_password="$(openssl rand -hex 32)"
reconciler_password="$(openssl rand -hex 32)"

cd "${repository_root}"
export ICON_AUDIT_DB_HOST=127.0.0.1
export ICON_AUDIT_DB_PORT="${postgres_port}"
export ICON_AUDIT_DB_NAME=icon_audit_outage_test
export ICON_AUDIT_TEST_DB_NAME=icon_audit_outage_test
export ICON_AUDIT_DB_USER=icon_audit_runtime
export ICON_AUDIT_DB_PASSWORD="${runtime_password}"
export ICON_AUDIT_DB_SSL_MODE=disable
export ICON_AUDIT_RECONCILER_DB_USER=icon_audit_reconciler
export ICON_AUDIT_RECONCILER_DB_PASSWORD="${reconciler_password}"
export ICON_AUDIT_OUTAGE_TEST_PG_CTL="${postgres_bin}/pg_ctl"
export ICON_AUDIT_OUTAGE_TEST_PG_DATA="${data_directory}"
export ICON_AUDIT_OUTAGE_TEST_PG_LOG="${log_file}"
export ICON_AUDIT_OUTAGE_TEST_PG_OPTIONS="${server_options}"

pnpm test:audit:integration

cli_operation_id="$(
  psql -qX -h 127.0.0.1 -p "${postgres_port}" -U icon_audit_runtime -d icon_audit_outage_test -Atv ON_ERROR_STOP=1 \
    -c "SELECT attempt.event_id
          FROM audit.unlock_audit_events AS attempt
          JOIN audit.unlock_audit_events AS terminal
            ON terminal.correlation_id = attempt.correlation_id
           AND terminal.outcome = 'UNKNOWN'
          LEFT JOIN audit.unlock_audit_reconciliations AS resolution
            ON resolution.attempt_event_id = attempt.event_id
           AND resolution.status = 'RESOLVED'
         WHERE attempt.outcome = 'ATTEMPT'
           AND resolution.reconciliation_id IS NULL
         ORDER BY attempt.event_id
         LIMIT 1"
)"

pnpm audit:reconcile -- \
  --operation-id "${cli_operation_id}" \
  --evidence-confirmed \
  --outcome FAILURE \
  --reviewer outage-test-reviewer \
  --evidence-kind BACKEND_LOG \
  --evidence-reference backend-log:disposable-cli-test \
  --rationale "The disposable CLI test evidence confirms that no unlock was applied." \
  --grace-minutes 1 >/dev/null

pnpm audit:reconciliation-report -- --grace-minutes 1 >/dev/null
