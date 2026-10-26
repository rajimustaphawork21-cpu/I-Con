export interface UsersPageRow {
  readonly id: string
  readonly username: string
  readonly enabled: boolean
  readonly email?: string
}

export type UsersPageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'error' }
  | { readonly kind: 'empty'; readonly count: number }
  | { readonly kind: 'ready'; readonly users: readonly UsersPageRow[]; readonly count: number }

export const INITIAL_USERS_PAGE_STATE: UsersPageState = { kind: 'loading' }

export function resolveUsersPageState(
  listStatus: number,
  listPayload: unknown,
  countStatus: number,
  countPayload: unknown
): UsersPageState {
  if (listStatus === 401 || countStatus === 401) return { kind: 'unauthenticated' }

  if (listStatus === 403 || countStatus === 403) return { kind: 'forbidden' }

  if (listStatus !== 200 || countStatus !== 200) return { kind: 'error' }

  const users = readUsers(listPayload)
  const count = readCount(countPayload)

  if (!users || count === null) return { kind: 'error' }

  return users.length === 0 ? { kind: 'empty', count } : { kind: 'ready', users, count }
}

function readUsers(payload: unknown): readonly UsersPageRow[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.users)) return null

  const users: UsersPageRow[] = []

  for (const candidate of payload.users) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.username !== 'string' ||
      typeof candidate.enabled !== 'boolean' ||
      (candidate.email !== undefined && typeof candidate.email !== 'string')
    ) {
      return null
    }

    users.push({
      id: candidate.id,
      username: candidate.username,
      enabled: candidate.enabled,
      ...(candidate.email === undefined ? {} : { email: candidate.email })
    })
  }

  return users
}

function readCount(payload: unknown): number | null {
  if (!isRecord(payload) || !Number.isSafeInteger(payload.count) || (payload.count as number) < 0) return null

  return payload.count as number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
