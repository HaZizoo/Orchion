import { ChevronDown, LoaderCircle, Sparkles, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { JsonRecord, Message, ToolExecution } from '../types'
import { CopyButton } from './CopyButton'
import { MessageContent } from './MessageContent'

const TOOL_STATUS: Record<ToolExecution['status'], { label: string; dot: string }> = {
  running: { label: 'Running', dot: 'bg-accent-soft' },
  completed: { label: 'Completed', dot: 'bg-live' },
  failed: { label: 'Failed', dot: 'bg-red-400' },
  cancelled: { label: 'Cancelled', dot: 'bg-amber-400' },
}

const MESSAGE_STATUS: Record<Exclude<Message['status'], 'complete'>, { label: string; tone: string }> = {
  streaming: { label: 'streaming', tone: 'text-accent-soft' },
  stopped: { label: 'stopped', tone: 'text-amber-300' },
  error: { label: 'failed', tone: 'text-red-400' },
}

function formatJson(value: JsonRecord | undefined): string {
  return value ? JSON.stringify(value, null, 2) : ''
}

function ToolExecutionCard({ tool }: { tool: ToolExecution }) {
  // The card mounts during `tool_start`, so it opens for the running state and
  // stays open once the payload settles. `setIsOpen` only comes from the toggle.
  const [isOpen, setIsOpen] = useState(tool.status === 'running')
  const status = TOOL_STATUS[tool.status]
  const isRunning = tool.status === 'running'
  const inputJson = formatJson(tool.input)
  const outputJson = formatJson(tool.output)

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-line bg-void/50">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-raised/60"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-raised">
          {isRunning ? (
            <LoaderCircle className="size-3 animate-spin text-accent-soft" aria-hidden="true" />
          ) : (
            <Wrench className="size-3 text-accent-soft" aria-hidden="true" />
          )}
        </span>

        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-dim">
          Action: <span className="text-ink-soft">{tool.action}</span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-ink-soft">
          <span className={`size-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
          {status.label}
        </span>

        <span className="shrink-0 font-mono text-[10px] text-ink-dim">
          {isRunning ? '…' : `${tool.durationMs}ms`}
        </span>

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

          {inputJson && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">input</p>
                <CopyButton value={inputJson} label="Copy tool input" />
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-line/70 bg-void/80 p-2 font-mono text-[10.5px] leading-relaxed text-ink-dim">
                {inputJson}
              </pre>
            </div>
          )}

          {outputJson && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">
                  output
                </p>
                <CopyButton value={outputJson} label="Copy tool output" />
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-line/70 bg-void/80 p-2 font-mono text-[10.5px] leading-relaxed text-live/80">
                {outputJson}
              </pre>
            </div>
          )}

          {!inputJson && !outputJson && isRunning && (
            <p className="flex items-center gap-2 font-mono text-[10.5px] text-ink-dim">
              <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
              awaiting tool result…
            </p>
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

  const statusMeta = message.status === 'complete' ? null : MESSAGE_STATUS[message.status]
  const isEmpty = message.content.trim() === ''

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

          {statusMeta && (
            <span className={`flex items-center gap-1 font-mono text-[10px] ${statusMeta.tone}`}>
              {message.status === 'streaming' && (
                <span
                  className="inline-block h-2.5 w-[2px] bg-accent-soft motion-safe:animate-caret"
                  aria-hidden="true"
                />
              )}
              {statusMeta.label}
            </span>
          )}

          {!isEmpty && (
            <CopyButton value={message.content} label="Copy reply" className="ml-auto -my-1" />
          )}
        </div>

        <div className="rounded-2xl rounded-tl-md border border-line bg-panel px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft">
          {isEmpty ? (
            <span className="text-[12.5px] italic text-ink-dim">
              {message.status === 'stopped'
                ? 'Generation stopped before any text arrived.'
                : message.status === 'error'
                  ? 'The stream failed before any text arrived.'
                  : 'Working…'}
            </span>
          ) : (
            <MessageContent content={message.content} />
          )}
        </div>

        {message.tool && <ToolExecutionCard tool={message.tool} />}
      </div>
    </li>
  )
}
