\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE icon_audit_owner;

CREATE OR REPLACE FUNCTION audit.enforce_unlock_reconciliation_reviewer_separation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, audit
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM audit.unlock_audit_events AS attempt
     WHERE attempt.event_id = NEW.attempt_event_id
       AND attempt.outcome = 'ATTEMPT'::audit.unlock_audit_outcome
       AND attempt.operator_subject = NEW.reviewer_subject
  ) THEN
    RAISE EXCEPTION 'The original unlock operator cannot reconcile the operation'
      USING ERRCODE = '42501',
            CONSTRAINT = 'unlock_reconciliation_distinct_reviewer';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS unlock_reconciliation_distinct_reviewer
  ON audit.unlock_audit_reconciliations;
CREATE TRIGGER unlock_reconciliation_distinct_reviewer
  BEFORE INSERT ON audit.unlock_audit_reconciliations
  FOR EACH ROW EXECUTE FUNCTION audit.enforce_unlock_reconciliation_reviewer_separation();

REVOKE EXECUTE ON FUNCTION audit.enforce_unlock_reconciliation_reviewer_separation()
  FROM PUBLIC, icon_audit_runtime, icon_audit_reconciler, icon_dev;

RESET ROLE;
COMMIT;
