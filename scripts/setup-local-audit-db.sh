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

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  sudo pg_ctlcluster 18 main start
fi

runtime_password="$(openssl rand -hex 32)"
reconciler_password="$(openssl rand -hex 32)"
ICON_AUDIT_DB_PASSWORD="${runtime_password}" \
ICON_AUDIT_RECONCILER_DB_PASSWORD="${reconciler_password}" \
node "${repository_root}/scripts/configure-local-audit-env.mjs"

sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres <<SQL
DO \$roles\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'icon_dev') THEN
    CREATE ROLE icon_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'icon_audit_owner') THEN
    CREATE ROLE icon_audit_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'icon_audit_runtime') THEN
    CREATE ROLE icon_audit_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'icon_audit_reconciler') THEN
    CREATE ROLE icon_audit_reconciler LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
\$roles\$;

ALTER ROLE icon_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE icon_audit_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE icon_audit_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE icon_audit_reconciler LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE icon_audit_runtime PASSWORD '${runtime_password}';
ALTER ROLE icon_audit_reconciler PASSWORD '${reconciler_password}';

DO \$memberships\$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT member.rolname AS member_role, granted.rolname AS granted_role
      FROM pg_auth_members
      JOIN pg_roles AS member ON member.oid = pg_auth_members.member
      JOIN pg_roles AS granted ON granted.oid = pg_auth_members.roleid
     WHERE member.rolname IN ('icon_audit_runtime', 'icon_audit_reconciler')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END
\$memberships\$;
SQL

printf '\nSet a local password for icon_dev. PostgreSQL will prompt twice and will not echo it.\n'
sudo -u postgres psql -X -d postgres -c '\password icon_dev'

for database_name in icon_audit icon_audit_test; do
  if ! sudo -u postgres psql -X -Atqc "SELECT 1 FROM pg_database WHERE datname = '${database_name}'" postgres | rg -q '^1$'; then
    sudo -u postgres createdb --owner=icon_audit_owner "${database_name}"
  fi

  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres \
    -c "ALTER DATABASE ${database_name} OWNER TO icon_audit_owner"
  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres \
    -c "REVOKE CONNECT, TEMPORARY ON DATABASE ${database_name} FROM PUBLIC"
  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres \
    -c "GRANT CONNECT ON DATABASE ${database_name} TO icon_dev, icon_audit_runtime, icon_audit_reconciler"
  for migration_file in "${migration_files[@]}"; do
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "${database_name}" -f - < "${migration_file}"
  done
done

printf '\nTCP verification for the same DBeaver login (enter the icon_dev password once):\n'
psql -X -h 127.0.0.1 -p 5432 -U icon_dev -d icon_audit \
  -c 'SELECT current_database(), current_user;'

printf '\nRunning the PostgreSQL audit integration tests with the restricted runtime role...\n'
cd "${repository_root}"
pnpm test:audit:integration
