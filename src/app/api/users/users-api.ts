import { AccessDeniedError } from '../../../../modules/access/application/authorize-permission.usecase'
import type { CountUsersForSubjectUseCase } from '../../../../modules/users/application/count-users-for-subject.usecase'
import { InvalidCountUsersQueryError } from '../../../../modules/users/application/count-users.usecase'
import type { ListUsersForSubjectUseCase } from '../../../../modules/users/application/list-users-for-subject.usecase'
import { InvalidListUsersQueryError } from '../../../../modules/users/application/list-users.usecase'
import type { User } from '../../../../modules/users/domain/user.type'

const DEFAULT_PAGE_SIZE = 10
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

interface ApiRequest {
  readonly url: string
}

export interface UsersReadUseCases {
  readonly list: Pick<ListUsersForSubjectUseCase, 'execute'>
  readonly count: Pick<CountUsersForSubjectUseCase, 'execute'>
}

export interface UsersApiDependencies {
  readonly getSubject: () => Promise<string | null>
  readonly createUseCases: () => Promise<UsersReadUseCases>
}

export async function handleListUsersRequest(
  request: ApiRequest,
  dependencies: UsersApiDependencies
): Promise<Response> {
  const subjectResult = await resolveSubject(dependencies)

  if (subjectResult instanceof Response) return subjectResult

  let query: { first: number; max: number; search?: string }

  try {
    const parameters = new URL(request.url).searchParams

    assertAllowedParameters(parameters, ['first', 'max', 'search'])

    const first = parseIntegerParameter(parameters, 'first', 0)
    const max = parseIntegerParameter(parameters, 'max', DEFAULT_PAGE_SIZE)
    const search = readSingleParameter(parameters, 'search')

    query = {
      first,
      max,
      ...(search === null ? {} : { search })
    }
  } catch (error) {
    return invalidQueryResponse(error)
  }

  try {
    const useCases = await dependencies.createUseCases()
    const users = await useCases.list.execute(subjectResult, query)

    return json(
      {
        users: users.map(toUserDto),
        pagination: { first: query.first, max: query.max }
      },
      200
    )
  } catch (error) {
    return applicationErrorResponse(error)
  }
}

export async function handleCountUsersRequest(
  request: ApiRequest,
  dependencies: UsersApiDependencies
): Promise<Response> {
  const subjectResult = await resolveSubject(dependencies)

  if (subjectResult instanceof Response) return subjectResult

  let query: { search?: string }

  try {
    const parameters = new URL(request.url).searchParams

    assertAllowedParameters(parameters, ['search'])

    const search = readSingleParameter(parameters, 'search')

    query = search === null ? {} : { search }
  } catch (error) {
    return invalidQueryResponse(error)
  }

  try {
    const useCases = await dependencies.createUseCases()
    const count = await useCases.count.execute(subjectResult, query)

    return json({ count }, 200)
  } catch (error) {
    return applicationErrorResponse(error)
  }
}

class QueryParameterError extends Error {}

async function resolveSubject(dependencies: UsersApiDependencies): Promise<string | Response> {
  try {
    const subject = await dependencies.getSubject()

    if (!subject) {
      return json(
        {
          error: {
            code: 'unauthenticated',
            message: 'Authentication is required.'
          }
        },
        401
      )
    }

    return subject
  } catch {
    return serviceUnavailableResponse()
  }
}

function assertAllowedParameters(parameters: URLSearchParams, allowed: readonly string[]): void {
  for (const key of parameters.keys()) {
    if (!allowed.includes(key)) {
      throw new QueryParameterError(`Unsupported query parameter: ${key}.`)
    }
  }

  for (const key of allowed) {
    if (parameters.getAll(key).length > 1) {
      throw new QueryParameterError(`The ${key} query parameter must appear at most once.`)
    }
  }
}

function parseIntegerParameter(parameters: URLSearchParams, name: string, fallback: number): number {
  const value = readSingleParameter(parameters, name)

  if (value === null) return fallback

  if (!/^\d+$/.test(value)) {
    throw new QueryParameterError(`The ${name} query parameter must be a non-negative integer.`)
  }

  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed)) {
    throw new QueryParameterError(`The ${name} query parameter is outside the supported range.`)
  }

  return parsed
}

function readSingleParameter(parameters: URLSearchParams, name: string): string | null {
  const values = parameters.getAll(name)

  if (values.length > 1) {
    throw new QueryParameterError(`The ${name} query parameter must appear at most once.`)
  }

  return values[0] ?? null
}

function invalidQueryResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'The query is invalid.'

  return json({ error: { code: 'invalid_query', message } }, 400)
}

function applicationErrorResponse(error: unknown): Response {
  if (error instanceof AccessDeniedError) {
    return json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to read users.'
        }
      },
      403
    )
  }

  if (error instanceof InvalidListUsersQueryError || error instanceof InvalidCountUsersQueryError) {
    return invalidQueryResponse(error)
  }

  return serviceUnavailableResponse()
}

function serviceUnavailableResponse(): Response {
  return json(
    {
      error: {
        code: 'service_unavailable',
        message: 'Users data is temporarily unavailable.'
      }
    },
    503
  )
}

function toUserDto(user: User) {
  return {
    id: user.id,
    username: user.username,
    enabled: user.enabled,
    ...(user.email === undefined ? {} : { email: user.email })
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS })
}
