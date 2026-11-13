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

export type UserUnlockStatusDto = {
  enabled: boolean
  eligible: boolean
  locked: boolean | null
}

export type UserUnlockExecutionResult =
  | {
      outcome: 'unlocked'
      id: string
      correlationId: string | null
    }
  | {
      outcome: 'unknown'
      correlationId: string
    }
  | {
      outcome: 'not-locked'
      message: string
    }
  | {
      outcome: 'error'
      message: string
    }

export type UserUnlockUiState = {
  enabled: boolean
  eligible: boolean
  locked: boolean | null
  confirmationOpen: boolean
  submitting: boolean
  feedback: string | null
  error: string | null
  unknownCorrelationId: string | null
}

export type UserUnlockUiAction =
  | { type: 'reset'; status: UserUnlockStatusDto | null }
  | { type: 'open-confirmation' }
  | { type: 'cancel' }
  | { type: 'submit-start' }
  | { type: 'submit-success' }
  | { type: 'submit-unknown'; correlationId: string }
  | { type: 'submit-not-locked'; message: string }
  | { type: 'submit-error'; message: string }

export const USER_UNLOCK_SUCCESS_FEEDBACK =
  'Le compte a été débloqué dans Keycloak et l’audit PostgreSQL a été enregistré.'

export const INITIAL_USER_UNLOCK_STATE: UserUnlockUiState = {
  enabled: false,
  eligible: false,
  locked: null,
  confirmationOpen: false,
  submitting: false,
  feedback: null,
  error: null,
  unknownCorrelationId: null
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

export const buildUserUnlockRequestUrl = (accountId: string) => `/api/users/${encodeURIComponent(accountId)}/unlock`

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

export const parseUserUnlockStatus = (value: unknown): UserUnlockStatusDto | null => {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.eligible !== 'boolean' ||
    (value.locked !== null && typeof value.locked !== 'boolean')
  ) {
    return null
  }

  return {
    enabled: value.enabled,
    eligible: value.eligible,
    locked: value.locked
  }
}

export const loadUserUnlockStatus = async (
  accountId: string,
  fetchImplementation: typeof fetch,
  signal?: AbortSignal
): Promise<UserUnlockStatusDto | null> => {
  try {
    const response = await fetchImplementation(buildUserUnlockRequestUrl(accountId), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {})
    })

    if (!response.ok) return null

    return parseUserUnlockStatus(await response.json().catch(() => null))
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return null

    return null
  }
}

export const executeUserUnlock = async (
  accountId: string,
  fetchImplementation: typeof fetch
): Promise<UserUnlockExecutionResult> => {
  try {
    const response = await fetchImplementation(buildUserUnlockRequestUrl(accountId), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ confirmed: true })
    })

    const headerCorrelationId = response.headers.get('x-correlation-id')
    const payload: unknown = await response.json().catch(() => null)

    if (
      response.status === 200 &&
      isRecord(payload) &&
      payload.status === 'USER_UNLOCKED' &&
      payload.id === accountId
    ) {
      return {
        outcome: 'unlocked',
        id: accountId,
        correlationId: headerCorrelationId
      }
    }

    if (isRecord(payload) && payload.error === 'USER_UNLOCK_OUTCOME_UNKNOWN') {
      const correlationId =
        typeof payload.correlationId === 'string' && payload.correlationId.trim()
          ? payload.correlationId.trim()
          : headerCorrelationId?.trim() || 'indisponible'

      return {
        outcome: 'unknown',
        correlationId
      }
    }

    if (response.status === 409 && isRecord(payload) && payload.error === 'ACCOUNT_NOT_LOCKED') {
      return {
        outcome: 'not-locked',
        message: 'Ce compte n’est plus verrouillé dans Keycloak.'
      }
    }

    return {
      outcome: 'error',
      message: 'Le déblocage du compte a échoué.'
    }
  } catch {
    return {
      outcome: 'error',
      message: 'Le déblocage du compte a échoué.'
    }
  }
}

export const reduceUserUnlockUiState = (
  state: UserUnlockUiState,
  action: UserUnlockUiAction
): UserUnlockUiState => {
  if (action.type === 'reset') {
    return {
      enabled: action.status?.enabled === true,
      eligible: action.status?.eligible === true,
      locked: action.status?.locked ?? null,
      confirmationOpen: false,
      submitting: false,
      feedback: null,
      error: null,
      unknownCorrelationId: null
    }
  }

  if (action.type === 'open-confirmation') {
    if (!state.enabled || !state.eligible || state.locked !== true || state.submitting || state.unknownCorrelationId) {
      return state
    }

    return {
      ...state,
      confirmationOpen: true,
      feedback: null,
      error: null
    }
  }

  if (action.type === 'cancel') {
    if (state.submitting) return state

    return {
      ...state,
      confirmationOpen: false
    }
  }

  if (action.type === 'submit-start') {
    if (
      !state.confirmationOpen ||
      !state.enabled ||
      !state.eligible ||
      state.locked !== true ||
      state.submitting ||
      state.unknownCorrelationId
    ) {
      return state
    }

    return {
      ...state,
      submitting: true,
      feedback: null,
      error: null
    }
  }

  if (action.type === 'submit-success') {
    return {
      ...state,
      eligible: false,
      locked: false,
      confirmationOpen: false,
      submitting: false,
      feedback: USER_UNLOCK_SUCCESS_FEEDBACK,
      error: null,
      unknownCorrelationId: null
    }
  }

  if (action.type === 'submit-unknown') {
    return {
      ...state,
      eligible: false,
      confirmationOpen: false,
      submitting: false,
      feedback: null,
      error: null,
      unknownCorrelationId: action.correlationId
    }
  }

  if (action.type === 'submit-not-locked') {
    return {
      ...state,
      eligible: false,
      locked: false,
      confirmationOpen: false,
      submitting: false,
      feedback: null,
      error: action.message,
      unknownCorrelationId: null
    }
  }

  return {
    ...state,
    confirmationOpen: false,
    submitting: false,
    feedback: null,
    error: action.message
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
