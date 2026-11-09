import assert from 'node:assert/strict'
import test from 'node:test'

import keycloakDirectoryModule from '../../src/modules/users/infrastructure/keycloak-user-directory.adapter.ts'

const { KeycloakUserDirectoryAdapter } = keycloakDirectoryModule

const tokenPath = '/realms/I-Con/protocol/openid-connect/token'
const userPath = '/admin/realms/I-Con/users/user-1'
const effectiveRealmManagementRolesPath = `${userPath}/role-mappings/clients/realm-management-uuid/composite`
const effectiveRealmRolesPath = `${userPath}/role-mappings/realm/composite`

const ordinaryFacts = {
  hasRealmManagementRole: false,
  hasRealmAdministrationRole: false,
  isSsoAdministratorsGroupMember: false,
  hasProtectedAttribute: false,
  isServiceAccount: false
}

const createProtectionResolver = ({
  user = { id: 'user-1', username: 'alice', enabled: true },
  effectiveRealmManagementRoles = [],
  effectiveRealmRoles = [],
  groups = [],
  failPath,
  includeProtectionConfiguration = true,
  realmManagementClientUuidValidated = true,
  realmManagementRoleVisibilityValidated = true,
  realmAdministrationRoleVisibilityValidated = true,
  realmAdministrationRoleNames = ['admin', 'create-realm']
} = {}) => {
  const requests = []

  const fetch = async (input, init = {}) => {
    const url = new URL(input)

    requests.push({ method: init.method ?? 'GET', pathname: url.pathname, search: url.search })

    if (url.pathname === tokenPath) return Response.json({ access_token: 'service-account-token' })
    if (failPath && url.pathname.includes(failPath)) return Response.json({ error: 'forbidden' }, { status: 403 })

    assert.equal(init.headers.authorization, 'Bearer service-account-token')

    if (url.pathname === userPath) return Response.json(user)
    if (url.pathname === effectiveRealmManagementRolesPath) return Response.json(effectiveRealmManagementRoles)
    if (url.pathname === effectiveRealmRolesPath) return Response.json(effectiveRealmRoles)
    if (url.pathname === `${userPath}/groups/count`) return Response.json({ count: groups.length })

    if (url.pathname === `${userPath}/groups`) {
      const first = Number(url.searchParams.get('first'))
      const max = Number(url.searchParams.get('max'))

      return Response.json(groups.slice(first, first + max))
    }

    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const adapter = new KeycloakUserDirectoryAdapter({
    configuration: {
      adminBaseUrl: 'https://keycloak.example.test',
      realm: 'I-Con',
      clientId: 'icon-directory-reader',
      clientSecret: 'test-secret',
      ...(includeProtectionConfiguration
        ? {
            realmManagementClientUuid: 'realm-management-uuid',
            realmManagementClientUuidValidated,
            realmManagementRoleVisibilityValidated,
            realmAdministrationRoleNames,
            realmAdministrationRoleVisibilityValidated,
            ssoAdministratorsGroupPath: '/Administrateurs-SSO'
          }
        : {})
    },
    fetch
  })

  return {
    requests,
    resolve: () => adapter.resolveProtection({ id: 'user-1', username: 'alice' })
  }
}

test('an ordinary account resolves every RG-37 fact as verified false', async () => {
  const { resolve } = createProtectionResolver()

  assert.deepEqual(await resolve(), { resolution: 'resolved', value: ordinaryFacts })
})

test('an effective realm-management role protects the account', async () => {
  const { requests, resolve } = createProtectionResolver({
    effectiveRealmManagementRoles: [{ name: 'view-users' }]
  })

  const protection = await resolve()

  assert.equal(protection.value.hasRealmManagementRole, true)
  assert.equal(protection.value.hasRealmAdministrationRole, false)
  assert.ok(
    requests.some(
      request =>
        request.pathname === effectiveRealmManagementRolesPath &&
        request.search.includes('briefRepresentation=true')
    )
  )
})

test('a realm-management realm-admin composite is classified as a client role', async () => {
  const { resolve } = createProtectionResolver({
    effectiveRealmManagementRoles: [{ name: 'realm-admin' }, { name: 'manage-users' }]
  })

  const protection = await resolve()

  assert.equal(protection.value.hasRealmManagementRole, true)
  assert.equal(protection.value.hasRealmAdministrationRole, false)
})

test('an approved effective realm administration role is evaluated separately', async () => {
  const { requests, resolve } = createProtectionResolver({ effectiveRealmRoles: [{ name: 'admin' }] })
  const protection = await resolve()

  assert.equal(protection.value.hasRealmManagementRole, false)
  assert.equal(protection.value.hasRealmAdministrationRole, true)
  assert.ok(
    requests.some(
      request =>
        request.pathname === effectiveRealmRolesPath && request.search.includes('briefRepresentation=true')
    )
  )
})

test('effective roles inherited through groups or composites are included by the composite endpoint', async () => {
  const { requests, resolve } = createProtectionResolver({
    effectiveRealmManagementRoles: [{ name: 'query-users' }]
  })

  const protection = await resolve()

  assert.equal(protection.value.hasRealmManagementRole, true)
  assert.ok(requests.some(request => request.pathname.endsWith('/composite')))
  assert.ok(!requests.some(request => request.pathname.endsWith('/role-mappings/clients/realm-management-uuid')))
})

test('Administrateurs-SSO membership is found across complete paginated group membership', async () => {
  const groups = Array.from({ length: 100 }, (_value, index) => ({ path: `/Ordinaire-${index}` }))

  groups.push({ path: '/Administrateurs-SSO/Administrateurs-Délégués' })

  const { requests, resolve } = createProtectionResolver({ groups })
  const protection = await resolve()

  assert.equal(protection.value.isSsoAdministratorsGroupMember, true)
  assert.equal(requests.filter(request => request.pathname === `${userPath}/groups`).length, 2)
})

test('the protected=true user attribute protects the account', async () => {
  const { resolve } = createProtectionResolver({
    user: { id: 'user-1', username: 'alice', enabled: true, attributes: { protected: ['true'] } }
  })

  const protection = await resolve()

  assert.equal(protection.value.hasProtectedAttribute, true)
})

test('protected=true remains protected when a later role lookup fails', async () => {
  const { resolve } = createProtectionResolver({
    user: { id: 'user-1', username: 'alice', enabled: true, attributes: { protected: ['true'] } },
    failPath: '/role-mappings/clients/'
  })

  const protection = await resolve()

  assert.equal(protection.resolution, 'resolved')
  assert.equal(protection.value.hasProtectedAttribute, true)
})

test('an empty filtered realm-management role response stays unresolved without visibility attestation', async () => {
  const { resolve } = createProtectionResolver({ realmManagementRoleVisibilityValidated: false })

  assert.equal(await resolve(), null)
})

test('an empty filtered Realm-role response stays unresolved without visibility attestation', async () => {
  const { resolve } = createProtectionResolver({ realmAdministrationRoleVisibilityValidated: false })

  assert.equal(await resolve(), null)
})

test('an unvalidated pinned realm-management UUID is not queried or trusted', async () => {
  const { requests, resolve } = createProtectionResolver({
    effectiveRealmManagementRoles: [{ name: 'view-users' }],
    realmManagementClientUuidValidated: false
  })

  assert.equal(await resolve(), null)
  assert.ok(!requests.some(request => request.pathname === effectiveRealmManagementRolesPath))
})

test('a Keycloak service-account identity protects the account', async () => {
  const { resolve } = createProtectionResolver({
    user: { id: 'user-1', username: 'service-account-client', enabled: true, serviceAccountClientId: 'client' }
  })

  assert.equal(await resolve(), null, 'a changed trusted username must fail closed')

  const matchingResolver = createProtectionResolver({
    user: { id: 'user-1', username: 'alice', enabled: true, serviceAccountClientId: 'client' }
  })

  const protection = await matchingResolver.resolve()

  assert.equal(protection.value.isServiceAccount, true)
})

test('missing approved configuration and unavailable or malformed facts stay unresolved', async () => {
  const missingConfiguration = createProtectionResolver({ includeProtectionConfiguration: false })
  const forbiddenRoleData = createProtectionResolver({ failPath: '/role-mappings/' })
  const missingAdministrationRoleInventory = createProtectionResolver({ realmAdministrationRoleNames: [] })

  const malformedAttribute = createProtectionResolver({
    user: { id: 'user-1', username: 'alice', enabled: true, attributes: { protected: 'true' } }
  })

  assert.equal(await missingConfiguration.resolve(), null)
  assert.ok(!missingConfiguration.requests.some(request => request.pathname.includes('/role-mappings/')))
  assert.equal(await forbiddenRoleData.resolve(), null)
  assert.equal(await missingAdministrationRoleInventory.resolve(), null)
  assert.equal(await malformedAttribute.resolve(), null)
})
