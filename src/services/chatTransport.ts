import type { Artifact, JsonRecord, ToolExecution, ToolStatus } from '../types'
import { authHeaders, ensureAuth, ApiError } from './api'

/**
 * Frozen event contract between the transport and the UI.
 *
 * `tool_start`   → append a running tool card inside the assistant message
 * `tool_complete`→ settle that card (duration, JSON payloads) and push an artifact
 * `token`        → append `delta` to the message body
 * `done`         → close the stream; no further events are emitted
 *
 * Phase 4 keeps the shape intact while the SSE frames now come from the
 * Express proxy at `/api/chat` instead of a key in the browser bundle.
 */
export type ChatStreamEvent =
  | { type: 'tool_start'; action: string; summary: string }
  | { type: 'tool_complete'; tool: ToolExecution; artifact?: Artifact }
  | { type: 'token'; delta: string }
  | { type: 'done' }

/** Earlier turns, oldest first, so `/summarize` can act on the real thread. */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatStreamRequest {
  prompt: string
  sessionId?: string
  history?: ChatHistoryMessage[]
  signal?: AbortSignal
}

const API_UNREACHABLE =
  "Couldn't reach the Orchion API at `/api/chat`. Start the backend with `npm run dev:server` (or `npm run dev` for both), then send again."

const ARTIFACT_KINDS = ['summary', 'tasks', 'code', 'schema'] as const
const TOOL_STATUSES: ToolStatus[] = ['running', 'completed', 'failed', 'cancelled']

function abortError(): DOMException {
  return new DOMException('The response stream was aborted.', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  return error instanceof Error && error.name === 'AbortError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return isRecord(value)
}

function normalizeTool(value: Record<string, unknown>): ToolExecution | null {
  if (typeof value.action !== 'string') return null

  const status = TOOL_STATUSES.includes(value.status as ToolStatus)
    ? (value.status as ToolStatus)
    : 'completed'

  return {
    action: value.action,
    status,
    durationMs:
      typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? value.durationMs : 0,
    ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
    ...(isJsonRecord(value.input) ? { input: value.input } : {}),
    ...(isJsonRecord(value.output) ? { output: value.output } : {}),
  }
}

function normalizeArtifact(value: unknown): Artifact | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return undefined
  if (!ARTIFACT_KINDS.includes(value.kind as (typeof ARTIFACT_KINDS)[number])) return undefined

  const items = Array.isArray(value.items)
    ? value.items.filter((item): item is string => typeof item === 'string')
    : []

  return {
    id: value.id,
    kind: value.kind as Artifact['kind'],
    title: value.title,
    meta: typeof value.meta === 'string' ? value.meta : '',
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
    ...(items.length > 0 ? { items } : {}),
  }
}

/** Validates one `data:` frame before it reaches React state. */
function parseEvent(payload: string): ChatStreamEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null

  switch (parsed.type) {
    case 'tool_start':
      return typeof parsed.action === 'string' && typeof parsed.summary === 'string'
        ? { type: 'tool_start', action: parsed.action, summary: parsed.summary }
        : null

    case 'tool_complete': {
      if (!isRecord(parsed.tool)) return null
      const tool = normalizeTool(parsed.tool)
      if (!tool) return null
      return { type: 'tool_complete', tool, artifact: normalizeArtifact(parsed.artifact) }
    }

    case 'token':
      return typeof parsed.delta === 'string' ? { type: 'token', delta: parsed.delta } : null

    case 'done':
      return { type: 'done' }

    case 'error':
      throw new Error(typeof parsed.message === 'string' ? parsed.message : 'The server stream failed.')

    default:
      return null
  }
}

async function readHttpMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (isRecord(data) && typeof data.message === 'string') return data.message
  } catch {
    // Fall through to the generic status message.
  }
  return `The Orchion API returned HTTP ${response.status}.`
}

/**
 * Streams one assistant turn through the Express proxy. `signal` is passed
 * straight into `fetch`, so aborting closes the HTTP response and the server
 * aborts its own Groq request. Pre-flight failures are yielded as a friendly
 * token; failures mid-stream rethrow so `App` can mark the message `error`
 * without losing the tokens already rendered.
 */
export async function* streamChatResponse({
  prompt,
  sessionId,
  history = [],
  signal,
}: ChatStreamRequest): AsyncGenerator<ChatStreamEvent, void, void> {
  if (signal?.aborted) throw abortError()

  try {
    await ensureAuth()
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw abortError()
    yield { type: 'token', delta: error instanceof ApiError ? error.message : API_UNREACHABLE }
    yield { type: 'done' }
    return
  }

  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ prompt, sessionId, history }),
      signal,
    })
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw abortError()
    yield { type: 'token', delta: API_UNREACHABLE }
    yield { type: 'done' }
    return
  }

  if (!response.ok) {
    yield { type: 'token', delta: await readHttpMessage(response) }
    yield { type: 'done' }
    return
  }

  const body = response.body
  if (!body) {
    yield { type: 'token', delta: 'The API accepted the request but returned no body. Send it again.' }
    yield { type: 'done' }
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')

        if (!line.startsWith('data:')) continue
        const event = parseEvent(line.slice(5).trim())
        if (!event) continue

        yield event
        if (event.type === 'done') return
      }
    }

    // A final frame without a trailing newline still carries an event.
    buffer += decoder.decode()
    const tail = buffer.replace(/\r$/, '')
    if (tail.startsWith('data:')) {
      const event = parseEvent(tail.slice(5).trim())
      if (event) yield event
    }
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw abortError()
    throw error
  } finally {
    // Releasing the lock on an aborted body would throw; cancelling closes it.
    void reader.cancel().catch(() => undefined)
  }
}
