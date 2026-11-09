# DEC-AUTH-001 — Exactly one portal role for business operations

- Status: Accepted
- Scope: Lot 1 server-side authorization policy
- Resolves: CDCF/CDCT §2.2 multi-role precedence gap

## Decision

An authenticated I-Con operator must have exactly one distinct recognized `icon-bff` portal role to use a
business operation. The recognized roles are `OPS-N1`, `ADM-APP`, `AUD`, and `ADM-CONSOLE`.

- Zero recognized roles: deny.
- More than one distinct recognized role: deny.
- Repeated copies of the same recognized role count as one distinct role.
- Unrecognized roles do not grant access and do not participate in the distinct-role count.
- No role precedence, permission union, or "most permissive role" behavior is applied.

This rule applies consistently to Lot 1 business reads and writes. Portal sign-in and the existing portal-entry
guard remain outside this decision and are unchanged.

## Rationale

CDCF/CDCT §2.2 defines permissions per profile but does not define how permissions combine when an operator has
multiple portal profiles. Denying ambiguous multi-profile business access preserves RG-00's server-side,
default-deny principle and prevents an `AUD` role from silently acquiring write access through another role.

## Enforcement boundary

The policy counts roles only after Auth.js has obtained and allowlisted validated `icon-bff` Client Roles. A future
business API adapter must call the policy for every operation. Resolving an invalid role assignment requires an IAM
or console-administration change outside this policy; the policy does not modify Keycloak.
