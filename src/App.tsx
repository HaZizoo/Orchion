import { useEffect, useRef, useState } from 'react'
import { AgentDrawer } from './components/AgentDrawer'
import { ChatHeader } from './components/ChatHeader'
import { ChatInput, type ChatInputHandle } from './components/ChatInput'
import { MessageList } from './components/MessageList'
import { Sidebar } from './components/Sidebar'
import { MOCK_MODEL } from './data/mockSessions'
import { isAbortError, streamChatResponse } from './services/chatTransport'
import {
  createWorkspace,
  loadWorkspace,
  resetWorkspace,
  saveWorkspace,
  type Workspace,
} from './services/sessionStorage'
import type { Message, Session } from './types'

/** Coalesce token-rate updates into a single localStorage write. */
const PERSIST_DEBOUNCE_MS = 300

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

function App() {
  const [boot] = useState<Workspace>(() => loadWorkspace() ?? createWorkspace())
  const [sessions, setSessions] = useState<Session[]>(boot.sessions)
  const [activeSessionId, setActiveSessionId] = useState<string>(boot.activeSessionId)
  const [isDrawerOpen, setIsDrawerOpen] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [streamingSessionIds, setStreamingSessionIds] = useState<string[]>([])

  const composerRef = useRef<ChatInputHandle>(null)
  const controllers = useRef(new Map<string, AbortController>())
  const latestWorkspace = useRef<Workspace>({ sessions, activeSessionId })
  const untitledCount = useRef(1)

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const isStreaming = streamingSessionIds.includes(activeSession.id)

  useEffect(() => {
    latestWorkspace.current = { sessions, activeSessionId }
  }, [sessions, activeSessionId])

  useEffect(() => {
    const timer = window.setTimeout(
      () => saveWorkspace({ sessions, activeSessionId }),
      PERSIST_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [sessions, activeSessionId])

  // Flush the last debounce window when the tab goes away, and never leave a
  // generator running against an unmounted tree.
  useEffect(() => {
    function flush() {
      saveWorkspace(latestWorkspace.current)
    }

    window.addEventListener('pagehide', flush)
    const pending = controllers.current

    return () => {
      window.removeEventListener('pagehide', flush)
      pending.forEach((controller) => controller.abort())
      pending.clear()
    }
  }, [])

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
  }

  function handleDeleteSession(id: string) {
    controllers.current.get(id)?.abort()

    const remaining = sessions.filter((session) => session.id !== id)
    const nextSessions = remaining.length > 0 ? remaining : [createEmptySession()]

    setSessions(nextSessions)
    if (!nextSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(nextSessions[0].id)
    }
    setStreamingSessionIds((previous) => previous.filter((sessionId) => sessionId !== id))
  }

  function handleResetDemo() {
    if (!window.confirm('Reset every thread back to the demo data? Local history will be cleared.')) {
      return
    }

    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
    setStreamingSessionIds([])

    const workspace = resetWorkspace()
    setSessions(workspace.sessions)
    setActiveSessionId(workspace.activeSessionId)
    untitledCount.current = 1
    composerRef.current?.focusAndClear()
  }

  function handleStop(sessionId: string) {
    controllers.current.get(sessionId)?.abort()
  }

  function handleSend(rawContent: string) {
    const content = rawContent.trim()
    const sessionId = activeSessionId
    if (!content || controllers.current.has(sessionId)) return

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
        for await (const event of streamChatResponse({ prompt: content, signal: controller.signal })) {
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

            case 'tool_complete':
              patchMessage(sessionId, agentMessage.id, (message) => ({
                ...message,
                tool: event.tool,
              }))
              patchSession(sessionId, (session) =>
                session.artifacts.some((artifact) => artifact.id === event.artifact.id)
                  ? session
                  : { ...session, artifacts: [event.artifact, ...session.artifacts] },
              )
              break

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
    </div>
  )
}

export default App
