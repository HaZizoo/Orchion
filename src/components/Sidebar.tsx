import { MessageSquare, Plus, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react'
import type { Session } from '../types'
import { StatusDot } from './StatusDot'

const CAPABILITIES = ['summarize', 'extract', 'explain', 'format']

interface SidebarProps {
  sessions: Session[]
  activeSessionId: string
  isOpen: boolean
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onResetDemo: () => void
  onClose: () => void
}

function previewFor(session: Session): string {
  const last = session.messages.at(-1)
  if (!last) return 'No messages yet'
  if (last.status === 'streaming') return 'Streaming…'
  const text = last.content.replace(/\s+/g, ' ').trim()
  if (!text) return 'No messages yet'
  return text.length > 44 ? `${text.slice(0, 44)}…` : text
}

export function Sidebar({
  sessions,
  activeSessionId,
  isOpen,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onResetDemo,
  onClose,
}: SidebarProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 md:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label="Sessions"
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] shrink-0 flex-col border-r border-line bg-shell transition-transform duration-300 ease-out md:static md:z-auto md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <span className="relative grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-[#5c58c9] shadow-[0_8px_24px_-10px_var(--color-accent)]">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="7.5" stroke="white" strokeWidth="2" />
              <path d="M12 4.5v15" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
              <circle cx="12" cy="12" r="2.25" fill="white" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-tight text-ink">Orchion</p>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-ink-dim">
              Agent console
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sessions"
            className="grid size-8 place-items-center rounded-lg text-ink-dim transition hover:bg-raised hover:text-ink md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* New session */}
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={onNewSession}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-raised px-3 py-2.5 text-[13px] font-medium text-ink-soft transition hover:border-accent/40 hover:bg-hover hover:text-ink active:translate-y-px"
          >
            <Plus className="size-4" aria-hidden="true" />
            New Session
          </button>
        </div>

        {/* Threads */}
        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <p className="px-5 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-dim">
            Threads
          </p>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              return (
                <li key={session.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`w-full rounded-lg border py-2 pl-2.5 pr-9 text-left transition-colors ${
                      isActive
                        ? 'border-line bg-raised'
                        : 'border-transparent hover:border-line/60 hover:bg-raised/50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <MessageSquare
                        className={`size-3.5 shrink-0 ${isActive ? 'text-accent-soft' : 'text-ink-dim'}`}
                        aria-hidden="true"
                      />
                      <span
                        className={`truncate text-[13px] font-medium ${
                          isActive ? 'text-ink' : 'text-ink-soft group-hover:text-ink'
                        }`}
                      >
                        {session.title}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center gap-2 pl-[22px]">
                      <span className="truncate text-[11px] text-ink-dim">{previewFor(session)}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-dim/70">
                        {session.updatedAt}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteSession(session.id)}
                    aria-label={`Delete ${session.title}`}
                    title="Delete thread"
                    className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-ink-dim opacity-100 transition hover:bg-void/60 hover:text-red-400 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Agent capabilities */}
        <div className="shrink-0 border-t border-line p-3">
          <div className="rounded-xl border border-line bg-raised/60 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-live" aria-hidden="true" />
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Agent Capabilities
              </p>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {CAPABILITIES.map((capability) => (
                <span
                  key={capability}
                  className="rounded-md border border-line bg-void/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim"
                >
                  {capability}
                </span>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <StatusDot />
              <p className="text-[11px] text-ink-dim">4 tools ready · local stream</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onResetDemo}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line/70 px-3 py-2 text-[11.5px] font-medium text-ink-dim transition hover:border-line hover:bg-raised hover:text-ink-soft active:translate-y-px"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset Demo Data
          </button>
          <p className="px-1 pt-2 font-mono text-[10px] text-ink-dim/70">Phase 2 · streaming engine</p>
        </div>
      </aside>
    </>
  )
}
