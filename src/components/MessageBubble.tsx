import { ChevronDown, LoaderCircle, Sparkles, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { Message, ToolExecution } from '../types'

const STATUS_META: Record<ToolExecution['status'], { label: string; dot: string }> = {
  completed: { label: 'Completed', dot: 'bg-live' },
  running: { label: 'Running', dot: 'bg-accent-soft' },
  failed: { label: 'Failed', dot: 'bg-red-400' },
}

function ToolExecutionCard({ tool }: { tool: ToolExecution }) {
  const [isOpen, setIsOpen] = useState(false)
  const status = STATUS_META[tool.status]

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-line bg-void/50">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-raised/60"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-raised">
          <Wrench className="size-3 text-accent-soft" aria-hidden="true" />
        </span>

        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-dim">
          Action: <span className="text-ink-soft">{tool.action}</span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-ink-soft">
          <span className={`size-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
          {status.label}
        </span>

        <span className="shrink-0 font-mono text-[10px] text-ink-dim">{tool.durationMs}ms</span>

        <ChevronDown
          className={`size-3.5 shrink-0 text-ink-dim transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div className="space-y-2.5 border-t border-line bg-black/25 px-3 py-3">
          {tool.summary && (
            <p className="text-[11.5px] leading-relaxed text-ink-soft">{tool.summary}</p>
          )}

          {tool.input && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">
                input
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg border border-line/70 bg-void/80 p-2 font-mono text-[10.5px] leading-relaxed text-ink-dim">
                {tool.input}
              </pre>
            </div>
          )}

          {tool.output && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">
                output
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg border border-line/70 bg-void/80 p-2 font-mono text-[10.5px] leading-relaxed text-live/80">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <li className="flex justify-end animate-fade-up">
        <div className="max-w-[88%] sm:max-w-[78%]">
          <div className="flex items-center justify-end gap-2 pb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
              You
            </span>
            <span className="font-mono text-[10px] text-ink-dim/70">{message.timestamp}</span>
          </div>
          <div className="whitespace-pre-line break-words rounded-2xl rounded-br-md border border-accent/25 bg-accent-deep/70 px-4 py-3 text-[13.5px] leading-relaxed text-ink">
            {message.content}
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className="flex gap-3 animate-fade-up">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-line bg-raised">
        <Sparkles className="size-4 text-accent-soft" aria-hidden="true" />
      </span>

      <div className="min-w-0 max-w-full flex-1">
        <div className="flex items-center gap-2 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Orchion Agent
          </span>
          <span className="size-1 rounded-full bg-ink-dim/50" aria-hidden="true" />
          <span className="font-mono text-[10px] text-ink-dim/70">{message.timestamp}</span>
        </div>

        <div className="whitespace-pre-line break-words rounded-2xl rounded-tl-md border border-line bg-panel px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft">
          {message.content}
        </div>

        {message.tool && <ToolExecutionCard tool={message.tool} />}
      </div>
    </li>
  )
}

export function TypingIndicator() {
  return (
    <li className="flex gap-3 animate-fade-up" aria-live="polite">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-line bg-raised">
        <Sparkles className="size-4 text-accent-soft" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Orchion Agent
          </span>
          <span className="font-mono text-[10px] text-ink-dim/70">thinking…</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-line bg-panel px-4 py-3">
          <LoaderCircle className="size-3.5 animate-spin text-accent-soft" aria-hidden="true" />
          <span className="text-[12.5px] text-ink-dim">Agent is thinking</span>
          <span className="flex items-end gap-0.5" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="size-1 rounded-full bg-accent-soft motion-safe:animate-dot"
                style={{ animationDelay: `${index * 160}ms` }}
              />
            ))}
          </span>
        </div>
      </div>
    </li>
  )
}
