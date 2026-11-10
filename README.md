# Orchion

A real-time chat workspace for a task-executing AI agent — built for developers who want to watch the work, not just the answer.

> **Phase 3 — Live Groq SSE streaming.** Replies now come from `openai/gpt-oss-120b` over a real `fetch` + `ReadableStream` SSE connection. Slash commands still render a tool card and push an artifact before the model streams its answer, the amber **Stop** button aborts the socket, and every thread persists to `localStorage`.

---

## Stack

| Concern     | Choice                                                  |
| ----------- | ------------------------------------------------------- |
| Framework   | React 19                                                |
| Build tool  | Vite 8                                                  |
| Language    | TypeScript                                              |
| Styling     | Tailwind CSS v4 (`@tailwindcss/vite`)                   |
| Icons       | `lucide-react`                                          |
| Transport   | Groq Chat Completions (SSE) via `fetch` + `ReadableStream` |
| Persistence | `localStorage` (versioned, validated on read)           |
| Linting     | Oxlint (Vite React-TS template default)                 |

## Getting started

```bash
npm install
cp .env.example .env.local     # then paste your key into VITE_GROQ_API_KEY
npm run dev                    # http://localhost:5173
npm run build                  # type-check + production bundle
npm run lint                   # oxlint
npm run preview                # serve the production build
```

### Environment

| Variable             | Where it goes      | Purpose                             |
| -------------------- | ------------------ | ----------------------------------- |
| `VITE_GROQ_API_KEY`  | `.env.local` (project root, next to `package.json`) | Bearer token for `api.groq.com` |

Create the key at [console.groq.com/keys](https://console.groq.com/keys), copy `.env.example` to `.env.local`, and **restart `npm run dev`** — Vite reads env files only at startup, so a key added while the server is running is invisible until it restarts.

`.env` and `.env.*` are git-ignored (`.env.example` is exempt). On a host, set `VITE_GROQ_API_KEY` in the project's environment settings before building, because `VITE_*` values are inlined at build time.

> **Security note:** any `VITE_*` variable is compiled into the browser bundle, so this key is visible to anyone who loads the app. That is acceptable for a local demo, not for a public deployment — production should proxy the request through a server endpoint that holds the key server-side.

---

## Architecture

```
src/
├── App.tsx                    # Stream orchestration, session CRUD, persistence
├── main.tsx                   # React 19 entrypoint
├── index.css                  # Tailwind import, theme tokens, keyframes
├── vite-env.d.ts              # Typed VITE_GROQ_API_KEY
├── types.ts                   # Message / ToolExecution / Artifact / JSON types
├── data/
│   └── mockSessions.ts        # 3 seed threads + quick actions + clone factory
├── services/
│   ├── chatTransport.ts       # Event contract, tool plans, Groq SSE parser
│   └── sessionStorage.ts      # load / save / reset + hydration validation
└── components/
    ├── Sidebar.tsx            # Brand, New Session, threads (+ delete), reset
    ├── ChatHeader.tsx         # Active title, streaming pill, drawer toggle
    ├── MessageList.tsx        # Transcript, pinned-scroll behaviour, empty state
    ├── MessageBubble.tsx      # Bubbles, tool card, status pill, copy
    ├── MessageContent.tsx     # Markdown subset renderer + code blocks
    ├── ChatInput.tsx          # Composer, slash chips, Send ⇄ Stop
    ├── AgentDrawer.tsx        # Task Action Log, artifact cards, copy
    ├── CopyButton.tsx         # Shared clipboard control (1.5s feedback)
    └── StatusDot.tsx          # Shared pulsing green indicator
```

### Layout

A three-pane workspace on desktop: fixed **sidebar** (272px), fluid **transcript**, and a **340px action drawer**. Below `md` the sidebar becomes an overlay; below `lg` the drawer does too.

```
┌──────────┬────────────────────────────────────┬──────────────┐
│ Sidebar  │ ChatHeader (streaming pill)        │ AgentDrawer  │
│          ├────────────────────────────────────┤              │
│ Threads  │ MessageList (pinned auto-scroll)   │ Artifacts    │
│  · · · ✕ │   • user bubble                    │   • summary  │
│          │   • agent bubble + tool card       │   • tasks    │
│          ├────────────────────────────────────┤   • code     │
│ Reset    │ ChatInput (Send ⇄ Stop)            │   • schema   │
└──────────┴────────────────────────────────────┴──────────────┘
```

---

## Streaming transport

`src/services/chatTransport.ts` is the only place that knows how a reply is produced. It exposes one typed async generator and a frozen event union:

```ts
type ChatStreamEvent =
  | { type: 'tool_start'; action: string; summary: string }
  | { type: 'tool_complete'; tool: ToolExecution; artifact: Artifact }
  | { type: 'token'; delta: string }
  | { type: 'done' }

streamChatResponse({ prompt, history, signal }): AsyncGenerator<ChatStreamEvent>
```

| Step | Timing | What the UI does |
| ---- | ------ | ---------------- |
| `detectCommand(prompt)` | instant | `/summarize`, `/extract-tasks`, `/explain-code`, else `plan_task` |
| `tool_start` | immediate | appends an assistant message with a **running** tool card (spinner) |
| `tool_complete` | +450ms | settles the card (duration, JSON in/out) and prepends the artifact |
| `POST /openai/v1/chat/completions` | after the tool settles | `stream: true`, so headers return as soon as the model starts |
| `token` × n | network cadence | appends to `message.content`; markdown re-renders from the accumulated string |
| `done` | end | marks the message `complete`, stamps `updatedAt` |

### Request shape

```ts
fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: 'openai/gpt-oss-120b',
    stream: true,
    temperature: 0.5,
    max_completion_tokens: 1200,
    messages: [system, commandInstruction, ...history, user],
  }),
  signal,                         // ← the same controller the Stop button aborts
})
```

`history` is the current thread's turns (last 12, each capped at 6k characters of its tail), so `/summarize` summarises the actual conversation instead of an empty prompt. The command token itself is stripped from the user turn — it is a console affordance, not content — and the matching system instruction ("Summarize the conversation above…") is what makes the command actionable.

### SSE parsing

The response body is read with `body.getReader()` and a streaming `TextDecoder`. Chunks are buffered and split on `\n`, so a JSON payload that straddles two network chunks is never parsed half-formed:

```ts
buffer += decoder.decode(value, { stream: true })
let newline = buffer.indexOf('\n')
while (newline !== -1) {
  const line = buffer.slice(0, newline).replace(/\r$/, '')
  buffer = buffer.slice(newline + 1)
  // 'data: {...}' → choices[0].delta.content → yield { type: 'token' }
  newline = buffer.indexOf('\n')
}
```

Only `data:` lines carrying `choices[0].delta.content` become tokens. `data: [DONE]` ends the stream, `empty` deltas and `delta.reasoning` (the model's internal trace) are skipped, and a trailing line without a final newline is still flushed. If the stream ends without any visible text, a single explanatory token is yielded instead of an empty bubble.

### Error handling

| Condition | What the user sees |
| --------- | ------------------ |
| `VITE_GROQ_API_KEY` missing/blank | Bubble explains where to put the key and that the dev server must restart. No crash, no network call. |
| HTTP 401 / 403 | "Groq rejected the API key (HTTP 401)…", plus the provider's message |
| HTTP 429 | "Groq is rate limiting this key…" — wait and resend |
| HTTP 404 | Model not available to this key, names the model and the constant to change |
| Other non-2xx | Status code plus a trimmed provider message (220 chars) |
| Network failure before tokens | "Couldn't reach Groq…" |
| Failure mid-stream | Appends an interruption notice, then rethrows so the bubble shows the red `error` pill while keeping the tokens already rendered |
| Abort | Rethrows `AbortError`; the message becomes `stopped`, never `error` |

Pre-flight failures are yielded as ordinary `token` events on purpose: the bubble renders them like any other reply, which keeps the UI contract to four event types.

### AbortController lifecycle

1. `handleSend` creates one `AbortController` per session and stores it in `controllers` (a `Map`, so switching threads never loses the handle).
2. The generator passes `signal` to `fetch` **and** to a `wait` helper used for the tool latency. Aborting rejects the pending `reader.read()` (or the pending sleep) with a `DOMException('…', 'AbortError')`.
3. The Stop button calls `handleStop(sessionId)` → `controller.abort()`; the socket closes immediately rather than at the next chunk.
4. `App` catches the rejection, checks `isAbortError(error) || signal.aborted`, and marks the message `stopped`; a running tool becomes `cancelled` with a "Cancelled by user" summary. Partial tokens already rendered are kept — nothing is rolled back.
5. The `finally` block cancels the reader, removes the controller and clears the session's streaming flag, which restores the Send button.
6. Unmount and **Reset Demo Data** abort every live controller, so no request survives the tree.

### Session persistence

`src/services/sessionStorage.ts` owns two versioned keys:

```
orchion.sessions.v1        Session[]   (messages + artifacts)
orchion.active-session.v1  string      (active session id)
```

- **Hydration is defensive.** `loadWorkspace()` returns `null` on first run, missing keys, non-array JSON, corrupt JSON or an empty result — `App` then falls back to `createMockSessions()`. Stored sessions are normalised field by field, so an old or hand-edited payload can't crash the renderer.
- **Interrupted streams recover.** A persisted `streaming` message is restored as `stopped`, and a `running` tool as `cancelled`; empty assistant rows left by a reload mid-stream are dropped.
- **Writes are debounced** by 300ms, because tokens update state continuously and `JSON.stringify` on every token would be wasteful. A `pagehide` listener flushes the final state when the tab closes. Quota/private-mode failures are swallowed so the in-memory session keeps working.

### Session management

- **New Session** creates a clean thread, activates it and immediately clears + focuses the composer through an imperative `ChatInputHandle` (no focus effects, no `setState` in an effect).
- **Delete** is a sibling button per row (not nested inside the row button), and aborts that thread's stream first. Deleting the last thread immediately seeds an empty `New Session N`, so `sessions[0]` — and therefore `activeSession` — is never undefined.
- **Reset Demo Data** confirms, aborts all streams, clears both keys and reseeds from the fixtures.
- The first prompt in an empty thread derives the thread title (slash command stripped), so a new session doesn't stay named "New Session 1".

---

## Interaction details

- **Send ⇄ Stop.** While the active thread is streaming, the primary button becomes an amber *Stop* control wired to the abort path; the composer placeholder and footer mode also change. Other threads can still be read and switched while one streams.
- **Copy.** `CopyButton` writes to the clipboard, shows a checkmark and the live-region message for **1.5s**, and falls back to a hidden textarea on insecure contexts. It appears on assistant bubbles, fenced code blocks, tool input/output, and artifact cards.
- **Markdown subset.** `MessageContent` renders fenced code (with a language label and copy button), bullet/ordered lists, `**bold**`, `` `inline code` ``, and paragraphs. An unterminated fence still renders as code, so a stream never flashes raw backticks; content is parsed from the full accumulated string on each token, which keeps line breaks stable.
- **Pinned scrolling.** `MessageList` follows the stream only while the reader is within 96px of the bottom; scrolling up suspends auto-scroll instead of yanking the viewport.
- **Tool cards.** The card still reflects a local tool run — action name, reported duration, structured JSON input/output — while the prose above it comes from Groq. The artifact in the Action Log is the plan's fixture payload; the model is instructed not to claim it produced artifacts itself.

### State model

```ts
sessions: Session[]              // hydrated → localStorage, seeded on first run
activeSessionId: string
isDrawerOpen: boolean
isSidebarOpen: boolean           // mobile overlay only
streamingSessionIds: string[]    // threads with a live request
composerRef: ChatInputHandle     // imperative focus/clear
controllers: Map<string, AbortController>   // ref, one per streaming thread
latestWorkspace: Workspace       // ref, flushed on pagehide
```

A message carries `status: 'streaming' | 'complete' | 'stopped' | 'error'`; a tool carries `running | completed | failed | cancelled`. Both are rendered as explicit pills, so a cancelled tool never looks like a success.

### Design tokens

Defined once in `src/index.css` under `@theme`:

- **Surfaces:** `void → shell → panel → raised → hover`
- **Type:** `ink` / `ink-soft` / `ink-dim`, Inter + JetBrains Mono
- **Accents:** `accent` violet for agent affordances, `live` green for runtime status, amber for stopped/cancelled, red for failures
- **Motion:** `fade-up`, `ping-soft`, `dot`, `slide-in`, `caret` (streaming cursor) — looping animations are `motion-safe`

---

## Accessibility notes

- Transcript is a labelled `role="log"`; copy feedback is announced through a polite live region.
- Composer is a real `<form>` with a labelled textarea; icon-only buttons carry `aria-label`.
- Tool cards are `aria-expanded` disclosures; drawer toggle exposes `aria-pressed` / `aria-controls`.
- Streaming status is conveyed by text ("streaming", "stopped"), not colour alone.
- Visible `:focus-visible` ring on every interactive element.

## Verification

`npm run lint` (Oxlint) and `npm run build` (`tsc -b` + Vite) pass with **zero errors and zero warnings**.

---

## Roadmap

| Phase | Scope |
| ----- | ----- |
| 1 | Chat UI, mock sessions, tool cards, action log, composer |
| 2 | Streaming transport, aborted/stopped states, tool→artifact events, localStorage persistence, delete/reset, copy |
| **3 — current** | Live Groq SSE streaming behind the same event contract, command-aware system prompts, thread history, key/rate-limit messaging |
| 4 | Server-side proxy for the API key, real tool execution, auth, multi-user sync |

## Out of scope for Phase 3

Backend proxy, auth, server-side persistence, real file/tool execution, token-level usage accounting, conversation export, and full markdown (tables, images, syntax highlighting).
