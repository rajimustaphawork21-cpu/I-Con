import 'server-only'

// Auth Imports
import { PORTAL_CLIENT_ID, PORTAL_CLIENT_ROLES } from '@/libs/auth/claims'
import type { PortalClientRole } from '@/libs/auth/claims'

/**
 * Lot 1 operation catalogue. Anything outside this list is denied (CDCF RG-42).
 *
 * Role creation (RG-27), bulk operations (RG-34), audit browsing/export
 * (RG-49..RG-52), and console administration are Lot 2 and intentionally absent.
 */
export const LOT1_ACTIONS = {
  portalAccess: 'portal:access',
  userRead: 'user:read',
  userCreate: 'user:create',
  userProfileUpdate: 'user:profile:update',
  userStatusUpdate: 'user:status:update',
  userPasswordReset: 'user:password:reset',
  userUnlock: 'user:unlock',
  userSessionRead: 'user:session:read',
  userSessionTerminate: 'user:session:terminate',
  applicationRead: 'application:read',
  entitlementRead: 'entitlement:read',
  roleAssign: 'role:assign',
  roleRevoke: 'role:revoke',
  groupAssign: 'group:assign',
  groupRevoke: 'group:revoke'
} as const

export type Lot1Action = (typeof LOT1_ACTIONS)[keyof typeof LOT1_ACTIONS]

export const LOT1_WRITE_ACTIONS = [
  LOT1_ACTIONS.userCreate,
  LOT1_ACTIONS.userProfileUpdate,
  LOT1_ACTIONS.userStatusUpdate,
  LOT1_ACTIONS.userPasswordReset,
  LOT1_ACTIONS.userUnlock,
  LOT1_ACTIONS.userSessionTerminate,
  LOT1_ACTIONS.roleAssign,
  LOT1_ACTIONS.roleRevoke,
  LOT1_ACTIONS.groupAssign,
  LOT1_ACTIONS.groupRevoke
] as const satisfies readonly Lot1Action[]

export type Lot1WriteAction = (typeof LOT1_WRITE_ACTIONS)[number]

export type TrustedOperatorContext = {

  /** Authenticated Keycloak subject. */
  subject: string

  /** Exact validated icon-bff Client Roles. */
  roles: readonly string[]

  /** Application UUIDs loaded from the Console Database delegation table. */
  delegatedApplicationIds: readonly string[]

  /** Delegable role UUIDs loaded from trusted Console Database reference data. */
  delegableRoleIds: readonly string[]

  /** Delegable group UUIDs loaded from trusted Console Database reference data. */
  delegableGroupIds: readonly string[]

  /** Canonical profile-field names loaded from the modifiable-attributes reference data. */
  modifiableProfileFields: readonly string[]
}

/** All facts must include effective memberships inherited through groups/composites (RG-37). */
export type TrustedUserProtectionFacts = {
  hasRealmManagementRole: boolean
  hasRealmAdministrationRole: boolean
  isSsoAdministratorsGroupMember: boolean
  hasProtectedAttribute: boolean
  isServiceAccount: boolean
}

export type TrustedUserTarget = {

  /** Keycloak user ID; it is also the operator subject for self-change comparisons. */
  id: string

  username: string
  isLocked: boolean
  protection: TrustedUserProtectionFacts
}

export type TrustedApplicationTarget = {

  /** Keycloak internal Client UUID used by the delegation table. */
  id: string

  clientId: string
}

export type TrustedRoleTarget = {
  id: string
  name: string
  kind: 'client' | 'realm'
  applicationId: string
  isDelegable: boolean
  sensitivityWithinActorLimit: boolean
  effectivePermissionsWithinActorScope: boolean
  isAssignedToTarget: boolean
}

export type TrustedGroupTarget = {
  id: string
  isDelegable: boolean
  effectivePermissionsWithinActorScope: boolean
  isAssignedToTarget: boolean
}

/**
 * This object is a server-side contract, not request-body input. RG-41 requires an adapter to
 * reload every referenced user/application/role/group and construct these facts from Keycloak
 * plus Console Database reference data immediately before calling the policy.
 */
export type TrustedAuthorizationTarget = {
  user?: TrustedUserTarget
  application?: TrustedApplicationTarget
  role?: TrustedRoleTarget
  group?: TrustedGroupTarget
  profileFields?: readonly string[]
  requestedRoleIds?: readonly string[]
}

export type Lot1AuthorizationRequest = {
  operator: TrustedOperatorContext | null | undefined
  action: string
  target?: TrustedAuthorizationTarget
}

export type AuthorizationRule =
  | 'CDCF-2.2'
  | 'DEC-AUTH-001'
  | 'RG-00'
  | 'RG-02'
  | 'RG-13'
  | 'RG-15'
  | 'RG-21'
  | 'RG-25'
  | 'RG-26'
  | 'RG-30'
  | 'RG-31'
  | 'RG-32'
  | 'RG-35'
  | 'RG-36'
  | 'RG-37'
  | 'RG-38'
  | 'RG-39'
  | 'RG-41'
  | 'RG-42'

export type AuthorizationDenialReason =
  | 'UNKNOWN_ACTION'
  | 'UNAUTHENTICATED'
  | 'INVALID_OPERATOR_CONTEXT'
  | 'PORTAL_ROLE_REQUIRED'
  | 'SINGLE_PORTAL_ROLE_REQUIRED'
  | 'ACTION_NOT_ALLOWED'
  | 'MISSING_TRUSTED_TARGET'
  | 'PROTECTED_ACCOUNT'
  | 'SELF_CHANGE_FORBIDDEN'
  | 'ACCOUNT_NOT_LOCKED'
  | 'APPLICATION_OUT_OF_SCOPE'
  | 'SYSTEM_RESOURCE'
  | 'ROLE_NOT_DELEGABLE'
  | 'ROLE_OUT_OF_SCOPE'
  | 'ROLE_SENSITIVITY_EXCEEDED'
  | 'EFFECTIVE_PERMISSION_ESCALATION'
  | 'ROLE_ALREADY_ASSIGNED'
  | 'ROLE_NOT_ASSIGNED'
  | 'GROUP_NOT_DELEGABLE'
  | 'GROUP_OUT_OF_SCOPE'
  | 'GROUP_ALREADY_ASSIGNED'
  | 'GROUP_NOT_ASSIGNED'
  | 'PROFILE_FIELDS_NOT_ALLOWED'
  | 'COMPOUND_ROLE_ASSIGNMENT_REQUIRES_SEPARATE_AUTHORIZATION'

export type AuthorizationDecision =
  | { allowed: true; rules: readonly AuthorizationRule[] }
  | { allowed: false; reason: AuthorizationDenialReason; rules: readonly AuthorizationRule[] }

const ALL_PORTAL_ROLES: readonly PortalClientRole[] = PORTAL_CLIENT_ROLES
const USER_OPERATOR_ROLES: readonly PortalClientRole[] = ['OPS-N1', 'ADM-APP', 'ADM-CONSOLE']
const DELEGATION_OPERATOR_ROLES: readonly PortalClientRole[] = ['ADM-APP', 'ADM-CONSOLE']

const ACTION_ROLES: Readonly<Record<Lot1Action, readonly PortalClientRole[]>> = {
  [LOT1_ACTIONS.portalAccess]: ALL_PORTAL_ROLES,
  [LOT1_ACTIONS.userRead]: ALL_PORTAL_ROLES,
  [LOT1_ACTIONS.userCreate]: USER_OPERATOR_ROLES,
  [LOT1_ACTIONS.userProfileUpdate]: USER_OPERATOR_ROLES,
  [LOT1_ACTIONS.userStatusUpdate]: USER_OPERATOR_ROLES,
  [LOT1_ACTIONS.userPasswordReset]: USER_OPERATOR_ROLES,
  [LOT1_ACTIONS.userUnlock]: USER_OPERATOR_ROLES,
  [LOT1_ACTIONS.userSessionRead]: ALL_PORTAL_ROLES,
  [LOT1_ACTIONS.userSessionTerminate]: USER_OPERATOR_ROLES,
  [LOT1_ACTIONS.applicationRead]: ALL_PORTAL_ROLES,
  [LOT1_ACTIONS.entitlementRead]: ALL_PORTAL_ROLES,
  [LOT1_ACTIONS.roleAssign]: DELEGATION_OPERATOR_ROLES,
  [LOT1_ACTIONS.roleRevoke]: DELEGATION_OPERATOR_ROLES,
  [LOT1_ACTIONS.groupAssign]: DELEGATION_OPERATOR_ROLES,
  [LOT1_ACTIONS.groupRevoke]: DELEGATION_OPERATOR_ROLES
}

const KNOWN_ACTIONS = new Set<string>(Object.values(LOT1_ACTIONS))

const USER_TARGET_WRITES = new Set<Lot1Action>([
  LOT1_ACTIONS.userProfileUpdate,
  LOT1_ACTIONS.userStatusUpdate,
  LOT1_ACTIONS.userPasswordReset,
  LOT1_ACTIONS.userUnlock,
  LOT1_ACTIONS.userSessionTerminate,
  LOT1_ACTIONS.roleAssign,
  LOT1_ACTIONS.roleRevoke,
  LOT1_ACTIONS.groupAssign,
  LOT1_ACTIONS.groupRevoke
])

const APPLICATION_ACTIONS = new Set<Lot1Action>([
  LOT1_ACTIONS.applicationRead,
  LOT1_ACTIONS.entitlementRead,
  LOT1_ACTIONS.roleAssign,
  LOT1_ACTIONS.roleRevoke
])

const ROLE_ACTIONS = new Set<Lot1Action>([LOT1_ACTIONS.roleAssign, LOT1_ACTIONS.roleRevoke])

const GROUP_ACTIONS = new Set<Lot1Action>([LOT1_ACTIONS.groupAssign, LOT1_ACTIONS.groupRevoke])

const SYSTEM_CLIENT_IDS = new Set([
  'realm-management',
  'admin-cli',
  'security-admin-console',
  'account',
  'account-console',
  'broker',
  PORTAL_CLIENT_ID
])

const OPS_N1_PROFILE_FIELDS = new Set(['firstName', 'lastName', 'email', 'phone'])

const allow = (...rules: AuthorizationRule[]): AuthorizationDecision => ({ allowed: true, rules })

const deny = (reason: AuthorizationDenialReason, ...rules: AuthorizationRule[]): AuthorizationDecision => ({
  allowed: false,
  reason,
  rules
})

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isTrustedOperator = (value: unknown): value is TrustedOperatorContext => {
  if (!value || typeof value !== 'object') return false

  const operator = value as Partial<TrustedOperatorContext>

  return (
    typeof operator.subject === 'string' &&
    operator.subject.length > 0 &&
    isStringArray(operator.roles) &&
    isStringArray(operator.delegatedApplicationIds) &&
    isStringArray(operator.delegableRoleIds) &&
    isStringArray(operator.delegableGroupIds) &&
    isStringArray(operator.modifiableProfileFields)
  )
}

const isTrustedUser = (value: unknown): value is TrustedUserTarget => {
  if (!value || typeof value !== 'object') return false

  const user = value as Partial<TrustedUserTarget>
  const protection = user.protection as Partial<TrustedUserProtectionFacts> | undefined

  return (
    typeof user.id === 'string' &&
    user.id.length > 0 &&
    typeof user.username === 'string' &&
    user.username.length > 0 &&
    typeof user.isLocked === 'boolean' &&
    !!protection &&
    typeof protection.hasRealmManagementRole === 'boolean' &&
    typeof protection.hasRealmAdministrationRole === 'boolean' &&
    typeof protection.isSsoAdministratorsGroupMember === 'boolean' &&
    typeof protection.hasProtectedAttribute === 'boolean' &&
    typeof protection.isServiceAccount === 'boolean'
  )
}

const isProtectedUser = (user: TrustedUserTarget) =>
  user.username.startsWith('service-account-') ||
  user.protection.hasRealmManagementRole ||
  user.protection.hasRealmAdministrationRole ||
  user.protection.isSsoAdministratorsGroupMember ||
  user.protection.hasProtectedAttribute ||
  user.protection.isServiceAccount

const isTrustedApplication = (value: unknown): value is TrustedApplicationTarget => {
  if (!value || typeof value !== 'object') return false

  const application = value as Partial<TrustedApplicationTarget>

  return (
    typeof application.id === 'string' &&
    application.id.length > 0 &&
    typeof application.clientId === 'string' &&
    application.clientId.length > 0
  )
}

const isSystemApplication = (application: TrustedApplicationTarget) =>
  SYSTEM_CLIENT_IDS.has(application.clientId) || application.clientId.startsWith('realm-')

const isTrustedRole = (value: unknown): value is TrustedRoleTarget => {
  if (!value || typeof value !== 'object') return false

  const role = value as Partial<TrustedRoleTarget>

  return (
    typeof role.id === 'string' &&
    role.id.length > 0 &&
    typeof role.name === 'string' &&
    role.name.length > 0 &&
    (role.kind === 'client' || role.kind === 'realm') &&
    typeof role.applicationId === 'string' &&
    role.applicationId.length > 0 &&
    typeof role.isDelegable === 'boolean' &&
    typeof role.sensitivityWithinActorLimit === 'boolean' &&
    typeof role.effectivePermissionsWithinActorScope === 'boolean' &&
    typeof role.isAssignedToTarget === 'boolean'
  )
}

const isTrustedGroup = (value: unknown): value is TrustedGroupTarget => {
  if (!value || typeof value !== 'object') return false

  const group = value as Partial<TrustedGroupTarget>

  return (
    typeof group.id === 'string' &&
    group.id.length > 0 &&
    typeof group.isDelegable === 'boolean' &&
    typeof group.effectivePermissionsWithinActorScope === 'boolean' &&
    typeof group.isAssignedToTarget === 'boolean'
  )
}

const hasAnyRole = (operator: TrustedOperatorContext, roles: readonly PortalClientRole[]) =>
  roles.some(role => operator.roles.includes(role))

const getRecognizedPortalRoles = (operator: TrustedOperatorContext): PortalClientRole[] =>
  PORTAL_CLIENT_ROLES.filter(role => operator.roles.includes(role))

const authorizeApplication = (
  operator: TrustedOperatorContext,
  target: TrustedAuthorizationTarget | undefined
): AuthorizationDecision | null => {
  if (!isTrustedApplication(target?.application)) return deny('MISSING_TRUSTED_TARGET', 'RG-41')
  if (isSystemApplication(target.application)) return deny('SYSTEM_RESOURCE', 'RG-35', 'RG-36')

  if (!operator.delegatedApplicationIds.includes(target.application.id)) {
    return deny('APPLICATION_OUT_OF_SCOPE', 'RG-25', 'RG-41')
  }

  return null
}

const authorizeUserWrite = (
  operator: TrustedOperatorContext,
  target: TrustedAuthorizationTarget | undefined
): AuthorizationDecision | null => {
  if (!isTrustedUser(target?.user)) return deny('MISSING_TRUSTED_TARGET', 'RG-41')
  if (isProtectedUser(target.user)) return deny('PROTECTED_ACCOUNT', 'RG-37')
  if (target.user.id === operator.subject) return deny('SELF_CHANGE_FORBIDDEN', 'RG-38')

  return null
}

const authorizeProfileFields = (
  operator: TrustedOperatorContext,
  target: TrustedAuthorizationTarget | undefined
): AuthorizationDecision | null => {
  if (!isStringArray(target?.profileFields) || target.profileFields.length === 0) {
    return deny('MISSING_TRUSTED_TARGET', 'RG-15', 'RG-41')
  }

  const usesAllowedReferenceFields = target.profileFields.every(field =>
    operator.modifiableProfileFields.includes(field)
  )

  const obeysOpsN1Limit =
    !operator.roles.includes('OPS-N1') ||
    hasAnyRole(operator, ['ADM-APP', 'ADM-CONSOLE']) ||
    target.profileFields.every(field => OPS_N1_PROFILE_FIELDS.has(field))

  if (!usesAllowedReferenceFields || !obeysOpsN1Limit) {
    return deny('PROFILE_FIELDS_NOT_ALLOWED', 'CDCF-2.2', 'RG-15')
  }

  return null
}

const authorizeRole = (
  operator: TrustedOperatorContext,
  action: Lot1Action,
  target: TrustedAuthorizationTarget | undefined
): AuthorizationDecision | null => {
  if (!isTrustedRole(target?.role) || !isTrustedApplication(target?.application)) {
    return deny('MISSING_TRUSTED_TARGET', 'RG-41')
  }

  if (target.role.kind !== 'client' || target.role.applicationId !== target.application.id) {
    return deny('SYSTEM_RESOURCE', 'RG-35', 'RG-36', 'RG-41')
  }

  if (!target.role.isDelegable) return deny('ROLE_NOT_DELEGABLE', 'RG-26')
  if (!operator.delegableRoleIds.includes(target.role.id)) return deny('ROLE_OUT_OF_SCOPE', 'RG-30', 'RG-31', 'RG-39')

  if (!target.role.sensitivityWithinActorLimit) {
    return deny('ROLE_SENSITIVITY_EXCEEDED', 'RG-39')
  }

  if (!target.role.effectivePermissionsWithinActorScope) {
    return deny('EFFECTIVE_PERMISSION_ESCALATION', 'RG-37', 'RG-39')
  }

  if (action === LOT1_ACTIONS.roleAssign && target.role.isAssignedToTarget) {
    return deny('ROLE_ALREADY_ASSIGNED', 'RG-30')
  }

  if (action === LOT1_ACTIONS.roleRevoke && !target.role.isAssignedToTarget) {
    return deny('ROLE_NOT_ASSIGNED', 'RG-31')
  }

  return null
}

const authorizeGroup = (
  operator: TrustedOperatorContext,
  action: Lot1Action,
  target: TrustedAuthorizationTarget | undefined
): AuthorizationDecision | null => {
  if (!isTrustedGroup(target?.group)) return deny('MISSING_TRUSTED_TARGET', 'RG-41')
  if (!target.group.isDelegable) return deny('GROUP_NOT_DELEGABLE', 'RG-32')

  if (!operator.delegableGroupIds.includes(target.group.id)) {
    return deny('GROUP_OUT_OF_SCOPE', 'RG-32', 'RG-39')
  }

  if (!target.group.effectivePermissionsWithinActorScope) {
    return deny('EFFECTIVE_PERMISSION_ESCALATION', 'RG-37', 'RG-39')
  }

  if (action === LOT1_ACTIONS.groupAssign && target.group.isAssignedToTarget) {
    return deny('GROUP_ALREADY_ASSIGNED', 'RG-32')
  }

  if (action === LOT1_ACTIONS.groupRevoke && !target.group.isAssignedToTarget) {
    return deny('GROUP_NOT_ASSIGNED', 'RG-32')
  }

  return null
}

/** Exact, server-side, default-deny Lot 1 authorization policy (CDCF RG-00). */
export const authorizeLot1 = (request: Lot1AuthorizationRequest): AuthorizationDecision => {
  if (!KNOWN_ACTIONS.has(request.action)) return deny('UNKNOWN_ACTION', 'RG-42')
  if (!request.operator) return deny('UNAUTHENTICATED', 'RG-00')
  if (!isTrustedOperator(request.operator)) return deny('INVALID_OPERATOR_CONTEXT', 'RG-00', 'RG-41')

  const action = request.action as Lot1Action
  const operator = request.operator
  const recognizedPortalRoles = getRecognizedPortalRoles(operator)

  if (recognizedPortalRoles.length === 0) return deny('PORTAL_ROLE_REQUIRED', 'RG-02')

  // Portal admission remains governed by the existing Auth.js guard, outside DEC-AUTH-001.
  if (action === LOT1_ACTIONS.portalAccess) return allow('CDCF-2.2', 'RG-00')

  if (recognizedPortalRoles.length !== 1) {
    return deny('SINGLE_PORTAL_ROLE_REQUIRED', 'DEC-AUTH-001', 'RG-00')
  }

  if (!ACTION_ROLES[action].includes(recognizedPortalRoles[0])) {
    return deny('ACTION_NOT_ALLOWED', 'CDCF-2.2', 'RG-00')
  }

  if (action === LOT1_ACTIONS.userRead) {
    return allow('CDCF-2.2', 'RG-00')
  }

  if (action === LOT1_ACTIONS.userSessionRead) {
    if (!isTrustedUser(request.target?.user)) return deny('MISSING_TRUSTED_TARGET', 'RG-41')

    return allow('CDCF-2.2', 'RG-00', 'RG-41')
  }

  if (action === LOT1_ACTIONS.userCreate) {
    if (!isStringArray(request.target?.requestedRoleIds)) return deny('MISSING_TRUSTED_TARGET', 'RG-13', 'RG-41')

    // Role assignment is authorized as a separate operation with fully resolved role/application facts.
    if (request.target.requestedRoleIds.length > 0) {
      return deny('COMPOUND_ROLE_ASSIGNMENT_REQUIRES_SEPARATE_AUTHORIZATION', 'RG-13', 'RG-30', 'RG-41')
    }

    return allow('CDCF-2.2', 'RG-13')
  }

  if (USER_TARGET_WRITES.has(action)) {
    const userDecision = authorizeUserWrite(operator, request.target)

    if (userDecision) return userDecision
  }

  if (action === LOT1_ACTIONS.userProfileUpdate) {
    const fieldsDecision = authorizeProfileFields(operator, request.target)

    if (fieldsDecision) return fieldsDecision
  }

  if (action === LOT1_ACTIONS.userUnlock && request.target?.user?.isLocked !== true) {
    return deny('ACCOUNT_NOT_LOCKED', 'RG-21', 'RG-41')
  }

  if (APPLICATION_ACTIONS.has(action)) {
    const applicationDecision = authorizeApplication(operator, request.target)

    if (applicationDecision) return applicationDecision
  }

  if (ROLE_ACTIONS.has(action)) {
    const roleDecision = authorizeRole(operator, action, request.target)

    if (roleDecision) return roleDecision
  }

  if (GROUP_ACTIONS.has(action)) {
    const groupDecision = authorizeGroup(operator, action, request.target)

    if (groupDecision) return groupDecision
  }

  return allow('CDCF-2.2', 'RG-00')
}
