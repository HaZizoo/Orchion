import type { Artifact, JsonRecord, ToolExecution } from '../types'

/**
 * Frozen event contract between the transport and the UI.
 *
 * `tool_start`   → append a running tool card inside the assistant message
 * `tool_complete`→ settle that card (duration, JSON payloads) and push an artifact
 * `token`        → append `delta` to the message body
 * `done`         → close the stream; no further events are emitted
 *
 * Phase 3 keeps this shape and swaps the token source for a Groq SSE completion,
 * so no UI consumer had to change.
 */
export type ChatStreamEvent =
  | { type: 'tool_start'; action: string; summary: string }
  | { type: 'tool_complete'; tool: ToolExecution; artifact: Artifact }
  | { type: 'token'; delta: string }
  | { type: 'done' }

/** Earlier turns, oldest first, so `/summarize` can act on the real thread. */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatStreamRequest {
  prompt: string
  history?: ChatHistoryMessage[]
  signal?: AbortSignal
}

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
export const GROQ_MODEL = 'openai/gpt-oss-120b'

/** Wall-clock latency between `tool_start` and `tool_complete`. */
const TOOL_LATENCY_MS = 450
const MAX_COMPLETION_TOKENS = 1200
/** Turns kept from history, and the tail of each long turn. */
const HISTORY_TURNS = 12
const HISTORY_CHARS = 6000
const ERROR_DETAIL_CHARS = 220

const BASE_SYSTEM_PROMPT =
  'You are Orchion, a terse senior engineering assistant inside a developer console. ' +
  'Answer in GitHub-flavoured Markdown: short paragraphs, bullet lists, and fenced code blocks with a language tag. ' +
  'Be concrete and skip filler. Never claim to have run tools, read files, or written artifacts — the console ' +
  'reports those separately.'

const MISSING_KEY_MESSAGE =
  "Groq isn't connected yet: `VITE_GROQ_API_KEY` is not set. Add it to `.env.local` in the project root " +
  '(for example `VITE_GROQ_API_KEY=…`) and restart `npm run dev` — Vite only reads env files at startup.'

const UNREACHABLE_MESSAGE =
  "Couldn't reach Groq — the request failed before any tokens arrived. Check your connection and send again."

interface ToolPlan {
  action: string
  /** Shown while the tool is running, before the real answer exists. */
  runningSummary: string
  summary: string
  durationMs: number
  input: JsonRecord
  output: JsonRecord
  artifact: Artifact
  /** Appended to the prompt as a system instruction before the live stream. */
  instruction: string
}

type GroqMessage = { role: 'system' | 'user' | 'assistant'; content: string }

function abortError(): DOMException {
  return new DOMException('The response stream was aborted.', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  return error instanceof Error && error.name === 'AbortError'
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** setTimeout that rejects with an AbortError as soon as the signal fires. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)

    function handleAbort() {
      window.clearTimeout(timer)
      reject(abortError())
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function detectCommand(prompt: string): string | null {
  const match = /^\s*\/([a-z][a-z-]*)/i.exec(prompt)
  return match ? match[1].toLowerCase() : null
}

function artifactId(action: string): string {
  return `artifact-${action}-${Date.now().toString(36)}`
}

function summarizePlan(): ToolPlan {
  const durationMs = randomInt(118, 178)

  return {
    action: 'summarize_text',
    runningSummary: 'Condensing the thread…',
    summary: 'Condensed the active thread into 5 bullets and 3 action items.',
    durationMs,
    instruction:
      'Summarize the conversation above for the engineer who wrote it. Lead with a five-bullet digest of the ' +
      'actual claims or decisions, then list the open action items. Quote nothing that is not in the thread; ' +
      'if the thread is empty, ask for the material to summarize.',
    input: { source: 'active_thread', target_length: 120, tone: 'technical' },
    output: {
      bullets: 5,
      action_items: 3,
      tokens_in: 2841,
      tokens_out: 402,
      artifact: 'summary:active-thread',
    },
    artifact: {
      id: artifactId('summarize_text'),
      kind: 'summary',
      title: 'Thread brief',
      meta: `summarize_text · ${durationMs}ms`,
      body:
        'The thread reduces to one claim: consensus is cheap until the network starts lying. Safety comes from quorum overlap; liveness comes from timeouts that assume partial synchrony. Operational legibility, not throughput, is what separates Raft from Paxos.',
      items: [
        'Quorum overlap is the safety mechanism — majorities must intersect.',
        'Raft trades throughput for an inspectable leader election.',
        'FLP applies only under full asynchrony with a crash fault.',
        'Production systems buy liveness with timeouts, heartbeats and leases.',
        'The seminar angle: lead with FLP, close with partial synchrony.',
      ],
    },
  }
}

function extractTasksPlan(): ToolPlan {
  const durationMs = randomInt(84, 142)

  return {
    action: 'extract_tasks',
    runningSummary: 'Scanning for action items…',
    summary: 'Extracted 3 action items with 0.93 confidence.',
    durationMs,
    instruction:
      'Extract every action item from the conversation above as an ordered checklist. Each line must start with ' +
      '"1." style numbering and name the concrete next move. Put the same checklist in a fenced ```md block. ' +
      'If nothing is actionable, say so in one sentence.',
    input: { source: 'active_thread', format: 'checklist', dedupe: true },
    output: {
      items: 3,
      confidence: 0.93,
      owners: ['self'],
      artifact: 'tasks:active-thread',
    },
    artifact: {
      id: artifactId('extract_tasks'),
      kind: 'tasks',
      title: 'Action items',
      meta: `extract_tasks · ${durationMs}ms · confidence 0.93`,
      items: [
        'Re-read §4.2 on quorum overlap before the seminar.',
        'Write two paragraphs comparing Raft election timeouts with Paxos prepare/accept.',
        'Confirm with the TA whether FLP is examined as a proof or a statement.',
      ],
    },
  }
}

function explainCodePlan(): ToolPlan {
  const durationMs = randomInt(176, 264)

  return {
    action: 'explain_code',
    runningSummary: 'Walking the call graph…',
    summary: 'Explained 1 handler and proposed a single-mount fix.',
    durationMs,
    instruction:
      'Explain the code or error discussed above. Walk the actual call path, name the root cause in one ' +
      'sentence, then give a corrected snippet in a fenced block with the right language tag. Keep it under ' +
      '250 words and do not repeat the original snippet back.',
    input: { path: 'server/middleware/auth.ts', depth: 'call-graph', include_patch: true },
    output: {
      symbols: 3,
      findings: 2,
      patch: 'artifact:code:request-guard',
      artifact: 'code:request-guard',
    },
    artifact: {
      id: artifactId('explain_code'),
      kind: 'code',
      title: 'request-guard.ts — corrected guard',
      meta: `explain_code · ${durationMs}ms · 1 file`,
      body: `// server/middleware/request-guard.ts
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('missing bearer token'))
  }
  try {
    req.user = verify(header.slice(7))
    next()
  } catch (error) {
    next(error)
  }
}`,
    },
  }
}

function genericPlan(): ToolPlan {
  const durationMs = randomInt(58, 112)

  return {
    action: 'plan_task',
    runningSummary: 'Planning the next step…',
    summary: 'Drafted a 3-step plan and attached it to the Action Log.',
    durationMs,
    instruction:
      'Answer the latest user message directly. Use the earlier turns as context. If the request needs more ' +
      'than three steps, give the plan first and stop there.',
    input: { goal: 'active_thread', steps: 3, tools: ['plan_task', 'summarize_text'] },
    output: {
      steps: 3,
      tools_available: ['summarize_text', 'extract_tasks', 'explain_code'],
      artifact: 'tasks:execution-plan',
    },
    artifact: {
      id: artifactId('plan_task'),
      kind: 'tasks',
      title: 'Execution plan',
      meta: `plan_task · ${durationMs}ms`,
      items: [
        'Resolve the request against the active thread context.',
        'Run the matching tool and capture structured output.',
        'Stream the narrative, then persist the artifact.',
      ],
    },
  }
}

function resolvePlan(prompt: string): ToolPlan {
  switch (detectCommand(prompt)) {
    case 'summarize':
      return summarizePlan()
    case 'extract-tasks':
      return extractTasksPlan()
    case 'explain-code':
      return explainCodePlan()
    default:
      return genericPlan()
  }
}

function readApiKey(): string | null {
  const key = import.meta.env.VITE_GROQ_API_KEY
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : null
}

/**
 * The command is a console affordance, not something the model should answer
 * literally, so the leading slash token is stripped from the user turn.
 */
function buildMessages(
  prompt: string,
  plan: ToolPlan,
  history: ChatHistoryMessage[],
): GroqMessage[] {
  const messages: GroqMessage[] = [{ role: 'system', content: BASE_SYSTEM_PROMPT }]

  if (plan.instruction) messages.push({ role: 'system', content: plan.instruction })

  for (const turn of history.slice(-HISTORY_TURNS)) {
    const content = turn.content.trim()
    if (content.length > 0) messages.push({ role: turn.role, content: content.slice(-HISTORY_CHARS) })
  }

  const cleaned = prompt.replace(/^\/[a-z-]+\s*/i, '').trim()
  messages.push({ role: 'user', content: cleaned || 'Apply the requested action to this conversation.' })

  return messages
}

type SseChunk = { type: 'delta'; delta: string } | { type: 'error'; message: string }

/**
 * Parses one SSE line. Groq streams OpenAI-style `data: {...}` payloads and
 * terminates with `data: [DONE]`. Reasoning deltas (`delta.reasoning`) are
 * deliberately ignored: the console shows the answer, not the trace.
 */
function parseSseLine(line: string): SseChunk | null {
  if (!line.startsWith('data:')) return null

  const payload = line.slice(5).trim()
  if (payload.length === 0 || payload === '[DONE]') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }

  const chunk = parsed as {
    error?: { message?: string }
    choices?: Array<{ delta?: { content?: string | null } }>
  }

  if (chunk.error?.message) return { type: 'error', message: chunk.error.message }

  const delta = chunk.choices?.[0]?.delta?.content
  return typeof delta === 'string' && delta.length > 0 ? { type: 'delta', delta } : null
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text()
    const compact = text.replace(/\s+/g, ' ').trim()
    return compact.length > ERROR_DETAIL_CHARS ? `${compact.slice(0, ERROR_DETAIL_CHARS)}…` : compact
  } catch {
    return ''
  }
}

/** Turns a failed HTTP response into something readable inside the bubble. */
function httpErrorMessage(status: number, detail: string): string {
  const suffix = detail.length > 0 ? `\n\nGroq said: \`${detail}\`` : ''

  if (status === 401 || status === 403) {
    return (
      `Groq rejected the API key (HTTP ${status}). Update \`VITE_GROQ_API_KEY\` in \`.env.local\` ` +
      `and restart the dev server. The key must be a Groq API key with access to \`${GROQ_MODEL}\`.` +
      suffix
    )
  }

  if (status === 429) {
    return (
      "Groq is rate limiting this key (HTTP 429). Wait a few seconds and send again, or check the key's " +
      'limits in the Groq console.' +
      suffix
    )
  }

  if (status === 404) {
    return (
      `Groq has no model \`${GROQ_MODEL}\` available to this key (HTTP 404). Pick a model the account can ` +
      'access, or update the GROQ_MODEL constant in `src/services/chatTransport.ts`.' +
      suffix
    )
  }

  return `Groq returned HTTP ${status} before any tokens arrived. Try again in a moment.${suffix}`
}

/**
 * Streams one assistant turn: local tool lifecycle first, then the live Groq
 * completion. The caller owns the message, artifact and error bookkeeping.
 *
 * `signal` is passed straight into `fetch`, so aborting it closes the socket
 * instead of waiting for the next chunk. Pre-flight failures (missing key,
 * 401/403/429) are yielded as a friendly token; failures mid-stream rethrow
 * after a notice so `App` can mark the message `error` without losing the
 * tokens already rendered.
 */
export async function* streamChatResponse({
  prompt,
  history = [],
  signal,
}: ChatStreamRequest): AsyncGenerator<ChatStreamEvent, void, void> {
  if (signal?.aborted) throw abortError()

  const plan = resolvePlan(prompt)

  yield { type: 'tool_start', action: plan.action, summary: plan.runningSummary }
  await wait(TOOL_LATENCY_MS, signal)

  yield {
    type: 'tool_complete',
    tool: {
      action: plan.action,
      status: 'completed',
      durationMs: plan.durationMs,
      summary: plan.summary,
      input: plan.input,
      output: plan.output,
    },
    artifact: plan.artifact,
  }

  const apiKey = readApiKey()
  if (!apiKey) {
    yield { type: 'token', delta: MISSING_KEY_MESSAGE }
    yield { type: 'done' }
    return
  }

  let response: Response
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        stream: true,
        temperature: 0.5,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        messages: buildMessages(prompt, plan, history),
      }),
      signal,
    })
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw abortError()
    yield { type: 'token', delta: UNREACHABLE_MESSAGE }
    yield { type: 'done' }
    return
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    yield { type: 'token', delta: httpErrorMessage(response.status, detail) }
    yield { type: 'done' }
    return
  }

  const body = response.body
  if (!body) {
    yield { type: 'token', delta: 'Groq accepted the request but returned no body. Send it again.' }
    yield { type: 'done' }
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let received = false

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

        const chunk = parseSseLine(line)
        if (chunk === null) continue
        if (chunk.type === 'error') throw new Error(chunk.message)

        received = true
        yield { type: 'token', delta: chunk.delta }
      }
    }

    // A final chunk without a trailing newline still carries content.
    buffer += decoder.decode()
    const tail = parseSseLine(buffer.replace(/\r$/, ''))
    if (tail?.type === 'delta') {
      received = true
      yield { type: 'token', delta: tail.delta }
    }
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw abortError()

    yield {
      type: 'token',
      delta: `\n\nStream interrupted: ${error instanceof Error ? error.message : 'unknown error'}. The partial reply is kept — send again to retry.`,
    }
    throw error
  } finally {
    // Releasing the lock on an aborted body would throw; cancelling closes it.
    void reader.cancel().catch(() => undefined)
  }

  if (!received) {
    yield {
      type: 'token',
      delta: 'The model finished without returning visible text. Try rephrasing the request.',
    }
  }

  yield { type: 'done' }
}
