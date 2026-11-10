# Orchion

A real-time chat workspace for a task-executing AI agent — built for developers who want to watch the work, not just the answer.

> **Phase 2 — Streaming engine (local transport).** Replies now arrive token by token from a typed `AsyncGenerator`, slash commands execute a tool and push a structured artifact, in-flight responses can be aborted, and every thread persists to `localStorage`. There is still **no backend and no live LLM call** — the token source is a fixture generator. Phase 3 swaps that generator body for a Groq stream without changing the event contract or any UI consumer.

---

## Stack

| Concern     | Choice                                         |
| ----------- | ---------------------------------------------- |
| Framework   | React 19                                       |
| Build tool  | Vite 8                                         |
| Language    | TypeScript                                     |
| Styling     | Tailwind CSS v4 (`@tailwindcss/vite`)          |
| Icons       | `lucide-react`                                 |
| Transport   | In-process `AsyncGenerator` + `AbortSignal`    |
| Persistence | `localStorage` (versioned, validated on read)  |
| Linting     | Oxlint (Vite React-TS template default)        |

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
npm run lint     # oxlint
npm run preview  # serve the production build
```

---

## Architecture

```
src/
├── App.tsx                    # Stream orchestration, session CRUD, persistence
├── main.tsx                   # React 19 entrypoint
├── index.css                  # Tailwind import, theme tokens, keyframes
├── types.ts                   # Message / ToolExecution / Artifact / JSON types
├── data/
│   └── mockSessions.ts        # 3 seed threads + quick actions + clone factory
├── services/
│   ├── chatTransport.ts       # Event contract, tool plans, token generator
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

streamChatResponse({ prompt, signal }): AsyncGenerator<ChatStreamEvent>
```

| Step | Timing | What the UI does |
| ---- | ------ | ---------------- |
| `detectCommand(prompt)` | instant | `/summarize`, `/extract-tasks`, `/explain-code`, else `plan_task` |
| `tool_start` | immediate | appends an assistant message with a **running** tool card (spinner) |
| `tool_complete` | +450ms | settles the card (real duration, JSON in/out) and prepends the artifact |
| `token` × n | 15–25ms apart, 2–6 chars | appends to `message.content`; markdown re-renders from the accumulated string |
| `done` | end | marks the message `complete`, stamps `updatedAt` |

Each plan carries its own structured input/output, a reported execution duration (90–260ms, independent of the 450ms client latency) and an artifact of kind `summary`, `tasks` or `code`.

### AbortController lifecycle

1. `handleSend` creates one `AbortController` per session and stores it in `controllers` (a `Map`, so switching threads never loses the handle).
2. `streamChatResponse` passes `signal` into every `await wait(...)`. A dedicated `wait` helper listens for `abort`, clears its timeout and rejects with a `DOMException('…', 'AbortError')` — so cancellation is immediate, not "after the current 25ms sleep".
3. The Stop button calls `handleStop(sessionId)` → `controller.abort()`.
4. `App` catches the rejection, checks `isAbortError(error) || signal.aborted`, and marks the message `stopped`; a running tool becomes `cancelled` with a "Cancelled by user" summary. Partial tokens already rendered are kept — nothing is rolled back.
5. The `finally` block removes the controller and clears the session's streaming flag, which restores the Send button.
6. Unmount and **Reset Demo Data** abort every live controller, so no generator survives the tree.

### Session persistence

`src/services/sessionStorage.ts` owns two versioned keys:

```
orchion.sessions.v1        Session[]   (messages + artifacts)
orchion.active-session.v1  string      (active session id)
```

- **Hydration is defensive.** `loadWorkspace()` returns `null` on first run, missing keys, non-array JSON, corrupt JSON or an empty result — `App` then falls back to `createMockSessions()`. Stored sessions are normalised field by field, so an old or hand-edited payload can't crash the renderer.
- **Interrupted streams recover.** A persisted `streaming` message is restored as `stopped`, and a `running` tool as `cancelled`; empty assistant rows left by a reload mid-stream are dropped.
- **Writes are debounced** by 300ms, because tokens update state every ~20ms and `JSON.stringify` on every token would be wasteful. A `pagehide` listener flushes the final state when the tab closes. Quota/private-mode failures are swallowed so the in-memory session keeps working.

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

### State model

```ts
sessions: Session[]              // hydrated → localStorage, seeded on first run
activeSessionId: string
isDrawerOpen: boolean
isSidebarOpen: boolean           // mobile overlay only
streamingSessionIds: string[]    // threads with a live generator
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
| **2 — current** | Streaming transport, aborted/stopped states, tool→artifact events, localStorage persistence, delete/reset, copy |
| 3 | Groq-backed token source behind the same event contract, real tool execution, auth |

## Out of scope for Phase 2

Backend services, WebSocket/SSE servers, LLM provider keys, auth, server-side persistence, real file/tool execution, and full markdown (tables, images, syntax highlighting).
