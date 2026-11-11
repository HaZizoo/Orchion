import { createMockSessions } from '../data/mockSessions'
import type { Session } from '../types'
import { apiFetch } from './api'

export interface Workspace {
  sessions: Session[]
  activeSessionId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.messages) &&
    Array.isArray(value.artifacts)
  )
}

function normalizeWorkspace(payload: unknown): Workspace | null {
  if (!isRecord(payload) || !Array.isArray(payload.sessions)) return null

  const sessions = payload.sessions.filter(isSession)
  if (sessions.length === 0) return null

  const storedActive = typeof payload.activeSessionId === 'string' ? payload.activeSessionId : ''
  const activeSessionId = sessions.some((session) => session.id === storedActive)
    ? storedActive
    : sessions[0].id

  return { sessions, activeSessionId }
}

/** Threads come from MongoDB; `null` means this account has no threads yet. */
export async function loadWorkspace(): Promise<Workspace | null> {
  return normalizeWorkspace(await apiFetch<unknown>('/api/sessions'))
}

export async function createSession(session: Session): Promise<Session> {
  const response = await apiFetch<{ session: Session }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(session),
  })
  return response.session
}

export async function saveSession(session: Session): Promise<void> {
  await apiFetch<void>(`/api/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    body: JSON.stringify(session),
  })
}

export async function deleteSession(id: string): Promise<void> {
  await apiFetch<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function clearSessions(): Promise<void> {
  await apiFetch<void>('/api/sessions', { method: 'DELETE' })
}

export async function setActiveSession(id: string): Promise<void> {
  await apiFetch<void>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ activeSessionId: id }),
  })
}

/** Uploads the Phase 1 fixtures for a brand-new account. */
export async function seedWorkspace(): Promise<Workspace> {
  const sessions: Session[] = []
  for (const seed of createMockSessions()) {
    sessions.push(await createSession(seed))
  }

  const activeSessionId = sessions[0].id
  await setActiveSession(activeSessionId)
  return { sessions, activeSessionId }
}

let bootInFlight: Promise<Workspace> | null = null

/**
 * React StrictMode runs the boot effect twice; both callers share one
 * load-or-seed operation so the fixtures are never posted concurrently.
 */
export async function loadWorkspaceOrSeed(): Promise<Workspace> {
  if (!bootInFlight) {
    bootInFlight = (async () => (await loadWorkspace()) ?? (await seedWorkspace()))().finally(() => {
      bootInFlight = null
    })
  }

  return bootInFlight
}

/** Wipes this account's threads and reseeds them. */
export async function resetWorkspace(): Promise<Workspace> {
  await clearSessions()
  return seedWorkspace()
}
