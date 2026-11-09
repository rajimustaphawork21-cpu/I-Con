export type DirectoryUserDto = {
  id: string
  username: string
  firstName?: string
  lastName?: string
  email?: string
  enabled: boolean
}

export type DirectoryPageDto = {
  users: readonly DirectoryUserDto[]
  total: number
  page: number
  pageSize: number
}

export type DirectoryErrorKind = 'invalid-search' | 'session-expired' | 'forbidden' | 'upstream' | 'unknown'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const readOptionalString = (value: unknown, property: string) => {
  if (value === undefined) return {}
  if (typeof value !== 'string') return null

  return { [property]: value }
}

const parseUser = (value: unknown): DirectoryUserDto | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.username !== 'string' ||
    typeof value.enabled !== 'boolean'
  ) {
    return null
  }

  const firstName = readOptionalString(value.firstName, 'firstName')
  const lastName = readOptionalString(value.lastName, 'lastName')
  const email = readOptionalString(value.email, 'email')

  if (!firstName || !lastName || !email) return null

  return {
    id: value.id,
    username: value.username,
    ...firstName,
    ...lastName,
    ...email,
    enabled: value.enabled
  } as DirectoryUserDto
}

export const normalizeDirectorySearch = (value: string) => value.trim()

export const isDirectorySearchValid = (value: string) => value.length === 0 || value.length >= 3

export const buildDirectoryRequestUrl = (search: string, page: number, pageSize: number) => {
  const parameters = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })

  if (search) parameters.set('search', search)

  return `/api/users?${parameters}`
}

export const parseDirectoryPage = (value: unknown): DirectoryPageDto | null => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.users) ||
    typeof value.total !== 'number' ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    typeof value.page !== 'number' ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    typeof value.pageSize !== 'number' ||
    !Number.isSafeInteger(value.pageSize) ||
    value.pageSize < 1
  ) {
    return null
  }

  const users = value.users.map(parseUser)

  if (users.some(user => user === null)) return null

  return {
    users: users as DirectoryUserDto[],
    total: value.total,
    page: value.page,
    pageSize: value.pageSize
  }
}

export const getDirectoryErrorKind = (status: number): DirectoryErrorKind => {
  if (status === 400) return 'invalid-search'
  if (status === 401) return 'session-expired'
  if (status === 403) return 'forbidden'
  if (status === 502 || status === 503) return 'upstream'

  return 'unknown'
}
