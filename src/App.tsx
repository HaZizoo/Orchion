import { useEffect, useRef, useState } from 'react'
import { AgentDrawer } from './components/AgentDrawer'
import { ChatHeader } from './components/ChatHeader'
import { ChatInput, type ChatInputHandle } from './components/ChatInput'
import { MessageList } from './components/MessageList'
import { Sidebar } from './components/Sidebar'
import { MOCK_MODEL } from './data/mockSessions'
import { describeApiError } from './services/api'
import { isAbortError, streamChatResponse } from './services/chatTransport'
import {
  createSession,
  deleteSession,
  loadWorkspaceOrSeed,
  resetWorkspace,
  saveSession,
  setActiveSession,
} from './services/sessionStorage'
import type { Message, Session } from './types'

/** Coalesce token-rate updates into a single API write. */
const PERSIST_DEBOUNCE_MS = 600

type BootStatus = 'loading' | 'ready' | 'error'

function currentTime(): string {
  return new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** Names a thread after its first prompt, dropping any leading slash command. */
function deriveTitle(prompt: string): string {
  const withoutCommand = prompt.replace(/^\/[a-z-]+\s*/i, '')
  const source = (withoutCommand || prompt).replace(/\s+/g, ' ').trim()
  return source.length > 44 ? `${source.slice(0, 44)}…` : source
}

function BootScreen({
  status,
  message,
  onRetry,
}: {
  status: BootStatus
  message: string
  onRetry: () => void
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-void px-6 text-ink">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">
          <span
            className={
              status === 'error'
                ? 'size-1.5 rounded-full bg-red-400'
                : 'size-1.5 animate-pulse rounded-full bg-live'
            }
            aria-hidden="true"
          />
          Orchion API
        </div>

        <h1 className="mt-3 text-lg font-semibold tracking-tight">
          {status === 'error' ? 'Backend unreachable' : 'Connecting to your workspace'}
        </h1>

        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
          {status === 'error'
            ? message
            : 'Loading threads from MongoDB and checking the API token…'}
        </p>

        {status === 'error' && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-[12px] font-medium text-ink transition hover:bg-accent/20 active:translate-y-px"
          >
            Retry connection
          </button>
        )}
      </div>
    </div>
  )
}

function App() {
  const [status, setStatus] = useState<BootStatus>('loading')
  const [bootError, setBootError] = useState('')
  const [bootAttempt, setBootAttempt] = useState(0)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [isDrawerOpen, setIsDrawerOpen] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [streamingSessionIds, setStreamingSessionIds] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)

  const composerRef = useRef<ChatInputHandle>(null)
  const controllers = useRef(new Map<string, AbortController>())
  const lastSaved = useRef(new Map<string, string>())
  const lastActive = useRef('')
  const pendingCreates = useRef(new Set<string>())
  const untitledCount = useRef(1)

  // Hydrate from the API; on first run upload the Phase 1 fixtures.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const workspace = await loadWorkspaceOrSeed()
        if (cancelled) return

        lastSaved.current = new Map(
          workspace.sessions.map((session) => [session.id, JSON.stringify(session)]),
        )
        lastActive.current = workspace.activeSessionId
        setSessions(workspace.sessions)
        setActiveSessionId(workspace.activeSessionId)
        setBootError('')
        setStatus('ready')
      } catch (error) {
        if (cancelled) return
        setBootError(describeApiError(error))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bootAttempt])

  // Debounced snapshot sync: only threads whose JSON changed are written.
  useEffect(() => {
    if (status !== 'ready') return

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          for (const session of sessions) {
            if (pendingCreates.current.has(session.id)) continue
            const encoded = JSON.stringify(session)
            if (lastSaved.current.get(session.id) === encoded) continue
            await saveSession(session)
            lastSaved.current.set(session.id, encoded)
          }

          if (lastActive.current !== activeSessionId) {
            await setActiveSession(activeSessionId)
            lastActive.current = activeSessionId
          }

          if (!cancelled) setSaveError(null)
        } catch (error) {
          if (!cancelled) setSaveError(describeApiError(error))
        }
      })()
    }, PERSIST_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [sessions, activeSessionId, status])

  // Never leave a generator running against an unmounted tree.
  useEffect(() => {
    const pending = controllers.current
    return () => {
      pending.forEach((controller) => controller.abort())
      pending.clear()
    }
  }, [])

  if (status !== 'ready' || sessions.length === 0) {
    return (
      <BootScreen
        status={status}
        message={bootError}
        onRetry={() => {
          setBootError('')
          setStatus('loading')
          setBootAttempt((attempt) => attempt + 1)
        }}
      />
    )
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const isStreaming = streamingSessionIds.includes(activeSession.id)

  function patchSession(sessionId: string, update: (session: Session) => Session) {
    setSessions((previous) =>
      previous.map((session) => (session.id === sessionId ? update(session) : session)),
    )
  }

  function patchMessage(sessionId: string, messageId: string, update: (message: Message) => Message) {
    patchSession(sessionId, (session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId ? update(message) : message,
      ),
    }))
  }

  function createEmptySession(): Session {
    const session: Session = {
      id: createId(),
      title: `New Session ${untitledCount.current}`,
      updatedAt: currentTime(),
      model: MOCK_MODEL,
      messages: [],
      artifacts: [],
    }
    untitledCount.current += 1
    return session
  }

  /** Persists a thread that only exists in React state right now. */
  function commitSession(session: Session) {
    pendingCreates.current.add(session.id)
    void createSession(session)
      .then((saved) => {
        lastSaved.current.set(saved.id, JSON.stringify(saved))
        pendingCreates.current.delete(session.id)
        setSaveError(null)
      })
      .catch((error) => {
        pendingCreates.current.delete(session.id)
        lastSaved.current.delete(session.id)
        setSaveError(describeApiError(error))
      })
  }

  function handleSelectSession(id: string) {
    setActiveSessionId(id)
    setIsSidebarOpen(false)
  }

  function handleNewSession() {
    const session = createEmptySession()
    setSessions((previous) => [session, ...previous])
    setActiveSessionId(session.id)
    setIsSidebarOpen(false)
    composerRef.current?.focusAndClear()
    commitSession(session)
  }

  function handleDeleteSession(id: string) {
    controllers.current.get(id)?.abort()
    lastSaved.current.delete(id)

    void deleteSession(id).catch((error) => setSaveError(describeApiError(error)))

    const remaining = sessions.filter((session) => session.id !== id)
    const nextSessions = remaining.length > 0 ? remaining : [createEmptySession()]

    setSessions(nextSessions)
    if (!nextSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(nextSessions[0].id)
    }
    setStreamingSessionIds((previous) => previous.filter((sessionId) => sessionId !== id))

    if (remaining.length === 0) commitSession(nextSessions[0])
  }

  function handleResetDemo() {
    if (!window.confirm('Reset every thread back to the demo data? The threads saved for this account will be replaced.')) {
      return
    }

    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
    setStreamingSessionIds([])

    void (async () => {
      try {
        const workspace = await resetWorkspace()
        lastSaved.current = new Map(
          workspace.sessions.map((session) => [session.id, JSON.stringify(session)]),
        )
        lastActive.current = workspace.activeSessionId
        setSessions(workspace.sessions)
        setActiveSessionId(workspace.activeSessionId)
        untitledCount.current = 1
        setSaveError(null)
        composerRef.current?.focusAndClear()
      } catch (error) {
        setSaveError(describeApiError(error))
      }
    })()
  }

  function handleStop(sessionId: string) {
    controllers.current.get(sessionId)?.abort()
  }

  function handleSend(rawContent: string) {
    const content = rawContent.trim()
    const sessionId = activeSessionId
    if (!content || controllers.current.has(sessionId)) return

    // The model needs the thread itself, otherwise /summarize has nothing to read.
    const history = activeSession.messages
      .filter((message) => message.content.trim().length > 0)
      .map((message) => ({
        role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: message.content,
      }))

    const timestamp = currentTime()
    const userMessage: Message = {
      id: createId(),
      role: 'user',
      content,
      timestamp,
      status: 'complete',
    }
    // The assistant row exists before the first event, so the stream renders
    // into a stable id instead of replacing an element on every token.
    const agentMessage: Message = {
      id: createId(),
      role: 'agent',
      content: '',
      timestamp,
      status: 'streaming',
    }

    patchSession(sessionId, (session) => ({
      ...session,
      updatedAt: timestamp,
      title: session.messages.length === 0 ? deriveTitle(content) : session.title,
      messages: [...session.messages, userMessage, agentMessage],
    }))

    const controller = new AbortController()
    controllers.current.set(sessionId, controller)
    setStreamingSessionIds((previous) =>
      previous.includes(sessionId) ? previous : [...previous, sessionId],
    )

    void (async () => {
      try {
        for await (const event of streamChatResponse({
          prompt: content,
          sessionId,
          history,
          signal: controller.signal,
        })) {
          switch (event.type) {
            case 'tool_start':
              patchMessage(sessionId, agentMessage.id, (message) => ({
                ...message,
                tool: {
                  action: event.action,
                  status: 'running',
                  durationMs: 0,
                  summary: event.summary,
                },
              }))
              break

            case 'tool_complete': {
              patchMessage(sessionId, agentMessage.id, (message) => ({
                ...message,
                tool: event.tool,
              }))

              const artifact = event.artifact
              if (artifact) {
                patchSession(sessionId, (session) =>
                  session.artifacts.some((entry) => entry.id === artifact.id)
                    ? session
                    : { ...session, artifacts: [artifact, ...session.artifacts] },
                )
              }
              break
            }

            case 'token':
              patchMessage(sessionId, agentMessage.id, (message) => ({
                ...message,
                content: message.content + event.delta,
              }))
              break

            case 'done':
              patchMessage(sessionId, agentMessage.id, (message) => ({
                ...message,
                status: 'complete',
              }))
              patchSession(sessionId, (session) => ({ ...session, updatedAt: currentTime() }))
              break
          }
        }

        // Defensive: a generator that ends without `done` must not stay "streaming".
        patchMessage(sessionId, agentMessage.id, (message) =>
          message.status === 'streaming' ? { ...message, status: 'complete' } : message,
        )
      } catch (error) {
        const aborted = isAbortError(error) || controller.signal.aborted
        patchMessage(sessionId, agentMessage.id, (message) => ({
          ...message,
          status: aborted ? 'stopped' : 'error',
          tool:
            message.tool?.status === 'running'
              ? {
                  ...message.tool,
                  status: aborted ? 'cancelled' : 'failed',
                  summary: aborted ? 'Cancelled by user' : 'Tool did not finish',
                }
              : message.tool,
        }))
      } finally {
        controllers.current.delete(sessionId)
        setStreamingSessionIds((previous) =>
          previous.filter((activeId) => activeId !== sessionId),
        )
      }
    })()
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-void text-ink">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSession.id}
        isOpen={isSidebarOpen}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onResetDemo={handleResetDemo}
        onClose={() => setIsSidebarOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          session={activeSession}
          isDrawerOpen={isDrawerOpen}
          isStreaming={isStreaming}
          onToggleDrawer={() => setIsDrawerOpen((open) => !open)}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />

        <div className="flex min-h-0 flex-1">
          <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
            <MessageList messages={activeSession.messages} />
            <ChatInput
              ref={composerRef}
              onSend={handleSend}
              onStop={() => handleStop(activeSession.id)}
              isStreaming={isStreaming}
            />
          </section>

          {isDrawerOpen && (
            <AgentDrawer session={activeSession} onClose={() => setIsDrawerOpen(false)} />
          )}
        </div>
      </main>

      {saveError && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 rounded-lg border border-red-500/30 bg-panel px-3 py-2 text-center text-[11.5px] leading-relaxed text-ink-soft shadow-xl"
        >
          {saveError}
        </div>
      )}
    </div>
  )
}

export default App
