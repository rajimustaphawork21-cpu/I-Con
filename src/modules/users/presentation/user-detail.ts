export type UserIdentityDto = {
  id: string
  username: string
  firstName?: string
  lastName?: string
  email?: string
  enabled: boolean
}

export type UserDetailErrorKind =
  | 'session-expired'
  | 'forbidden'
  | 'not-found'
  | 'protection-unavailable'
  | 'upstream'
  | 'unknown'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const readOptionalString = (value: unknown, property: string) => {
  if (value === undefined) return {}
  if (typeof value !== 'string') return null

  return { [property]: value }
}

export const buildUserDetailRequestUrl = (accountId: string) => `/api/users/${encodeURIComponent(accountId)}`

export const parseUserIdentity = (value: unknown): UserIdentityDto | null => {
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
  } as UserIdentityDto
}

export const getUserDetailErrorKind = (status: number, payload: unknown): UserDetailErrorKind => {
  if (status === 401) return 'session-expired'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'

  const errorCode = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null

  if (
    status === 503 &&
    (errorCode === 'ACCOUNT_PROTECTION_UNAVAILABLE' ||
      errorCode === 'PROTECTED_ACCOUNT_READ_AUDIT_UNAVAILABLE')
  ) {
    return 'protection-unavailable'
  }

  if (status === 502 || status === 503) return 'upstream'

  return 'unknown'
}
