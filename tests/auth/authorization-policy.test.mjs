import assert from 'node:assert/strict'
import test from 'node:test'

import policyModule from '../../src/libs/auth/authorization-policy.ts'

const { AUDIT_ACTIONS, LOT1_ACTIONS, LOT1_WRITE_ACTIONS, authorizeLot1, authorizeUnlockAuditReconciliation } =
  policyModule

const application = {
  id: 'application-uuid',
  clientId: 'business-application'
}

const eligibleUser = {
  id: 'target-user',
  username: 'target.user',
  isLocked: true,
  protection: {
    hasRealmManagementRole: false,
    hasRealmAdministrationRole: false,
    isSsoAdministratorsGroupMember: false,
    hasProtectedAttribute: false,
    isServiceAccount: false
  }
}

const protectedUser = {
  ...eligibleUser,
  id: 'protected-user',
  protection: {
    ...eligibleUser.protection,
    hasRealmManagementRole: true
  }
}

const role = {
  id: 'role-uuid',
  name: 'business-role',
  kind: 'client',
  applicationId: application.id,
  isDelegable: true,
  sensitivityWithinActorLimit: true,
  effectivePermissionsWithinActorScope: true,
  isAssignedToTarget: false
}

const group = {
  id: 'group-uuid',
  isDelegable: true,
  effectivePermissionsWithinActorScope: true,
  isAssignedToTarget: false
}

const operator = (roles, overrides = {}) => ({
  subject: 'operator-user',
  roles,
  delegatedApplicationIds: [application.id],
  delegableRoleIds: [role.id],
  delegableGroupIds: [group.id],
  modifiableProfileFields: ['firstName', 'lastName', 'email', 'phone'],
  ...overrides
})

const fullTarget = (user = eligibleUser) => ({
  user,
  application,
  role,
  group,
  profileFields: ['firstName'],
  requestedRoleIds: []
})

const reviewer = (roles = ['ADM-CONSOLE'], permissions = [AUDIT_ACTIONS.unlockReconcile]) => ({
  subject: 'security-reviewer',
  roles,
  permissions
})

test('a designated Security reviewer with exactly one portal role may reconcile globally', () => {
  assert.deepEqual(authorizeUnlockAuditReconciliation(reviewer()), {
    allowed: true,
    rules: ['DEC-AUDIT-RECON-001', 'DEC-AUTH-001', 'RG-00', 'RG-42']
  })
})

test('AUD remains read-only even with the explicit reconciliation permission', () => {
  assert.deepEqual(authorizeUnlockAuditReconciliation(reviewer(['AUD'])), {
    allowed: false,
    reason: 'ACTION_NOT_ALLOWED',
    rules: ['CDCF-2.2', 'DEC-AUDIT-RECON-001', 'RG-00']
  })
})

test('reconciliation denies missing permission and ambiguous portal profiles', () => {
  assert.deepEqual(authorizeUnlockAuditReconciliation(reviewer(['ADM-CONSOLE'], [])), {
    allowed: false,
    reason: 'PERMISSION_REQUIRED',
    rules: ['DEC-AUDIT-RECON-001', 'RG-00', 'RG-42']
  })
  assert.deepEqual(authorizeUnlockAuditReconciliation(reviewer(['AUD', 'ADM-CONSOLE'])), {
    allowed: false,
    reason: 'SINGLE_PORTAL_ROLE_REQUIRED',
    rules: ['DEC-AUTH-001', 'RG-00']
  })
})

test('OPS-N1 may unlock an eligible account', () => {
  const decision = authorizeLot1({
    operator: operator(['OPS-N1']),
    action: LOT1_ACTIONS.userUnlock,
    target: fullTarget()
  })

  assert.equal(decision.allowed, true)
})

test('OPS-N1 may never assign a role', () => {
  const decision = authorizeLot1({
    operator: operator(['OPS-N1']),
    action: LOT1_ACTIONS.roleAssign,
    target: fullTarget()
  })

  assert.deepEqual(decision, {
    allowed: false,
    reason: 'ACTION_NOT_ALLOWED',
    rules: ['CDCF-2.2', 'RG-00']
  })
})

test('AUD may read authorized user and application data', () => {
  assert.equal(authorizeLot1({ operator: operator(['AUD']), action: LOT1_ACTIONS.userRead }).allowed, true)
  assert.equal(
    authorizeLot1({
      operator: operator(['AUD']),
      action: LOT1_ACTIONS.applicationRead,
      target: { application }
    }).allowed,
    true
  )
})

test('AUD may never perform a Lot 1 write', () => {
  for (const action of LOT1_WRITE_ACTIONS) {
    const decision = authorizeLot1({
      operator: operator(['AUD']),
      action,
      target: fullTarget()
    })

    assert.equal(decision.allowed, false, `${action} must be denied`)
    assert.equal(decision.reason, 'ACTION_NOT_ALLOWED', `${action} must be denied by the permission matrix`)
  }
})

for (const roles of [
  ['AUD', 'ADM-APP'],
  ['AUD', 'ADM-CONSOLE'],
  ['OPS-N1', 'ADM-APP']
]) {
  test(`${roles.join(' + ')} is denied for reads and writes`, () => {
    const readDecision = authorizeLot1({
      operator: operator(roles),
      action: LOT1_ACTIONS.applicationRead,
      target: { application }
    })

    const writeDecision = authorizeLot1({
      operator: operator(roles),
      action: LOT1_ACTIONS.roleAssign,
      target: fullTarget()
    })

    for (const decision of [readDecision, writeDecision]) {
      assert.deepEqual(decision, {
        allowed: false,
        reason: 'SINGLE_PORTAL_ROLE_REQUIRED',
        rules: ['DEC-AUTH-001', 'RG-00']
      })
    }
  })
}

test('business operations require one recognized role while portal admission remains unchanged', () => {
  const noRecognizedRole = authorizeLot1({
    operator: operator(['unknown-role']),
    action: LOT1_ACTIONS.userRead
  })

  const duplicateSingleRole = authorizeLot1({
    operator: operator(['AUD', 'AUD']),
    action: LOT1_ACTIONS.userRead
  })

  const multipleRolePortalAccess = authorizeLot1({
    operator: operator(['AUD', 'ADM-APP']),
    action: LOT1_ACTIONS.portalAccess
  })

  assert.equal(noRecognizedRole.allowed, false)
  assert.equal(noRecognizedRole.reason, 'PORTAL_ROLE_REQUIRED')
  assert.equal(duplicateSingleRole.allowed, true)
  assert.equal(multipleRolePortalAccess.allowed, true)
})

test('ADM-APP may assign an eligible delegable role inside its scope', () => {
  const decision = authorizeLot1({
    operator: operator(['ADM-APP']),
    action: LOT1_ACTIONS.roleAssign,
    target: fullTarget()
  })

  assert.equal(decision.allowed, true)
})

test('ADM-APP role assignment is denied outside its application scope', () => {
  const decision = authorizeLot1({
    operator: operator(['ADM-APP'], { delegatedApplicationIds: [] }),
    action: LOT1_ACTIONS.roleAssign,
    target: fullTarget()
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'APPLICATION_OUT_OF_SCOPE')
})

test('a protected account cannot be modified, including by ADM-CONSOLE', () => {
  const protectedTargetActions = [
    LOT1_ACTIONS.userProfileUpdate,
    LOT1_ACTIONS.userStatusUpdate,
    LOT1_ACTIONS.userPasswordReset,
    LOT1_ACTIONS.userUnlock,
    LOT1_ACTIONS.userSessionTerminate,
    LOT1_ACTIONS.roleAssign,
    LOT1_ACTIONS.roleRevoke,
    LOT1_ACTIONS.groupAssign,
    LOT1_ACTIONS.groupRevoke
  ]

  for (const action of protectedTargetActions) {
    const decision = authorizeLot1({
      operator: operator(['ADM-CONSOLE']),
      action,
      target: fullTarget(protectedUser)
    })

    assert.equal(decision.allowed, false, `${action} must be denied`)
    assert.equal(decision.reason, 'PROTECTED_ACCOUNT', `${action} must apply RG-37`)
  }
})

test('operators cannot change their own permissions', () => {
  const ownUser = { ...eligibleUser, id: 'operator-user' }

  for (const action of [
    LOT1_ACTIONS.roleAssign,
    LOT1_ACTIONS.roleRevoke,
    LOT1_ACTIONS.groupAssign,
    LOT1_ACTIONS.groupRevoke
  ]) {
    const decision = authorizeLot1({
      operator: operator(['ADM-APP']),
      action,
      target: fullTarget(ownUser)
    })

    assert.equal(decision.allowed, false, `${action} must be denied`)
    assert.equal(decision.reason, 'SELF_CHANGE_FORBIDDEN', `${action} must apply RG-38`)
  }
})

test('unknown actions and missing trusted target facts deny by default', () => {
  assert.deepEqual(authorizeLot1({ operator: operator(['ADM-CONSOLE']), action: 'keycloak:passthrough' }), {
    allowed: false,
    reason: 'UNKNOWN_ACTION',
    rules: ['RG-42']
  })

  const missingTarget = authorizeLot1({
    operator: operator(['ADM-APP']),
    action: LOT1_ACTIONS.roleAssign
  })

  assert.equal(missingTarget.allowed, false)
  assert.equal(missingTarget.reason, 'MISSING_TRUSTED_TARGET')
})

test('non-delegable, over-sensitive, and effectively escalating roles are denied', () => {
  const scenarios = [
    [{ ...role, isDelegable: false }, 'ROLE_NOT_DELEGABLE'],
    [{ ...role, sensitivityWithinActorLimit: false }, 'ROLE_SENSITIVITY_EXCEEDED'],
    [{ ...role, effectivePermissionsWithinActorScope: false }, 'EFFECTIVE_PERMISSION_ESCALATION']
  ]

  for (const [scenarioRole, reason] of scenarios) {
    const decision = authorizeLot1({
      operator: operator(['ADM-APP']),
      action: LOT1_ACTIONS.roleAssign,
      target: { ...fullTarget(), role: scenarioRole }
    })

    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, reason)
  }
})

test('system applications are denied even when they appear in configured scope', () => {
  const systemApplication = { id: 'system-app-uuid', clientId: 'realm-management' }

  const decision = authorizeLot1({
    operator: operator(['ADM-CONSOLE'], { delegatedApplicationIds: [systemApplication.id] }),
    action: LOT1_ACTIONS.applicationRead,
    target: { application: systemApplication }
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'SYSTEM_RESOURCE')
})
