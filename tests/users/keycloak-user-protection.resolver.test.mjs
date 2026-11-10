import assert from 'node:assert/strict'
import test from 'node:test'

import keycloakDirectoryModule from '../../src/modules/users/infrastructure/keycloak-user-directory.adapter.ts'

const { KeycloakUserDirectoryAdapter } = keycloakDirectoryModule

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
  realmAdministrationRoleNames = ['admin', 'create-realm'],
  readConfigurationFromEnvironment = false,
  realmAdministrationRolesEnvironment
} = {}) => {
  const requests = []
  const record = (operation, payload) => requests.push({ operation, payload })

  const fail = operation => {
    const isClientRoleMapping = operation === 'listCompositeClientRoleMappings'
    const isAnyRoleMapping = operation.includes('RoleMappings')

    if (
      (failPath === '/role-mappings/clients/' && isClientRoleMapping) ||
      (failPath === '/role-mappings/' && isAnyRoleMapping)
    ) {
      throw new Error('forbidden')
    }
  }

  const adminClient = {
    auth: async credentials => {
      record('auth', credentials)
    },
    getAccessToken: async () => 'service-account-token',
    users: {
      findOne: async payload => {
        record('findOne', payload)

        return user
      },
      listCompositeClientRoleMappings: async payload => {
        record('listCompositeClientRoleMappings', payload)
        fail('listCompositeClientRoleMappings')

        return effectiveRealmManagementRoles
      },
      listCompositeRealmRoleMappings: async payload => {
        record('listCompositeRealmRoleMappings', payload)
        fail('listCompositeRealmRoleMappings')

        return effectiveRealmRoles
      },
      countGroups: async payload => {
        record('countGroups', payload)

        return { count: groups.length }
      },
      listGroups: async payload => {
        record('listGroups', payload)

        return groups.slice(payload.first, payload.first + payload.max)
      }
    }
  }

  const adapterOptions = {
    adminClientFactory: () => adminClient
  }

  let adapter

  if (readConfigurationFromEnvironment) {
    const environment = {
      ICON_KEYCLOAK_ADMIN_URL: 'https://keycloak.example.test',
      ICON_KEYCLOAK_REALM: 'I-Con',
      ICON_KEYCLOAK_DIRECTORY_CLIENT_ID: 'icon-directory-reader',
      ICON_KEYCLOAK_DIRECTORY_CLIENT_SECRET: 'test-secret',
      ICON_KEYCLOAK_REALM_MANAGEMENT_CLIENT_UUID: 'realm-management-uuid',
      ICON_KEYCLOAK_REALM_MANAGEMENT_CLIENT_UUID_VALIDATED: 'true',
      ICON_KEYCLOAK_REALM_MANAGEMENT_ROLE_VISIBILITY_VALIDATED: 'true',
      ICON_KEYCLOAK_REALM_ADMINISTRATION_ROLES: realmAdministrationRolesEnvironment,
      ICON_KEYCLOAK_REALM_ADMINISTRATION_ROLE_VISIBILITY_VALIDATED: 'true',
      ICON_KEYCLOAK_SSO_ADMINISTRATORS_GROUP_PATH: '/Administrateurs-SSO'
    }

    const previousEnvironment = new Map(Object.keys(environment).map(name => [name, process.env[name]]))

    try {
      for (const [name, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }

      adapter = new KeycloakUserDirectoryAdapter(adapterOptions)
    } finally {
      for (const [name, value] of previousEnvironment) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  } else {
    adapter = new KeycloakUserDirectoryAdapter({
      ...adapterOptions,
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
      }
    })
  }

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
        request.operation === 'listCompositeClientRoleMappings' &&
        request.payload.clientUniqueId === 'realm-management-uuid' &&
        request.payload.id === 'user-1'
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
    requests.some(request => request.operation === 'listCompositeRealmRoleMappings' && request.payload.id === 'user-1')
  )
})

test('effective roles inherited through groups or composites are included by the composite endpoint', async () => {
  const { requests, resolve } = createProtectionResolver({
    effectiveRealmManagementRoles: [{ name: 'query-users' }]
  })

  const protection = await resolve()

  assert.equal(protection.value.hasRealmManagementRole, true)
  assert.ok(requests.some(request => request.operation === 'listCompositeClientRoleMappings'))
  assert.ok(!requests.some(request => request.operation === 'listClientRoleMappings'))
})

test('Administrateurs-SSO membership is found across complete paginated group membership', async () => {
  const groups = Array.from({ length: 100 }, (_value, index) => ({ path: `/Ordinaire-${index}` }))

  groups.push({ path: '/Administrateurs-SSO/Administrateurs-Délégués' })

  const { requests, resolve } = createProtectionResolver({ groups })
  const protection = await resolve()

  assert.equal(protection.value.isSsoAdministratorsGroupMember, true)
  assert.equal(requests.filter(request => request.operation === 'listGroups').length, 2)
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

test('Realm administration inventory env distinguishes missing, blank, malformed, and explicit empty', async () => {
  const cases = [
    { label: 'missing', value: undefined, expected: null },
    { label: 'blank', value: '', expected: null },
    { label: 'malformed', value: ' [] ', expected: null },
    {
      label: 'explicit empty',
      value: '[]',
      expected: { resolution: 'resolved', value: ordinaryFacts }
    }
  ]

  for (const testCase of cases) {
    const { requests, resolve } = createProtectionResolver({
      readConfigurationFromEnvironment: true,
      realmAdministrationRolesEnvironment: testCase.value
    })

    assert.deepEqual(await resolve(), testCase.expected, testCase.label)
    assert.ok(
      !requests.some(request => request.operation === 'listCompositeRealmRoleMappings'),
      `${testCase.label} inventory must not query Realm role mappings`
    )
  }
})

test('a protected signal wins with an explicitly empty Realm administration inventory', async () => {
  const { requests, resolve } = createProtectionResolver({
    user: { id: 'user-1', username: 'alice', enabled: true, attributes: { protected: ['true'] } },
    failPath: '/role-mappings/clients/',
    readConfigurationFromEnvironment: true,
    realmAdministrationRolesEnvironment: '[]'
  })

  const protection = await resolve()

  assert.equal(protection.resolution, 'resolved')
  assert.equal(protection.value.hasProtectedAttribute, true)
  assert.equal(protection.value.hasRealmAdministrationRole, false)
  assert.ok(!requests.some(request => request.operation === 'listCompositeRealmRoleMappings'))
})

test('an unvalidated pinned realm-management UUID is not queried or trusted', async () => {
  const { requests, resolve } = createProtectionResolver({
    effectiveRealmManagementRoles: [{ name: 'view-users' }],
    realmManagementClientUuidValidated: false
  })

  assert.equal(await resolve(), null)
  assert.ok(!requests.some(request => request.operation === 'listCompositeClientRoleMappings'))
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

  const malformedAttribute = createProtectionResolver({
    user: { id: 'user-1', username: 'alice', enabled: true, attributes: { protected: 'true' } }
  })

  assert.equal(await missingConfiguration.resolve(), null)
  assert.ok(!missingConfiguration.requests.some(request => request.operation.includes('RoleMappings')))
  assert.equal(await forbiddenRoleData.resolve(), null)
  assert.equal(await malformedAttribute.resolve(), null)
})
