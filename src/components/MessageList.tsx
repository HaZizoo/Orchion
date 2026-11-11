import { Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Message } from '../types'
import { MessageBubble } from './MessageBubble'

const SUGGESTIONS = [
  '/summarize this thread',
  '/extract-tasks from the notes',
  '/explain-code the middleware',
]

interface MessageListProps {
  messages: Message[]
}

export function MessageList({ messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const isPinned = useRef(true)

  // Follow the stream, but stop hijacking the viewport once the reader scrolls up.
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    function handleScroll() {
      if (!element) return
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      isPinned.current = distance < 96
    }

    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (isPinned.current) {
      endRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [messages])

  const isEmpty = messages.length === 0

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,135,249,0.07),transparent_55%)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        {isEmpty ? (
          <div className="flex min-h-[52vh] flex-col items-center justify-center text-center">
            <span className="grid size-12 place-items-center rounded-2xl border border-line bg-raised">
              <Sparkles className="size-5 text-accent-soft" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-lg font-semibold tracking-tight text-ink">Start a new thread</h2>
            <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-dim">
              Ask the agent to summarize, extract tasks or review code. Replies stream token by token
              from Groq through the API proxy as each tool card settles.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <span
                  key={suggestion}
                  className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[10.5px] text-ink-dim"
                >
                  {suggestion}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-6" role="log" aria-label="Conversation">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </ul>
        )}

        <div ref={endRef} className="h-px" />
      </div>
    </div>
  )
}
