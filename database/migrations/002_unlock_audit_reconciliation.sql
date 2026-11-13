\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE icon_audit_owner;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type AS type
      JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
     WHERE namespace.nspname = 'audit'
       AND type.typname = 'unlock_reconciliation_status'
  ) THEN
    CREATE TYPE audit.unlock_reconciliation_status AS ENUM ('PENDING', 'RESOLVED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_type AS type
      JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
     WHERE namespace.nspname = 'audit'
       AND type.typname = 'unlock_reconciliation_evidence_kind'
  ) THEN
    CREATE TYPE audit.unlock_reconciliation_evidence_kind AS ENUM (
      'KEYCLOAK_ADMIN_EVENT',
      'KEYCLOAK_SERVER_LOG',
      'BACKEND_LOG',
      'OTHER_AUTHORITATIVE'
    );
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS audit.unlock_audit_reconciliations (
  reconciliation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_event_id bigint NOT NULL REFERENCES audit.unlock_audit_events (event_id),
  status audit.unlock_reconciliation_status NOT NULL,
  resolved_outcome audit.unlock_audit_outcome,
  reviewer_subject text NOT NULL,
  evidence_kind audit.unlock_reconciliation_evidence_kind NOT NULL,
  evidence_reference text NOT NULL,
  rationale text NOT NULL,
  reviewed_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  previous_reconciliation_hash bytea,
  reconciliation_hash bytea NOT NULL,
  CONSTRAINT unlock_reconciliation_reviewer_format CHECK (char_length(reviewer_subject) BETWEEN 1 AND 255),
  CONSTRAINT unlock_reconciliation_evidence_reference_format CHECK (
    char_length(evidence_reference) BETWEEN 1 AND 1000
  ),
  CONSTRAINT unlock_reconciliation_rationale_format CHECK (char_length(rationale) BETWEEN 10 AND 4000),
  CONSTRAINT unlock_reconciliation_status_outcome CHECK (
    (status = 'PENDING' AND resolved_outcome IS NULL)
    OR (status = 'RESOLVED' AND resolved_outcome IN ('SUCCESS', 'FAILURE'))
  ),
  CONSTRAINT unlock_reconciliation_previous_hash_size CHECK (
    previous_reconciliation_hash IS NULL OR octet_length(previous_reconciliation_hash) = 32
  ),
  CONSTRAINT unlock_reconciliation_hash_size CHECK (octet_length(reconciliation_hash) = 32)
);

COMMENT ON TABLE audit.unlock_audit_reconciliations IS
  'Append-only manual reviews and definitive resolutions linked to the original Débloquer ATTEMPT event.';
COMMENT ON COLUMN audit.unlock_audit_reconciliations.attempt_event_id IS
  'Immutable operation identifier: the event_id of the original ATTEMPT.';
COMMENT ON COLUMN audit.unlock_audit_reconciliations.evidence_reference IS
  'Reference to authoritative evidence only; never store credentials, tokens, secrets, or raw upstream responses.';

CREATE UNIQUE INDEX IF NOT EXISTS unlock_reconciliation_one_resolution_per_attempt
  ON audit.unlock_audit_reconciliations (attempt_event_id)
  WHERE status = 'RESOLVED';

CREATE INDEX IF NOT EXISTS unlock_reconciliation_attempt_history
  ON audit.unlock_audit_reconciliations (attempt_event_id, reconciliation_id DESC);

CREATE INDEX IF NOT EXISTS unlock_reconciliation_reviewed_at
  ON audit.unlock_audit_reconciliations (reviewed_at DESC, reconciliation_id DESC);

CREATE OR REPLACE FUNCTION audit.compute_unlock_reconciliation_hash(
  p_previous_reconciliation_hash bytea,
  p_attempt_event_id bigint,
  p_status audit.unlock_reconciliation_status,
  p_resolved_outcome audit.unlock_audit_outcome,
  p_reviewer_subject text,
  p_evidence_kind audit.unlock_reconciliation_evidence_kind,
  p_evidence_reference text,
  p_rationale text,
  p_reviewed_at timestamptz
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, audit
AS $function$
  SELECT audit.digest(
    convert_to(
      jsonb_build_array(
        encode(p_previous_reconciliation_hash, 'hex'),
        p_attempt_event_id,
        p_status::text,
        p_resolved_outcome::text,
        p_reviewer_subject,
        p_evidence_kind::text,
        p_evidence_reference,
        p_rationale,
        to_char(p_reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text,
      'UTF8'
    ),
    'sha256'
  )
$function$;

CREATE OR REPLACE FUNCTION audit.record_unlock_reconciliation(
  p_attempt_event_id bigint,
  p_resolved_outcome audit.unlock_audit_outcome,
  p_reviewer_subject text,
  p_evidence_kind audit.unlock_reconciliation_evidence_kind,
  p_evidence_reference text,
  p_rationale text,
  p_evidence_is_definitive boolean,
  p_grace_period_milliseconds bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, audit
AS $function$
DECLARE
  v_attempt audit.unlock_audit_events%ROWTYPE;
  v_terminal_outcome audit.unlock_audit_outcome;
  v_status audit.unlock_reconciliation_status;
  v_previous_reconciliation_hash bytea;
  v_reconciliation_hash bytea;
  v_reconciliation_id bigint;
  v_reviewed_at timestamptz(6) := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(122993337, 4749);

  IF p_grace_period_milliseconds IS NULL
     OR p_grace_period_milliseconds < 1
     OR p_grace_period_milliseconds > 31536000000
  THEN
    RAISE EXCEPTION 'Invalid reconciliation grace period' USING ERRCODE = '22023';
  END IF;

  IF p_reviewer_subject IS NULL OR char_length(p_reviewer_subject) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Reviewer identity is required' USING ERRCODE = '23514';
  END IF;

  IF p_evidence_reference IS NULL OR char_length(p_evidence_reference) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Authoritative evidence reference is required' USING ERRCODE = '23514';
  END IF;

  IF p_evidence_kind IS NULL THEN
    RAISE EXCEPTION 'Authoritative evidence kind is required' USING ERRCODE = '23514';
  END IF;

  IF p_rationale IS NULL OR char_length(p_rationale) NOT BETWEEN 10 AND 4000 THEN
    RAISE EXCEPTION 'Reconciliation rationale is required' USING ERRCODE = '23514';
  END IF;

  IF p_evidence_is_definitive IS NULL THEN
    RAISE EXCEPTION 'Evidence assessment is required' USING ERRCODE = '23514';
  ELSIF p_evidence_is_definitive THEN
    IF p_resolved_outcome IS NULL OR p_resolved_outcome NOT IN ('SUCCESS', 'FAILURE') THEN
      RAISE EXCEPTION 'Definitive evidence requires SUCCESS or FAILURE' USING ERRCODE = '23514';
    END IF;

    v_status := 'RESOLVED';
  ELSE
    IF p_resolved_outcome IS NOT NULL THEN
      RAISE EXCEPTION 'Inconclusive evidence cannot set an outcome' USING ERRCODE = '23514';
    END IF;

    v_status := 'PENDING';
  END IF;

  SELECT *
    INTO v_attempt
    FROM audit.unlock_audit_events
   WHERE event_id = p_attempt_event_id
     AND outcome = 'ATTEMPT';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original ATTEMPT event does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT outcome
    INTO v_terminal_outcome
    FROM audit.unlock_audit_events
   WHERE correlation_id = v_attempt.correlation_id
     AND outcome <> 'ATTEMPT';

  IF v_terminal_outcome IS NOT NULL AND v_terminal_outcome <> 'UNKNOWN' THEN
    RAISE EXCEPTION 'Completed operation does not require reconciliation' USING ERRCODE = '23514';
  END IF;

  IF v_terminal_outcome IS NULL
     AND v_attempt.occurred_at > v_reviewed_at - (p_grace_period_milliseconds::double precision * interval '1 millisecond')
  THEN
    RAISE EXCEPTION 'ATTEMPT is still inside the reconciliation grace period' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM audit.unlock_audit_reconciliations
     WHERE attempt_event_id = p_attempt_event_id
       AND status = 'RESOLVED'
  ) THEN
    RAISE EXCEPTION 'Operation already has a definitive resolution' USING ERRCODE = '23505';
  END IF;

  SELECT reconciliation_hash
    INTO v_previous_reconciliation_hash
    FROM audit.unlock_audit_reconciliations
   ORDER BY reconciliation_id DESC
   LIMIT 1;

  v_reconciliation_hash := audit.compute_unlock_reconciliation_hash(
    v_previous_reconciliation_hash,
    p_attempt_event_id,
    v_status,
    p_resolved_outcome,
    p_reviewer_subject,
    p_evidence_kind,
    p_evidence_reference,
    p_rationale,
    v_reviewed_at
  );

  INSERT INTO audit.unlock_audit_reconciliations (
    attempt_event_id,
    status,
    resolved_outcome,
    reviewer_subject,
    evidence_kind,
    evidence_reference,
    rationale,
    reviewed_at,
    previous_reconciliation_hash,
    reconciliation_hash
  )
  VALUES (
    p_attempt_event_id,
    v_status,
    p_resolved_outcome,
    p_reviewer_subject,
    p_evidence_kind,
    p_evidence_reference,
    p_rationale,
    v_reviewed_at,
    v_previous_reconciliation_hash,
    v_reconciliation_hash
  )
  RETURNING reconciliation_id INTO v_reconciliation_id;

  RETURN v_reconciliation_id;
END
$function$;

CREATE OR REPLACE FUNCTION audit.reject_unlock_reconciliation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, audit
AS $function$
BEGIN
  RAISE EXCEPTION 'Unlock reconciliation records are append-only' USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS unlock_reconciliation_no_update_or_delete ON audit.unlock_audit_reconciliations;
CREATE TRIGGER unlock_reconciliation_no_update_or_delete
  BEFORE UPDATE OR DELETE ON audit.unlock_audit_reconciliations
  FOR EACH ROW EXECUTE FUNCTION audit.reject_unlock_reconciliation_mutation();

DROP TRIGGER IF EXISTS unlock_reconciliation_no_truncate ON audit.unlock_audit_reconciliations;
CREATE TRIGGER unlock_reconciliation_no_truncate
  BEFORE TRUNCATE ON audit.unlock_audit_reconciliations
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_unlock_reconciliation_mutation();

CREATE OR REPLACE FUNCTION audit.verify_unlock_reconciliation_chain()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, audit
AS $function$
DECLARE
  v_reconciliation audit.unlock_audit_reconciliations%ROWTYPE;
  v_expected_hash bytea;
  v_previous_reconciliation_hash bytea;
BEGIN
  FOR v_reconciliation IN
    SELECT * FROM audit.unlock_audit_reconciliations ORDER BY reconciliation_id
  LOOP
    IF v_reconciliation.previous_reconciliation_hash IS DISTINCT FROM v_previous_reconciliation_hash THEN
      RETURN false;
    END IF;

    v_expected_hash := audit.compute_unlock_reconciliation_hash(
      v_previous_reconciliation_hash,
      v_reconciliation.attempt_event_id,
      v_reconciliation.status,
      v_reconciliation.resolved_outcome,
      v_reconciliation.reviewer_subject,
      v_reconciliation.evidence_kind,
      v_reconciliation.evidence_reference,
      v_reconciliation.rationale,
      v_reconciliation.reviewed_at
    );

    IF v_reconciliation.reconciliation_hash IS DISTINCT FROM v_expected_hash THEN
      RETURN false;
    END IF;

    v_previous_reconciliation_hash := v_reconciliation.reconciliation_hash;
  END LOOP;

  RETURN true;
END
$function$;

REVOKE ALL ON TYPE audit.unlock_reconciliation_status FROM PUBLIC;
REVOKE ALL ON TYPE audit.unlock_reconciliation_evidence_kind FROM PUBLIC;
REVOKE ALL ON audit.unlock_audit_reconciliations FROM PUBLIC, icon_audit_runtime, icon_dev;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA audit FROM PUBLIC, icon_audit_runtime, icon_dev;
REVOKE EXECUTE ON FUNCTION audit.compute_unlock_reconciliation_hash(
  bytea,
  bigint,
  audit.unlock_reconciliation_status,
  audit.unlock_audit_outcome,
  text,
  audit.unlock_reconciliation_evidence_kind,
  text,
  text,
  timestamptz
) FROM PUBLIC, icon_audit_runtime, icon_dev;
REVOKE EXECUTE ON FUNCTION audit.record_unlock_reconciliation(
  bigint,
  audit.unlock_audit_outcome,
  text,
  audit.unlock_reconciliation_evidence_kind,
  text,
  text,
  boolean,
  bigint
) FROM PUBLIC, icon_audit_runtime, icon_dev;
REVOKE EXECUTE ON FUNCTION audit.reject_unlock_reconciliation_mutation()
  FROM PUBLIC, icon_audit_runtime, icon_dev;
REVOKE EXECUTE ON FUNCTION audit.verify_unlock_reconciliation_chain()
  FROM PUBLIC, icon_audit_runtime, icon_dev;

GRANT USAGE ON TYPE audit.unlock_reconciliation_status TO icon_audit_runtime, icon_dev;
GRANT USAGE ON TYPE audit.unlock_reconciliation_evidence_kind TO icon_audit_runtime, icon_dev;
GRANT SELECT ON audit.unlock_audit_reconciliations TO icon_audit_runtime, icon_dev;
GRANT EXECUTE ON FUNCTION audit.record_unlock_reconciliation(
  bigint,
  audit.unlock_audit_outcome,
  text,
  audit.unlock_reconciliation_evidence_kind,
  text,
  text,
  boolean,
  bigint
) TO icon_audit_runtime;
GRANT EXECUTE ON FUNCTION audit.verify_unlock_reconciliation_chain() TO icon_audit_runtime, icon_dev;

RESET ROLE;
COMMIT;
