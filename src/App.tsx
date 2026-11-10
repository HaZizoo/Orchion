import { useEffect, useRef, useState } from 'react'
import { AgentDrawer } from './components/AgentDrawer'
import { ChatHeader } from './components/ChatHeader'
import { ChatInput } from './components/ChatInput'
import { MessageList } from './components/MessageList'
import { Sidebar } from './components/Sidebar'
import { mockSessions } from './data/mockSessions'
import type { Message, Session } from './types'

const THINKING_MS = 600

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

function buildMockReply(input: string): string {
  const command = /^\/([a-z-]+)/i.exec(input.trim())?.[1]
  const commandNote = command
    ? `I picked up the \`/${command}\` directive from your message.\n\n`
    : ''

  return `${commandNote}Message received — but there is no agent behind this panel yet.

Orchion is in Phase 1, so this thread runs on hardcoded mock state. There is no WebSocket transport, no model call and no tool runtime; the reply you just got was a 600ms timer.

Phase 2 wires the real-time layer: the composer streams over WebSockets and this response arrives token by token. Phase 3 adds the agent loop — planning, tool calls like \`summarize_text\`, and real artifacts in the Action Log.

Your message is stored in session state, so switching threads and coming back will still show it.`;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>(mockSessions)
  const [activeSessionId, setActiveSessionId] = useState<string>(mockSessions[0].id)
  const [isDrawerOpen, setIsDrawerOpen] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [thinkingSessionId, setThinkingSessionId] = useState<string | null>(null)
  const newSessionCount = useRef(1)
  const replyTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(replyTimer.current), [])

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0]

  function handleSelectSession(id: string) {
    setActiveSessionId(id)
    setIsSidebarOpen(false)
  }

  function handleNewSession() {
    const id = createId()
    const session: Session = {
      id,
      title: `New Session ${newSessionCount.current}`,
      updatedAt: currentTime(),
      model: mockSessions[0].model,
      messages: [],
      artifacts: [],
    }
    newSessionCount.current += 1
    setSessions((previous) => [session, ...previous])
    setActiveSessionId(id)
    setIsSidebarOpen(false)
  }

  function handleSend(content: string) {
    const sessionId = activeSessionId
    const timestamp = currentTime()

    const userMessage: Message = {
      id: createId(),
      role: 'user',
      content,
      timestamp,
    }

    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              updatedAt: timestamp,
              messages: [...session.messages, userMessage],
            }
          : session,
      ),
    )

    setThinkingSessionId(sessionId)
    window.clearTimeout(replyTimer.current)

    replyTimer.current = window.setTimeout(() => {
      const agentMessage: Message = {
        id: createId(),
        role: 'agent',
        content: buildMockReply(content),
        timestamp: currentTime(),
      }

      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId
            ? { ...session, messages: [...session.messages, agentMessage] }
            : session,
        ),
      )
      setThinkingSessionId(null)
    }, THINKING_MS)
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-void text-ink">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSession.id}
        isOpen={isSidebarOpen}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onClose={() => setIsSidebarOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          session={activeSession}
          isDrawerOpen={isDrawerOpen}
          onToggleDrawer={() => setIsDrawerOpen((open) => !open)}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />

        <div className="flex min-h-0 flex-1">
          <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
            <MessageList
              messages={activeSession.messages}
              isThinking={thinkingSessionId === activeSession.id}
            />
            <ChatInput
              onSend={handleSend}
              isBusy={thinkingSessionId !== null}
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
