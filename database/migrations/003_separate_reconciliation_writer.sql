\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE icon_audit_owner;

REVOKE ALL ON audit.unlock_audit_events FROM icon_audit_reconciler;
REVOKE ALL ON audit.unlock_audit_reconciliations FROM icon_audit_reconciler;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA audit FROM icon_audit_reconciler;

REVOKE EXECUTE ON FUNCTION audit.begin_unlock_audit_attempt(uuid, text, text)
  FROM icon_audit_reconciler;
REVOKE EXECUTE ON FUNCTION audit.finish_unlock_audit(uuid, audit.unlock_audit_outcome)
  FROM icon_audit_reconciler;
REVOKE EXECUTE ON FUNCTION audit.record_unlock_decision(
  uuid,
  text,
  text,
  audit.unlock_audit_outcome,
  text,
  text
) FROM icon_audit_reconciler;
REVOKE EXECUTE ON FUNCTION audit.verify_unlock_audit_chain()
  FROM icon_audit_reconciler;
REVOKE EXECUTE ON FUNCTION audit.verify_unlock_reconciliation_chain()
  FROM icon_audit_reconciler;

REVOKE EXECUTE ON FUNCTION audit.record_unlock_reconciliation(
  bigint,
  audit.unlock_audit_outcome,
  text,
  audit.unlock_reconciliation_evidence_kind,
  text,
  text,
  boolean,
  bigint
) FROM PUBLIC, icon_audit_runtime, icon_dev, icon_audit_reconciler;

GRANT USAGE ON SCHEMA audit TO icon_audit_reconciler;
GRANT USAGE ON TYPE audit.unlock_audit_outcome TO icon_audit_reconciler;
GRANT USAGE ON TYPE audit.unlock_reconciliation_status TO icon_audit_reconciler;
GRANT USAGE ON TYPE audit.unlock_reconciliation_evidence_kind TO icon_audit_reconciler;
GRANT EXECUTE ON FUNCTION audit.record_unlock_reconciliation(
  bigint,
  audit.unlock_audit_outcome,
  text,
  audit.unlock_reconciliation_evidence_kind,
  text,
  text,
  boolean,
  bigint
) TO icon_audit_reconciler;

RESET ROLE;
COMMIT;
