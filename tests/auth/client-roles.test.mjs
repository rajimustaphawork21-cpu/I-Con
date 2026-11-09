import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'

import { SignJWT, exportJWK, generateKeyPair } from 'jose'

import clientRoleModule from '../../src/libs/auth/realm-roles.ts'

const { extractClientRoles } = clientRoleModule

const clientId = 'icon-bff'
let issuer
let privateKey
let server

before(async () => {
  const keyPair = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(keyPair.publicKey)

  privateKey = keyPair.privateKey

  server = createServer((request, response) => {
    if (request.url === '/realms/I-Con/protocol/openid-connect/certs') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ keys: [{ ...publicJwk, alg: 'RS256', kid: 'test-key', use: 'sig' }] }))

      return
    }

    response.writeHead(404)
    response.end()
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (!address || typeof address === 'string') throw new Error('Test JWKS server did not start')

  issuer = `http://127.0.0.1:${address.port}/realms/I-Con`
})

after(async () => {
  if (!server) return

  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
})

const createAccessToken = async ({ subject = 'user-1', authorizedParty = clientId, roles = ['OPS-N1'] } = {}) =>
  new SignJWT({
    azp: authorizedParty,
    resource_access: {
      [clientId]: { roles }
    }
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

test('prefers Client Roles from Auth.js-validated ID-token claims', async () => {
  const result = await extractClientRoles({
    idTokenClaims: {
      sub: 'user-1',
      resource_access: { [clientId]: { roles: ['ADM-APP'] } }
    },
    accessToken: 'browser-or-provider-input-is-not-decoded',
    issuer,
    clientId
  })

  assert.deepEqual(result, { roles: ['ADM-APP'], source: 'id_token' })
})

test('accepts Client Roles from a signed, matching Keycloak access token fallback', async () => {
  const accessToken = await createAccessToken({ roles: ['AUD'] })

  const result = await extractClientRoles({
    idTokenClaims: { sub: 'user-1' },
    accessToken,
    issuer,
    clientId
  })

  assert.deepEqual(result, { roles: ['AUD'], source: 'access_token' })
})

test('rejects an access token belonging to a different OIDC subject', async () => {
  const accessToken = await createAccessToken({ subject: 'different-user' })

  const result = await extractClientRoles({
    idTokenClaims: { sub: 'user-1' },
    accessToken,
    issuer,
    clientId
  })

  assert.deepEqual(result, { roles: [], source: 'none' })
})

test('rejects an access token issued to a different OAuth Client', async () => {
  const accessToken = await createAccessToken({ authorizedParty: 'another-client' })

  const result = await extractClientRoles({
    idTokenClaims: { sub: 'user-1' },
    accessToken,
    issuer,
    clientId
  })

  assert.deepEqual(result, { roles: [], source: 'none' })
})

test('does not decode or trust an unverified access token', async () => {
  const result = await extractClientRoles({
    idTokenClaims: { sub: 'user-1' },
    accessToken: 'not-a-signed-jwt',
    issuer,
    clientId
  })

  assert.deepEqual(result, { roles: [], source: 'none' })
})
