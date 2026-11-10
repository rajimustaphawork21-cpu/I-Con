import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import keycloakDirectoryModule from '../../src/modules/users/infrastructure/keycloak-user-directory.adapter.ts'

const { KeycloakUserDirectoryAdapter, KeycloakUserDirectoryError } = keycloakDirectoryModule

const query = ({ search, page = 1, pageSize = 20, offset = 0 } = {}) => ({
  ...(search ? { search } : {}),
  page,
  pageSize,
  offset
})

const json = (response, status, payload) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

const readBody = async request => {
  const chunks = []

  for await (const chunk of request) chunks.push(chunk)

  return Buffer.concat(chunks).toString('utf8')
}

const withKeycloakServer = async (handle, run) => {
  const requests = []

  const server = createServer(async (request, response) => {
    const body = await readBody(request)

    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body
    })
    handle(request, response, body)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const address = server.address()

    if (!address || typeof address === 'string') throw new Error('Test Keycloak server did not start')

    await run(`http://127.0.0.1:${address.port}`, requests)
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
}

const createAdapter = adminBaseUrl =>
  new KeycloakUserDirectoryAdapter({
    configuration: {
      adminBaseUrl,
      realm: 'I-Con',
      clientId: 'icon-directory-reader',
      clientSecret: 'test-secret'
    }
  })

const tokenPath = '/realms/I-Con/protocol/openid-connect/token'
const usersPath = '/admin/realms/I-Con/users'

test('realm-wide scope sends search and pagination to Keycloak and maps only directory fields', async () => {
  await withKeycloakServer(
    (request, response, body) => {
      const url = new URL(request.url, 'http://keycloak.test')

      if (request.method === 'POST' && url.pathname === tokenPath) {
        const form = new URLSearchParams(body)

        assert.equal(form.get('grant_type'), 'client_credentials')
        assert.equal(form.get('client_id'), 'icon-directory-reader')
        assert.equal(form.get('client_secret'), null)
        assert.equal(
          request.headers.authorization,
          `Basic ${Buffer.from('icon-directory-reader:test-secret').toString('base64')}`
        )
        json(response, 200, { access_token: 'service-account-token', expires_in: 60 })

        return
      }

      assert.equal(request.headers.authorization, 'Bearer service-account-token')

      if (url.pathname === `${usersPath}/count`) {
        assert.equal(url.searchParams.get('search'), 'ahm')
        json(response, 200, 1)

        return
      }

      if (url.pathname === `${usersPath}/`) {
        assert.equal(url.searchParams.get('search'), 'ahm')
        assert.equal(url.searchParams.get('first'), '20')
        assert.equal(url.searchParams.get('max'), '20')
        assert.equal(url.searchParams.get('briefRepresentation'), 'true')
        json(response, 200, [
          {
            id: 'user-ahmed',
            username: 'ahmed',
            firstName: 'Ahmed',
            lastName: 'Example',
            email: 'ahmed@example.test',
            enabled: true,
            attributes: { protected: ['false'] },
            credentials: [{ type: 'password' }]
          }
        ])

        return
      }

      response.writeHead(404)
      response.end()
    },
    async (adminBaseUrl, requests) => {
      const adapter = createAdapter(adminBaseUrl)
      const result = await adapter.list(query({ search: 'ahm', page: 2, offset: 20 }), { mode: 'realm-wide' })

      assert.deepEqual(result, {
        users: [
          {
            id: 'user-ahmed',
            username: 'ahmed',
            firstName: 'Ahmed',
            lastName: 'Example',
            email: 'ahmed@example.test',
            enabled: true
          }
        ],
        total: 1
      })
      assert.equal(requests.length, 3)
    }
  )
})

test('account-id scope fetches only authorized users and searches before pagination', async () => {
  const sourceUsers = {
    'user-1': { id: 'user-1', username: 'alice', enabled: true },
    'user-2': { id: 'user-2', username: 'bob', enabled: false },
    unauthorized: { id: 'unauthorized', username: 'alicia', enabled: true }
  }

  await withKeycloakServer(
    (request, response) => {
      const url = new URL(request.url, 'http://keycloak.test')

      if (request.method === 'POST' && url.pathname === tokenPath) {
        json(response, 200, { access_token: 'service-account-token' })

        return
      }

      const accountId = decodeURIComponent(url.pathname.slice(`${usersPath}/`.length))
      const user = sourceUsers[accountId]

      if (url.pathname.startsWith(`${usersPath}/`) && user) {
        json(response, 200, user)

        return
      }

      response.writeHead(404)
      response.end()
    },
    async (adminBaseUrl, requests) => {
      const adapter = createAdapter(adminBaseUrl)

      const result = await adapter.list(query({ search: 'ali', pageSize: 1 }), {
        mode: 'account-ids',
        accountIds: ['user-1', 'user-2', 'user-1']
      })

      assert.deepEqual(result, { users: [sourceUsers['user-1']], total: 1 })

      const userRequests = requests.filter(request => request.method === 'GET')

      assert.deepEqual(
        userRequests.map(request => request.url).sort(),
        [`${usersPath}/user-1`, `${usersPath}/user-2`]
      )
      assert.ok(userRequests.every(request => !request.url.includes('unauthorized')))
    }
  )
})

test('getById reloads one Keycloak user and returns only allowlisted identity fields', async () => {
  await withKeycloakServer(
    (request, response) => {
      const url = new URL(request.url, 'http://keycloak.test')

      if (request.method === 'POST' && url.pathname === tokenPath) {
        json(response, 200, { access_token: 'service-account-token' })

        return
      }

      if (url.pathname === `${usersPath}/user-1`) {
        json(response, 200, {
          id: 'user-1',
          username: 'alice',
          firstName: 'Alice',
          lastName: 'Example',
          email: 'alice@example.test',
          enabled: false,
          attributes: { protected: ['true'] },
          credentials: [{ type: 'password' }]
        })

        return
      }

      response.writeHead(404)
      response.end()
    },
    async (adminBaseUrl, requests) => {
      const adapter = createAdapter(adminBaseUrl)

      assert.deepEqual(await adapter.getById('user-1'), {
        id: 'user-1',
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Example',
        email: 'alice@example.test',
        enabled: false
      })
      assert.deepEqual(
        requests.map(request => request.url),
        [tokenPath, `${usersPath}/user-1`]
      )
    }
  )
})

test('getById maps a missing Keycloak user to null', async () => {
  await withKeycloakServer(
    (request, response) => {
      const url = new URL(request.url, 'http://keycloak.test')

      if (request.method === 'POST' && url.pathname === tokenPath) {
        json(response, 200, { access_token: 'service-account-token' })

        return
      }

      response.writeHead(404)
      response.end()
    },
    async adminBaseUrl => {
      const adapter = createAdapter(adminBaseUrl)

      assert.equal(await adapter.getById('missing-user'), null)
    }
  )
})

test('an unresolved visibility scope fails before any Keycloak request', async () => {
  await withKeycloakServer(
    (_request, response) => {
      response.writeHead(500)
      response.end()
    },
    async (adminBaseUrl, requests) => {
      const adapter = createAdapter(adminBaseUrl)

      await assert.rejects(
        () => adapter.list(query(), {}),
        error => error instanceof KeycloakUserDirectoryError && error.code === 'INVALID_VISIBILITY_SCOPE'
      )
      assert.equal(requests.length, 0)
    }
  )
})

test('service-account authentication failures are mapped without exposing the response body', async () => {
  await withKeycloakServer(
    (_request, response) => {
      json(response, 401, { error: 'invalid_client', secret: 'must-not-be-exposed' })
    },
    async adminBaseUrl => {
      const adapter = createAdapter(adminBaseUrl)

      await assert.rejects(
        () => adapter.list(query(), { mode: 'realm-wide' }),
        error =>
          error instanceof KeycloakUserDirectoryError &&
          error.code === 'SERVICE_ACCOUNT_AUTHENTICATION_FAILED' &&
          error.status === 401 &&
          !error.message.includes('must-not-be-exposed')
      )
    }
  )
})

test('malformed service-account token responses fail closed', async () => {
  await withKeycloakServer(
    (_request, response) => {
      json(response, 200, { expires_in: 60 })
    },
    async adminBaseUrl => {
      const adapter = createAdapter(adminBaseUrl)

      await assert.rejects(
        () => adapter.list(query(), { mode: 'realm-wide' }),
        error => error instanceof KeycloakUserDirectoryError && error.code === 'INVALID_UPSTREAM_RESPONSE'
      )
    }
  )
})

test('Keycloak Admin REST failures are mapped to a stable adapter error', async () => {
  await withKeycloakServer(
    (request, response) => {
      const url = new URL(request.url, 'http://keycloak.test')

      if (request.method === 'POST' && url.pathname === tokenPath) {
        json(response, 200, { access_token: 'service-account-token' })

        return
      }

      json(response, 503, { error: 'temporarily_unavailable' })
    },
    async adminBaseUrl => {
      const adapter = createAdapter(adminBaseUrl)

      await assert.rejects(
        () => adapter.list(query(), { mode: 'account-ids', accountIds: ['user-1'] }),
        error =>
          error instanceof KeycloakUserDirectoryError &&
          error.code === 'UPSTREAM_REQUEST_FAILED' &&
          error.status === 503
      )
    }
  )
})

test('malformed Keycloak user representations fail closed', async () => {
  await withKeycloakServer(
    (request, response) => {
      const url = new URL(request.url, 'http://keycloak.test')

      if (request.method === 'POST' && url.pathname === tokenPath) {
        json(response, 200, { access_token: 'service-account-token' })

        return
      }

      json(response, 200, { id: 'user-1', username: 'alice' })
    },
    async adminBaseUrl => {
      const adapter = createAdapter(adminBaseUrl)

      await assert.rejects(
        () => adapter.list(query(), { mode: 'account-ids', accountIds: ['user-1'] }),
        error => error instanceof KeycloakUserDirectoryError && error.code === 'INVALID_UPSTREAM_RESPONSE'
      )
    }
  )
})
