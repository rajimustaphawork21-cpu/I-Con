# DEC-AUDIT-RECON-001 — Designated Security reviewers reconcile unlock audit outcomes

- Status: Accepted
- Scope: I-Con Débloquer audit reconciliation
- Complements: DEC-AUTH-001, RG-00, RG-42, RG-46, RG-47

## Decision

`audit:unlock:reconcile` is a separate exact Client Role on the Keycloak `icon-bff` client. It is granted only to
designated Security reviewers. It is a permission, not a portal profile: every reviewer must still hold exactly one
of `OPS-N1`, `ADM-APP`, `AUD`, or `ADM-CONSOLE`, and DEC-AUTH-001 continues to reject zero or multiple portal profiles.
The `AUD` profile remains read-only under CDCF/CDCT §2.2 and cannot reconcile even when its session also contains
`audit:unlock:reconcile`. An eligible reviewer must therefore have exactly one non-AUD portal role (`OPS-N1`,
`ADM-APP`, or `ADM-CONSOLE`) plus the explicit permission.

The permission is global across I-Con. It allows both inconclusive `PENDING` reviews and definitive `SUCCESS` or
`FAILURE` resolutions. Definitive resolution still requires authoritative evidence; current Keycloak lock state alone
is not sufficient.

The reviewer must be different from the operator recorded on the original unlock ATTEMPT. PostgreSQL enforces this
separation for every append, including callers outside the HTTP route.

## Authentication and enforcement boundary

Auth.js allowlists `audit:unlock:reconcile` from validated `icon-bff` Client Roles separately from portal profiles.
The server derives the reviewer identity exclusively from the authenticated Keycloak subject in `session.user.id`.
The reconciliation API rejects request-body reviewer fields and uses only the dedicated PostgreSQL reconciler
connection.

Provisioning the permission to a person is an IAM/Security administration action outside I-Con. The local CLI remains
an operations-only tool; its `--reviewer` argument is local metadata and is not a production authentication mechanism.
