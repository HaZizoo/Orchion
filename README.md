# Orchion

A real-time chat workspace for a task-executing AI agent — built for developers who want to watch the work, not just the answer.

> **Phase 1 — Frontend UI (mock state).** This commit ships the complete chat interface with hardcoded data. There is **no backend, no WebSocket server, and no live LLM call**. Every agent reply, tool card and artifact is local mock state.

---

## Stack

| Concern    | Choice                                    |
| ---------- | ----------------------------------------- |
| Framework  | React 19                                  |
| Build tool | Vite 8                                    |
| Language   | TypeScript                                |
| Styling    | Tailwind CSS v4 (`@tailwindcss/vite`)     |
| Icons      | `lucide-react`                            |
| Linting    | Oxlint (Vite React-TS template default)   |

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
npm run lint     # oxlint
npm run preview  # serve the production build
```

---

## UI architecture

```
src/
├── App.tsx                  # Owns all session state + mock send flow
├── main.tsx                 # React 19 entrypoint
├── index.css                # Tailwind import, theme tokens, keyframes
├── types.ts                 # Session / Message / ToolExecution / Artifact
├── data/
│   └── mockSessions.ts      # 3 hardcoded threads + quick-action chips
└── components/
    ├── Sidebar.tsx          # Brand, New Session, thread list, capabilities badge
    ├── ChatHeader.tsx       # Active title, live status pill, Action Log toggle
    ├── MessageList.tsx      # Scroll container, empty state, auto-scroll
    ├── MessageBubble.tsx    # User / agent bubbles + inline tool card + typing row
    ├── ChatInput.tsx        # Auto-resizing composer, slash chips, Send
    ├── AgentDrawer.tsx      # Right-hand Task Action Log with artifacts
    └── StatusDot.tsx        # Shared pulsing green indicator
```

### Layout

A three-pane workspace on desktop: fixed **sidebar** (272px), fluid **transcript**, and a **340px action drawer** that the header button toggles. Below `md`, the sidebar becomes an overlay; below `lg`, the drawer does too.

```
┌──────────┬────────────────────────────────────┬──────────────┐
│ Sidebar  │ ChatHeader                         │ AgentDrawer  │
│          ├────────────────────────────────────┤              │
│ Threads  │ MessageList (scroll)               │ Artifacts    │
│          │   • user bubble                    │   • summary  │
│          │   • agent bubble + tool card       │   • tasks    │
│          ├────────────────────────────────────┤   • code     │
│ Capabil. │ ChatInput (sticky composer)        │              │
└──────────┴────────────────────────────────────┴──────────────┘
```

### Component contracts

- **`Sidebar`** — receives `sessions`, `activeSessionId`, `isOpen`; emits `onSelectSession`, `onNewSession`, `onClose`. Derives each row's preview from its last message.
- **`ChatHeader`** — receives the active `session` and `isDrawerOpen`; emits `onToggleDrawer`, `onOpenSidebar`.
- **`MessageList`** — pure transcript renderer; scrolls to the newest message on length or thinking-state change. Keeps `<div ref>` sentinel for `scrollIntoView`.
- **`MessageBubble`** — switches on `message.role`. Agent rows may carry `message.tool`, rendered as a collapsible `Action → status → duration` card with JSON input/output.
- **`ChatInput`** — local draft state, `scrollHeight`-driven auto-resize (200px cap), `Enter` to send / `Shift + Enter` newline (IME-composition safe), chips that prefill the box.
- **`AgentDrawer`** — renders the active session's artifacts by `kind` (`summary` / `tasks` / `code` / `schema`), with an empty state and a Phase 1 disclaimer.

### State model

All state is local to `App.tsx` — no context, store or router in this phase:

```ts
sessions: Session[]             // seeded from mockSessions
activeSessionId: string
isDrawerOpen: boolean
isSidebarOpen: boolean          // mobile overlay only
thinkingSessionId: string | null
```

`thinkingSessionId` (rather than a global boolean) keeps the typing indicator scoped to the thread that is actually waiting, so switching sessions mid-reply doesn't leak the loader.

### Mock interaction flow

1. User types, presses `Enter` or Send, or clicks a slash chip (`/summarize`, `/extract-tasks`, `/explain-code`) to prefill the composer.
2. The user message is appended to the active session and `thinkingSessionId` is set.
3. `MessageList` shows an "Agent is thinking" row with animated dots for **600ms**.
4. A canned reply is appended explaining that the transport and agent runtime arrive in Phases 2–3. Slash commands are echoed back by name.
5. Pending timers are cleared on unmount; the send button is disabled while a reply is in flight.

New Session creates an empty thread so the transcript empty state (and artifact empty state) can be reviewed.

### Design tokens

Defined once in `src/index.css` under `@theme`, so every surface, border and accent is a Tailwind utility (`bg-panel`, `border-line`, `text-ink-dim`, `bg-live`, …):

- **Surfaces:** `void → shell → panel → raised → hover`
- **Type:** `ink` (primary), `ink-soft` (body), `ink-dim` (meta), Inter + JetBrains Mono
- **Accents:** `accent` violet for agent affordances, `live` green for runtime status
- **Motion:** `fade-up` (messages), `ping-soft` (status dot), `dot` (typing), `slide-in` (drawer) — all gated with `motion-safe` where they loop

Dark is the only theme in Phase 1; tokens are structured so a light theme is a token override, not a rewrite.

---

## Accessibility notes

- Transcript is a labelled `role="log"`; the typing row is `aria-live="polite"`.
- Composer has a real `<form>` with a labelled textarea; icon-only buttons carry `aria-label`.
- Drawer toggle exposes `aria-pressed` / `aria-controls`; panels have accessible names.
- Visible `:focus-visible` ring on all interactive elements.

## Build verification

`npm run lint` (Oxlint) and `npm run build` (`tsc -b` + Vite) both pass with no errors or warnings.

---

## Roadmap

| Phase | Scope |
| ----- | ----- |
| **1 — current** | Chat UI, mock sessions, tool cards, action log, composer |
| 2 | WebSocket transport, streaming agent responses, session persistence |
| 3 | Agent runtime: planning, real tool execution, artifact generation |

## Out of scope for Phase 1

Backend services, WebSocket/SSE servers, LLM provider keys, auth, database persistence, markdown rendering of agent output, and real file/tool execution.
