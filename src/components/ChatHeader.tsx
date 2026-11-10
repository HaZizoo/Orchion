import { Menu, PanelRight } from 'lucide-react'
import type { Session } from '../types'
import { StatusDot } from './StatusDot'

interface ChatHeaderProps {
  session: Session
  isDrawerOpen: boolean
  isStreaming: boolean
  onToggleDrawer: () => void
  onOpenSidebar: () => void
}

export function ChatHeader({
  session,
  isDrawerOpen,
  isStreaming,
  onToggleDrawer,
  onOpenSidebar,
}: ChatHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-shell/80 px-3 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sessions"
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-raised text-ink-soft transition hover:bg-hover hover:text-ink md:hidden"
        >
          <Menu className="size-4" />
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">
              {session.title}
            </h1>
            <span className="hidden shrink-0 rounded-full border border-line bg-raised px-2 py-0.5 font-mono text-[10px] text-ink-dim sm:inline">
              {session.model}
            </span>
          </div>
          <p className="truncate text-[11.5px] text-ink-dim">
            {session.messages.length} {session.messages.length === 1 ? 'message' : 'messages'} ·{' '}
            {isStreaming ? 'streaming now' : 'saved locally'}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-live/25 bg-live/[0.07] px-2.5 py-1.5">
          <StatusDot />
          <span className="whitespace-nowrap text-[11px] font-medium text-live">
            Agent Status: Streaming Engine Ready
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleDrawer}
          aria-pressed={isDrawerOpen}
          aria-controls="agent-drawer"
          aria-label={isDrawerOpen ? 'Close task action log' : 'Open task action log'}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition ${
            isDrawerOpen
              ? 'border-accent/40 bg-accent-deep text-accent-soft'
              : 'border-line bg-raised text-ink-soft hover:bg-hover hover:text-ink'
          }`}
        >
          <PanelRight className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Action Log</span>
        </button>
      </div>
    </header>
  )
}
