import type { Artifact, JsonRecord, ToolExecution } from '../types'

/**
 * Frozen event contract between the transport and the UI.
 *
 * `tool_start`   → append a running tool card inside the assistant message
 * `tool_complete`→ settle that card (duration, JSON payloads) and push an artifact
 * `token`        → append `delta` to the message body
 * `done`         → close the stream; no further events are emitted
 *
 * Phase 3 replaces the generator body with a Groq completion. The event shape,
 * the abort semantics and every UI consumer stay exactly as they are.
 */
export type ChatStreamEvent =
  | { type: 'tool_start'; action: string; summary: string }
  | { type: 'tool_complete'; tool: ToolExecution; artifact: Artifact }
  | { type: 'token'; delta: string }
  | { type: 'done' }

export interface ChatStreamRequest {
  prompt: string
  signal?: AbortSignal
}

/** Wall-clock latency between `tool_start` and `tool_complete`. */
const TOOL_LATENCY_MS = 450
const FIRST_TOKEN_DELAY_MS = 140
const CHUNK_MIN_MS = 15
const CHUNK_MAX_MS = 25
const CHUNK_MIN_CHARS = 2
const CHUNK_MAX_CHARS = 6

interface ToolPlan {
  action: string
  /** Shown while the tool is running, before the real summary exists. */
  runningSummary: string
  summary: string
  durationMs: number
  input: JsonRecord
  output: JsonRecord
  artifact: Artifact
  response: string
}

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
    response: `Summarized. The condense pass returned five bullets and three action items, and both are in the Action Log.

The argument, stripped down:

- Consensus is cheap while the network behaves. Everything after that is the price of links that lie.
- Quorum overlap — not message count — is what makes Paxos and Raft safe.
- Raft wins on operational legibility, not throughput: leader election is inspectable.
- FLP only bites under full asynchrony with a crash fault, so production systems buy liveness with timeouts and leases.

For the 11:00 seminar, lead with the FLP point and use Raft as the escape hatch. The first action item is the only one with a deadline attached.

This reply came from the local streaming engine, not a model. Phase 3 swaps the token source for Groq and this state machine stays exactly the same.`,
  }
}

function extractTasksPlan(): ToolPlan {
  const durationMs = randomInt(84, 142)

  return {
    action: 'extract_tasks',
    runningSummary: 'Scanning for action items…',
    summary: 'Extracted 3 action items with 0.93 confidence.',
    durationMs,
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
    response: `Three action items, ordered by what unblocks the rest.

1. Re-read \`§4.2\` on quorum overlap — it is the section examiners probe.
2. Write two paragraphs comparing Raft election timeouts with Paxos prepare/accept. One page, no diagrams.
3. Ask the TA whether FLP is examined as a proof or only as a statement.

\`\`\`md
- [ ] Re-read §4.2 (quorum overlap)
- [ ] Two paragraphs: election timeouts vs prepare/accept
- [ ] Confirm FLP exam scope with the TA
\`\`\`

The checklist is mirrored in the Action Log, so you can tick items off there.

The extractor ran locally against the thread text. No model call was made — Phase 3 replaces the fixtures with a Groq completion that emits the same \`tool_start\` → \`tool_complete\` → \`token\` sequence.`,
  }
}

function explainCodePlan(): ToolPlan {
  const durationMs = randomInt(176, 264)

  return {
    action: 'explain_code',
    runningSummary: 'Walking the call graph…',
    summary: 'Explained 1 handler and proposed a single-mount fix.',
    durationMs,
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
    response: `Top to bottom, this is a guard that writes responses and a handler that also writes responses.

\`\`\`ts
export function requireAuth(req, res, next) {
  const token = req.headers.authorization
  if (!token) return res.status(401).json({ error: 'missing token' })
  req.user = verify(token)
  next()
}
\`\`\`

What actually happens on \`/api/*\`:

- The router mounts the guard a second time, so \`req.user\` is verified twice per request.
- The first failure writes a 401 and returns. The second failure tries to write again, which is your \`ERR_HTTP_HEADERS_SENT\`.
- \`verify\` throwing after the response is flushed produces the same error from a different path.

The fix is structural, not defensive: one mount, and let a terminal error handler own the response. The corrected middleware is in the Action Log.

This walkthrough is produced by the Phase 2 local engine; the token cadence matches Phase 3 but the content is fixture data.`,
  }
}

function genericPlan(): ToolPlan {
  const durationMs = randomInt(58, 112)

  return {
    action: 'plan_task',
    runningSummary: 'Planning the next step…',
    summary: 'Drafted a 3-step plan and attached it to the Action Log.',
    durationMs,
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
    response: `Three moves, then I report back.

1. Plan — split the request into steps I can verify one at a time.
2. Execute — run the matching tool and stream the result into this thread.
3. Report — attach the structured artifact so nothing lives only in prose.

\`\`\`ts
for await (const event of streamChatResponse({ prompt, signal })) {
  apply(event) // tool_start → tool_complete → token* → done
}
\`\`\`

Every tool call above arrives as an event, which is why the Action Log fills in before the first token lands.

This thread is running the Phase 2 transport: an in-process async generator with realistic latencies, not a network call. Phase 3 keeps the event contract and swaps the generator body for a Groq stream, so the UI does not change.`,
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

/**
 * Splits text into sub-word chunks, the way a tokenizer would. Rendering the
 * accumulating string means markdown never re-flows from a half-parsed state.
 */
function chunkText(text: string): string[] {
  const chunks: string[] = []
  let cursor = 0

  while (cursor < text.length) {
    const size = randomInt(CHUNK_MIN_CHARS, CHUNK_MAX_CHARS)
    chunks.push(text.slice(cursor, cursor + size))
    cursor += size
  }

  return chunks
}

/**
 * Streams one assistant turn. The caller owns the message, artifact and error
 * bookkeeping; this generator only orders the events and enforces the timings.
 *
 * Aborting `signal` rejects the pending sleep with an `AbortError`, which ends
 * iteration — no partial event is ever emitted after the abort.
 */
export async function* streamChatResponse({
  prompt,
  signal,
}: ChatStreamRequest): AsyncGenerator<ChatStreamEvent, void, void> {
  const plan = resolvePlan(prompt)

  if (signal?.aborted) throw abortError()

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

  await wait(FIRST_TOKEN_DELAY_MS, signal)

  for (const delta of chunkText(plan.response)) {
    await wait(randomInt(CHUNK_MIN_MS, CHUNK_MAX_MS), signal)
    yield { type: 'token', delta }
  }

  yield { type: 'done' }
}
