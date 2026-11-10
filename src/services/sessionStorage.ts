import { MOCK_MODEL, createMockSessions } from '../data/mockSessions'
import type {
  Artifact,
  ArtifactKind,
  JsonRecord,
  Message,
  MessageStatus,
  Session,
  ToolExecution,
  ToolStatus,
} from '../types'

const SESSIONS_KEY = 'orchion.sessions.v1'
const ACTIVE_KEY = 'orchion.active-session.v1'

export interface Workspace {
  sessions: Session[]
  activeSessionId: string
}

const MESSAGE_STATUSES: MessageStatus[] = ['streaming', 'complete', 'stopped', 'error']
const TOOL_STATUSES: ToolStatus[] = ['running', 'completed', 'failed', 'cancelled']
const ARTIFACT_KINDS: ArtifactKind[] = ['summary', 'tasks', 'code', 'schema']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asJsonRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? (value as JsonRecord) : undefined
}

/** Anything interrupted by a reload or crash is settled on read. */
function normalizeTool(value: unknown): ToolExecution | undefined {
  if (!isRecord(value)) return undefined

  const action = asString(value.action)
  if (!action) return undefined

  const rawStatus = asString(value.status)
  const status = TOOL_STATUSES.includes(rawStatus as ToolStatus) ? (rawStatus as ToolStatus) : 'completed'
  const durationMs =
    typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? value.durationMs : 0

  return {
    action,
    status: status === 'running' ? 'cancelled' : status,
    durationMs,
    summary: asString(value.summary),
    input: asJsonRecord(value.input),
    output: asJsonRecord(value.output),
  }
}

function normalizeMessage(value: unknown): Message | null {
  if (!isRecord(value)) return null

  const id = asString(value.id)
  if (!id) return null

  const rawStatus = asString(value.status)
  const status = MESSAGE_STATUSES.includes(rawStatus as MessageStatus)
    ? (rawStatus as MessageStatus)
    : 'complete'

  return {
    id,
    role: value.role === 'user' ? 'user' : 'agent',
    content: asString(value.content) ?? '',
    timestamp: asString(value.timestamp) ?? '',
    status: status === 'streaming' ? 'stopped' : status,
    tool: normalizeTool(value.tool),
  }
}

function normalizeArtifact(value: unknown): Artifact | null {
  if (!isRecord(value)) return null

  const id = asString(value.id)
  const title = asString(value.title)
  const rawKind = asString(value.kind)
  if (!id || !title || !ARTIFACT_KINDS.includes(rawKind as ArtifactKind)) return null

  const items = Array.isArray(value.items)
    ? value.items.filter((item): item is string => typeof item === 'string')
    : []

  return {
    id,
    kind: rawKind as ArtifactKind,
    title,
    meta: asString(value.meta) ?? '',
    body: asString(value.body),
    items: items.length > 0 ? items : undefined,
  }
}

function normalizeSession(value: unknown): Session | null {
  if (!isRecord(value)) return null

  const id = asString(value.id)
  const title = asString(value.title)
  if (!id || !title) return null

  const messages = Array.isArray(value.messages)
    ? value.messages
        .map(normalizeMessage)
        .filter((message): message is Message => message !== null)
        // A reload mid-stream can leave an empty agent row; drop it.
        .filter((message) => message.role === 'user' || message.content !== '' || message.tool)
    : []

  const artifacts = Array.isArray(value.artifacts)
    ? value.artifacts
        .map(normalizeArtifact)
        .filter((artifact): artifact is Artifact => artifact !== null)
    : []

  return {
    id,
    title,
    updatedAt: asString(value.updatedAt) ?? '',
    model: asString(value.model) ?? MOCK_MODEL,
    messages,
    artifacts,
  }
}

export function createWorkspace(): Workspace {
  const sessions = createMockSessions()
  return { sessions, activeSessionId: sessions[0].id }
}

/** Returns `null` on first run, corrupt JSON, or a stored workspace we can't use. */
export function loadWorkspace(): Workspace | null {
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null

    const sessions = parsed
      .map(normalizeSession)
      .filter((session): session is Session => session !== null)
    if (sessions.length === 0) return null

    const storedActive = window.localStorage.getItem(ACTIVE_KEY)
    const activeSessionId = sessions.some((session) => session.id === storedActive)
      ? (storedActive as string)
      : sessions[0].id

    return { sessions, activeSessionId }
  } catch {
    return null
  }
}

export function saveWorkspace(workspace: Workspace): void {
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(workspace.sessions))
    window.localStorage.setItem(ACTIVE_KEY, workspace.activeSessionId)
  } catch {
    // Private mode or a full quota: keep the in-memory session working.
  }
}

export function clearWorkspace(): void {
  try {
    window.localStorage.removeItem(SESSIONS_KEY)
    window.localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** Drops stored data and reseeds from the Phase 1 fixtures. */
export function resetWorkspace(): Workspace {
  clearWorkspace()
  return createWorkspace()
}
