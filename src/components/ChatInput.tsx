import { Send, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { quickActions } from '../data/mockSessions'

interface ChatInputProps {
  onSend: (content: string) => void
  isBusy: boolean
}

export function ChatInput({ onSend, isBusy }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize the textarea up to a readable ceiling.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [value])

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || isBusy) return
    onSend(trimmed)
    setValue('')
    textareaRef.current?.focus()
  }

  function applyQuickAction(command: string) {
    setValue(`${command} `)
    textareaRef.current?.focus()
  }

  const canSend = value.trim().length > 0 && !isBusy

  return (
    <div className="shrink-0 border-t border-line bg-void/85 px-3 pb-3 pt-2.5 backdrop-blur sm:px-5 sm:pb-4">
      <div className="mx-auto w-full max-w-3xl">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="rounded-2xl border border-line bg-panel p-2 shadow-[0_24px_60px_-38px_rgba(0,0,0,1)] transition focus-within:border-accent/45 focus-within:ring-2 focus-within:ring-accent/10"
        >
          <div className="flex flex-wrap gap-1.5 px-1 pb-2 pt-0.5">
            {quickActions.map((action) => (
              <button
                key={action.command}
                type="button"
                onClick={() => applyQuickAction(action.command)}
                title={action.label}
                className="flex items-center gap-1 rounded-full border border-line bg-raised/60 px-2 py-1 font-mono text-[10.5px] text-ink-dim transition hover:border-accent/40 hover:bg-hover hover:text-ink-soft"
              >
                <Zap className="size-2.5" aria-hidden="true" />
                {action.command}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <label htmlFor="prompt" className="sr-only">
              Message the agent
            </label>
            <textarea
              id="prompt"
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder="Ask the agent to do something…"
              spellCheck={false}
              className="max-h-50 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-dim/80 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 text-[12.5px] font-semibold text-void transition hover:bg-accent-soft active:translate-y-px disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-dim"
            >
              <Send className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </form>

        <div className="flex items-center justify-between gap-3 px-1 pt-2">
          <p className="text-[10.5px] text-ink-dim">
            <kbd className="font-mono text-ink-dim/90">Enter</kbd> to send ·{' '}
            <kbd className="font-mono text-ink-dim/90">Shift + Enter</kbd> for a new line
          </p>
          <p className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim/70 sm:block">
            {isBusy ? 'agent responding' : 'mock mode'}
          </p>
        </div>
      </div>
    </div>
  )
}
