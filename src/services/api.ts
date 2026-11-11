const TOKEN_KEY = 'orchion.api-token.v1'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const API_UNREACHABLE =
  'Could not reach the Orchion API at /api. Start the backend with npm run dev:server (or npm run dev for both processes), then retry.'

let token: string | null = readToken()
let authInFlight: Promise<void> | null = null

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(value: string | null): void {
  try {
    if (value) window.localStorage.setItem(TOKEN_KEY, value)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Private mode: the in-memory token still works for this tab.
  }
}

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readApiMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (isRecord(data) && typeof data.message === 'string') return data.message
  } catch {
    // Non-JSON error bodies fall through to the generic status message.
  }
  return ''
}

async function bootstrapAuth(): Promise<void> {
  if (token) {
    let existing: Response
    try {
      existing = await fetch('/api/auth/me', { headers: authHeaders() })
    } catch {
      throw new ApiError(0, API_UNREACHABLE)
    }

    if (existing.ok) return
    if (existing.status !== 401) {
      throw new ApiError(
        existing.status,
        (await readApiMessage(existing)) || `The Orchion API answered HTTP ${existing.status}.`,
      )
    }

    token = null
    writeToken(null)
  }

  let created: Response
  try {
    created = await fetch('/api/auth/guest', { method: 'POST' })
  } catch {
    throw new ApiError(0, API_UNREACHABLE)
  }

  if (!created.ok) {
    throw new ApiError(
      created.status,
      (await readApiMessage(created)) || `The API could not create a guest session (HTTP ${created.status}).`,
    )
  }

  const data: unknown = await created.json()
  if (!isRecord(data) || typeof data.token !== 'string') {
    throw new ApiError(500, 'The API returned an invalid session payload.')
  }

  token = data.token
  writeToken(token)
}

export async function ensureAuth(): Promise<void> {
  if (!authInFlight) {
    authInFlight = bootstrapAuth().finally(() => {
      authInFlight = null
    })
  }
  await authInFlight
}

async function send(path: string, init: { method?: string; body?: string }): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    })
  } catch {
    throw new ApiError(0, API_UNREACHABLE)
  }
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  await ensureAuth()
  let response = await send(path, init)

  // A stale token (server restarted with a new secret) gets one fresh attempt.
  if (response.status === 401) {
    token = null
    writeToken(null)
    await ensureAuth()
    response = await send(path, init)
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (await readApiMessage(response)) || `The API returned HTTP ${response.status}.`,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError && error.message) return error.message
  return API_UNREACHABLE
}
