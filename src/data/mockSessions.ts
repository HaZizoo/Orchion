import type { QuickAction, Session } from '../types'

export const MOCK_MODEL = 'orchion-agent-0.2'

export const quickActions: QuickAction[] = [
  { command: '/summarize', label: 'Condense the thread' },
  { command: '/extract-tasks', label: 'Pull out action items' },
  { command: '/explain-code', label: 'Walk through a snippet' },
]

const seedSessions: Session[] = [
  {
    id: 'session-lecture-notes',
    title: 'Summarize Lecture Notes',
    updatedAt: '09:41',
    model: MOCK_MODEL,
    messages: [
      {
        id: 'msg-ln-1',
        role: 'user',
        timestamp: '09:38',
        status: 'complete',
        content:
          "Here are my notes from CS 425 (Distributed Systems), lecture 7 on consensus. Can you pull out the core argument and anything that looks like a to-do? I have a seminar at 11.",
      },
      {
        id: 'msg-ln-2',
        role: 'agent',
        timestamp: '09:39',
        status: 'complete',
        content:
          'On it — chunking the notes, then I’ll compress the argument into plain language and surface every open question as an action item.',
        tool: {
          action: 'summarize_text',
          status: 'completed',
          durationMs: 140,
          summary: 'Condensed 1,842 words into 6 bullets and 3 action items.',
          input: {
            source: 'cs425-lecture-07.md',
            target_length: 120,
            tone: 'technical',
          },
          output: {
            bullets: 6,
            action_items: 3,
            tokens_in: 2431,
            tokens_out: 318,
            artifact: 'summary:cs425-lec-07',
          },
        },
      },
      {
        id: 'msg-ln-3',
        role: 'agent',
        timestamp: '09:41',
        status: 'complete',
        content:
          'Short version: the lecture argues that consensus is cheap only until the network starts lying.\n\nPaxos guarantees safety by making every quorum overlap, but it pays for that with two round trips and a leader bottleneck. Raft keeps the same safety story while making leader election legible, which is why it wins on implementation time, not on throughput.\n\nThe open thread is the FLP point: in a fully asynchronous network with even one crash fault, no deterministic protocol can both terminate and agree. Every production system you’ll touch escapes that by assuming partial synchrony — timeouts, heartbeats, leases.\n\nI’ve dropped the full summary and the three action items into the Action Log.',
      },
    ],
    artifacts: [
      {
        id: 'artifact-ln-summary',
        kind: 'summary',
        title: 'Lecture 07 — Consensus in practice',
        meta: 'summarize_text · 140ms',
        body:
          'Safety and liveness trade off against network assumptions. Paxos and Raft both require overlapping quorums; the difference is operational clarity, not theoretical guarantees. Real systems assume partial synchrony to sidestep FLP impossibility.',
        items: [
          'Quorum intersection is the safety mechanism — majorities must overlap.',
          'Paxos: multi-round, leader-optional, hard to teach from the paper alone.',
          'Raft: strong leader, log replication, election timeouts drive liveness.',
          'FLP applies only under full asynchrony with a crash fault.',
        ],
      },
      {
        id: 'artifact-ln-tasks',
        kind: 'tasks',
        title: 'Action items',
        meta: '3 extracted · confidence 0.92',
        items: [
          'Re-read section 4.2 on quorum overlap before the seminar.',
          'Write two paragraphs comparing Raft election timeouts with Paxos prepare/accept.',
          'Ask the TA whether the exam covers the FLP proof or only the statement.',
        ],
      },
    ],
  },
  {
    id: 'session-express-debug',
    title: 'Debug Express Middleware',
    updatedAt: '10:12',
    model: MOCK_MODEL,
    messages: [
      {
        id: 'msg-ed-1',
        role: 'user',
        timestamp: '10:08',
        status: 'complete',
        content:
          "My auth middleware runs twice per request and the second pass throws `ERR_HTTP_HEADERS_SENT`. Stack is Express 5, TypeScript, ESM. Here's the middleware:\n\n```ts\nexport function requireAuth(req, res, next) {\n  const token = req.headers.authorization\n  if (!token) return res.status(401).json({ error: 'missing token' })\n  req.user = verify(token)\n  next()\n}\n```",
      },
      {
        id: 'msg-ed-2',
        role: 'agent',
        timestamp: '10:09',
        status: 'complete',
        content:
          'Two runs per request usually means the middleware is mounted twice — once globally with `app.use` and once on the router or route. Let me read the entrypoint before guessing.',
        tool: {
          action: 'read_file',
          status: 'completed',
          durationMs: 212,
          summary: 'Parsed server/index.ts and mounted routers.',
          input: {
            path: 'server/index.ts',
            include: ['middleware', 'routes'],
          },
          output: {
            matches: ['line 18: app.use(requireAuth)', 'line 27: app.use("/api", apiRouter)'],
            files_read: 4,
          },
        },
      },
      {
        id: 'msg-ed-3',
        role: 'agent',
        timestamp: '10:11',
        status: 'complete',
        content:
          'Found it. `requireAuth` is mounted at line 18 and again inside `apiRouter`, so `/api/*` requests validate twice.\n\nThat alone wouldn’t crash: the second pass re-reads the same header and calls `next()` again. The `ERR_HTTP_HEADERS_SENT` comes from the guard around it — after `res.status(401).json(...)` the function keeps going because the return value is discarded somewhere upstream? Actually here it returns correctly, so the real culprit is your `verify` throwing after the response is flushed.\n\nFix in the drawer: delete the duplicate `router.use(requireAuth)` mount, and let the error handler own failures instead of the guard calling `res.json` directly.',
      },
      {
        id: 'msg-ed-4',
        role: 'user',
        timestamp: '10:12',
        status: 'complete',
        content: 'Got it. Can you sketch the corrected mounting order?',
      },
      {
        id: 'msg-ed-5',
        role: 'agent',
        timestamp: '10:12',
        status: 'complete',
        content:
          'Sure — I put a corrected middleware with a single mount and a terminal error handler in the Action Log. Nothing here touches your repo: this is seed data for the streaming layout.',
      },
    ],
    artifacts: [
      {
        id: 'artifact-ed-code',
        kind: 'code',
        title: 'auth.middleware.ts — single mount',
        meta: 'patch proposal · 1 file',
        body:
          '// server/middleware/auth.ts\nexport function requireAuth(req: Request, _res: Response, next: NextFunction) {\n  const header = req.headers.authorization\n  if (!header?.startsWith("Bearer ")) {\n    return next(new UnauthorizedError("missing bearer token"))\n  }\n  try {\n    req.user = verify(header.slice(7))\n    next()\n  } catch (error) {\n    next(error)\n  }\n}',
      },
      {
        id: 'artifact-ed-tasks',
        kind: 'tasks',
        title: 'Debug plan',
        meta: 'inspect_source · 212ms',
        items: [
          'Remove the duplicate `router.use(requireAuth)` in `routes/api.ts`.',
          'Throw typed errors from the guard; let one terminal handler call `res.json`.',
          'Add a request-scoped id so double execution shows up in logs.',
        ],
      },
    ],
  },
  {
    id: 'session-schema-formatter',
    title: 'JSON Schema Formatter',
    updatedAt: '11:03',
    model: MOCK_MODEL,
    messages: [
      {
        id: 'msg-sf-1',
        role: 'user',
        timestamp: '11:00',
        status: 'complete',
        content:
          'Normalize this schema to draft 2020-12, strict mode, and tell me what is actually invalid: {"type":"object","properties":{"email":{"type":"string"},"age":{"type":"integer","minimum":0}},"required":["email","age"]}',
      },
      {
        id: 'msg-sf-2',
        role: 'agent',
        timestamp: '11:01',
        status: 'complete',
        content:
          'Validating against the 2020-12 meta-schema, then rewriting it with explicit `additionalProperties` and `$schema`.',
        tool: {
          action: 'validate_json_schema',
          status: 'completed',
          durationMs: 96,
          summary: '1 schema checked, 0 hard errors.',
          input: {
            draft: '2020-12',
            strict: true,
          },
          output: {
            errors: [],
            warnings: ['missing $schema', 'missing additionalProperties'],
          },
        },
      },
      {
        id: 'msg-sf-3',
        role: 'agent',
        timestamp: '11:03',
        status: 'complete',
        content:
          'The schema is structurally valid — nothing there violates the meta-schema. What it is missing is intent: no `$schema`, so tooling guesses the draft, and no `additionalProperties: false`, so unknown keys are silently accepted.\n\nStrict mode also wants `required` entries to exist in `properties`, which they do. If you plan to validate forms at the edge, add `format: "email"` (annotation only) and enforce it in the form layer.\n\nThe normalized schema is in the Action Log.',
      },
    ],
    artifacts: [
      {
        id: 'artifact-sf-schema',
        kind: 'schema',
        title: 'normalized.schema.json',
        meta: 'draft 2020-12 · strict',
        body:
          '{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "$id": "https://orchion.dev/schemas/profile.json",\n  "type": "object",\n  "additionalProperties": false,\n  "properties": {\n    "email": {\n      "type": "string",\n      "format": "email"\n    },\n    "age": {\n      "type": "integer",\n      "minimum": 0\n    }\n  },\n  "required": ["email", "age"]\n}',
      },
    ],
  },
]

/** Deep copy of the seed threads, so React state never mutates module data. */
export function createMockSessions(): Session[] {
  return seedSessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => ({
      ...message,
      tool: message.tool
        ? {
            ...message.tool,
            input: message.tool.input ? { ...message.tool.input } : undefined,
            output: message.tool.output ? { ...message.tool.output } : undefined,
          }
        : undefined,
    })),
    artifacts: session.artifacts.map((artifact) => ({
      ...artifact,
      items: artifact.items ? [...artifact.items] : undefined,
    })),
  }))
}

export const mockSessions: Session[] = createMockSessions()
