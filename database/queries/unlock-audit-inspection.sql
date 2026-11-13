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

SELECT
  reconciliation_id,
  attempt_event_id,
  status,
  resolved_outcome,
  reviewer_subject,
  evidence_kind,
  evidence_reference,
  rationale,
  reviewed_at,
  encode(previous_reconciliation_hash, 'hex') AS previous_reconciliation_hash,
  encode(reconciliation_hash, 'hex') AS reconciliation_hash
FROM audit.unlock_audit_reconciliations
ORDER BY reconciliation_id DESC;

SELECT audit.verify_unlock_reconciliation_chain() AS reconciliation_hash_chain_valid;
