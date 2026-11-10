import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const FEEDBACK_MS = 1500

async function writeToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  // Older / insecure contexts: fall back to a hidden selection.
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-9999px'
  document.body.appendChild(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('Clipboard write rejected')
}

interface CopyButtonProps {
  value: string
  /** Accessible name, e.g. "Copy reply". */
  label?: string
  /** Visible text; icon-only when omitted. */
  text?: string
  className?: string
}

export function CopyButton({ value, label = 'Copy', text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function handleCopy() {
    try {
      await writeToClipboard(value)
    } catch {
      return
    }

    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), FEEDBACK_MS)
  }

  const Icon = copied ? Check : Copy

  return (
    <>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={copied ? `${label} — copied` : label}
        title={copied ? 'Copied' : label}
        className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-[10.5px] font-medium text-ink-dim transition hover:border-line hover:bg-raised hover:text-ink-soft ${className}`}
      >
        <Icon className={`size-3 ${copied ? 'text-live' : ''}`} aria-hidden="true" />
        {text && <span>{copied ? 'Copied' : text}</span>}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </>
  )
}
