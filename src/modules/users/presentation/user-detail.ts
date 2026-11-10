export type UserIdentityDto = {
  id: string
  username: string
  firstName?: string
  lastName?: string
  email?: string
  enabled: boolean
}

export type SimulatedUnlockCapabilityDto = {
  simulation: 'local-only'
  enabled: boolean
  eligible: boolean
  simulatedLocked: boolean
}

export type SimulatedUnlockUiState = {
  confirmationOpen: boolean
  locked: boolean
  feedback: string | null
}

export type SimulatedUnlockUiAction =
  | { type: 'reset'; locked: boolean }
  | { type: 'open-confirmation' }
  | { type: 'cancel' }
  | { type: 'confirm' }

export const SIMULATED_UNLOCK_FEEDBACK = 'Déblocage simulé. Le compte Keycloak reste inchangé.'

export const INITIAL_SIMULATED_UNLOCK_STATE: SimulatedUnlockUiState = {
  confirmationOpen: false,
  locked: true,
  feedback: null
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

export const buildSimulatedUnlockCapabilityRequestUrl = (accountId: string) =>
  `/api/users/${encodeURIComponent(accountId)}/unlock-demo`

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

export const parseSimulatedUnlockCapability = (value: unknown): SimulatedUnlockCapabilityDto | null => {
  if (
    !isRecord(value) ||
    value.simulation !== 'local-only' ||
    typeof value.enabled !== 'boolean' ||
    typeof value.eligible !== 'boolean' ||
    typeof value.simulatedLocked !== 'boolean'
  ) {
    return null
  }

  return {
    simulation: 'local-only',
    enabled: value.enabled,
    eligible: value.eligible,
    simulatedLocked: value.simulatedLocked
  }
}

export const loadSimulatedUnlockCapability = async (
  accountId: string,
  fetchImplementation: typeof fetch,
  signal?: AbortSignal
): Promise<SimulatedUnlockCapabilityDto | null> => {
  try {
    const response = await fetchImplementation(buildSimulatedUnlockCapabilityRequestUrl(accountId), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {})
    })

    if (!response.ok) return null

    return parseSimulatedUnlockCapability(await response.json().catch(() => null))
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return null

    return null
  }
}

export const reduceSimulatedUnlockUiState = (
  state: SimulatedUnlockUiState,
  action: SimulatedUnlockUiAction
): SimulatedUnlockUiState => {
  if (action.type === 'reset') {
    return { confirmationOpen: false, locked: action.locked, feedback: null }
  }

  if (action.type === 'open-confirmation') {
    return state.locked ? { ...state, confirmationOpen: true, feedback: null } : state
  }

  if (action.type === 'cancel') return { ...state, confirmationOpen: false }

  if (!state.confirmationOpen || !state.locked) return state

  return {
    confirmationOpen: false,
    locked: false,
    feedback: SIMULATED_UNLOCK_FEEDBACK
  }
}

export const getUserDetailErrorKind = (status: number, payload: unknown): UserDetailErrorKind => {
  if (status === 401) return 'session-expired'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'

  const errorCode = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null

  if (
    status === 503 &&
    (errorCode === 'ACCOUNT_PROTECTION_UNAVAILABLE' || errorCode === 'PROTECTED_ACCOUNT_READ_AUDIT_UNAVAILABLE')
  ) {
    return 'protection-unavailable'
  }

  if (status === 502 || status === 503) return 'upstream'

  return 'unknown'
}
