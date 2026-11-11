import { Braces, FileText, ListChecks, Sparkles, Terminal, Wrench, X } from 'lucide-react'
import type { Artifact, ArtifactKind, Session } from '../types'
import { CopyButton } from './CopyButton'

const KIND_META: Record<ArtifactKind, { icon: typeof FileText; label: string }> = {
  summary: { icon: FileText, label: 'summary' },
  tasks: { icon: ListChecks, label: 'tasks' },
  code: { icon: Terminal, label: 'code' },
  schema: { icon: Braces, label: 'schema' },
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { icon: Icon, label } = KIND_META[artifact.kind]
  const isCode = artifact.kind === 'code' || artifact.kind === 'schema'
  const copyValue = [artifact.body, artifact.items?.map((item) => `- ${item}`).join('\n')]
    .filter(Boolean)
    .join('\n\n')

  return (
    <li className="animate-fade-up rounded-xl border border-line bg-panel">
      <div className="flex items-start gap-2.5 border-b border-line/70 px-3 py-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-line bg-raised">
          <Icon className="size-3 text-accent-soft" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-ink">{artifact.title}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-dim">{artifact.meta}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-ink-dim">
            {label}
          </span>
          <CopyButton value={copyValue} label={`Copy ${artifact.title}`} />
        </div>
      </div>

      <div className="px-3 py-2.5">
        {artifact.body && (
          <p
            className={`text-[12px] leading-relaxed text-ink-soft ${
              isCode ? 'whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-ink-dim' : ''
            }`}
          >
            {artifact.body}
          </p>
        )}

        {artifact.items && (
          <ul className="mt-2.5 space-y-1.5 first:mt-0">
            {artifact.items.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-soft">
                <span
                  className="mt-1.5 size-1 shrink-0 rounded-full bg-accent-soft/70"
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

interface AgentDrawerProps {
  session: Session
  onClose: () => void
}

export function AgentDrawer({ session, onClose }: AgentDrawerProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        id="agent-drawer"
        aria-label="Task action log"
        className="fixed inset-y-0 right-0 z-40 flex w-[336px] max-w-[86vw] shrink-0 animate-slide-in flex-col border-l border-line bg-shell max-lg:shadow-[-24px_0_60px_-30px_rgba(0,0,0,1)] lg:static lg:z-auto lg:w-[340px] lg:max-w-none"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold tracking-tight text-ink">Task Action Log</p>
            <p className="truncate text-[10.5px] text-ink-dim">
              {session.artifacts.length} structured{' '}
              {session.artifacts.length === 1 ? 'artifact' : 'artifacts'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task action log"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-raised text-ink-dim transition hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {session.artifacts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <span className="grid size-11 place-items-center rounded-xl border border-line bg-raised">
                <Wrench className="size-4 text-ink-dim" aria-hidden="true" />
              </span>
              <p className="mt-3 text-[13px] font-medium text-ink-soft">No artifacts yet</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
                Run a task in this thread and the agent&rsquo;s structured output will land here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {session.artifacts.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-4 py-3">
          <p className="flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-dim">
            <Sparkles className="mt-px size-3 shrink-0 text-accent-soft" aria-hidden="true" />
            Artifacts land here as each tool settles. Prose streams from Groq through the API proxy;
            the structured payloads are produced by the tools on the server.
          </p>
        </div>
      </aside>
    </>
  )
}
