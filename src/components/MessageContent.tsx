import { Fragment, type ReactNode } from 'react'
import { CopyButton } from './CopyButton'

type Block = { type: 'text'; value: string } | { type: 'code'; language: string; value: string }

const FENCE = /```([\w+-]*)\n([\s\S]*?)(?:```|$)/g
const LIST_ITEM = /^\s*(?:[-*]|\d+[.)])\s+/

/**
 * Splits on fenced code. An unterminated fence still renders as code, so the
 * transcript never flashes raw backticks while a block is still streaming in.
 */
function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let cursor = 0

  FENCE.lastIndex = 0
  let match = FENCE.exec(source)

  while (match !== null) {
    if (match.index > cursor) {
      blocks.push({ type: 'text', value: source.slice(cursor, match.index) })
    }
    blocks.push({
      type: 'code',
      language: match[1] || 'text',
      value: match[2].replace(/\n$/, ''),
    })
    cursor = match.index + match[0].length
    if (match[0].length === 0) break
    match = FENCE.exec(source)
  }

  if (cursor < source.length) {
    blocks.push({ type: 'text', value: source.slice(cursor) })
  }

  return blocks
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((token, index) => {
    const key = `${keyPrefix}-i${index}`

    if (token.length > 2 && token.startsWith('`') && token.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-raised px-1 py-0.5 font-mono text-[11.5px] text-accent-soft">
          {token.slice(1, -1)}
        </code>
      )
    }

    if (token.length > 4 && token.startsWith('**') && token.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>
      )
    }

    return <Fragment key={key}>{token}</Fragment>
  })
}

function TextBlock({ value }: { value: string }) {
  const lines = value.split('\n')
  const nodes: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (line.trim() === '') {
      index += 1
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)

    if (bullet || ordered) {
      const isOrdered = Boolean(ordered)
      const items: string[] = []
      const pattern = isOrdered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/

      while (index < lines.length) {
        const candidate = pattern.exec(lines[index])
        if (!candidate) break
        items.push(candidate[1])
        index += 1
      }

      const key = `list-${index}-${nodes.length}`
      nodes.push(
        isOrdered ? (
          <ol key={key} className="ml-4 list-decimal space-y-1 pl-1 marker:text-ink-dim">
            {items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key} className="space-y-1">
            {items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`} className="flex gap-2">
                <span
                  className="mt-[7px] size-1 shrink-0 rounded-full bg-accent-soft/70"
                  aria-hidden="true"
                />
                <span className="min-w-0">{renderInline(item, `${key}-${itemIndex}`)}</span>
              </li>
            ))}
          </ul>
        ),
      )
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() !== '' && !LIST_ITEM.test(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }

    if (paragraph.length === 0) {
      index += 1
      continue
    }

    const key = `p-${index}-${nodes.length}`
    nodes.push(
      <p key={key} className="whitespace-pre-line break-words">
        {renderInline(paragraph.join('\n'), key)}
      </p>,
    )
  }

  return <div className="space-y-2.5">{nodes}</div>
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-void/70">
      <div className="flex items-center justify-between gap-2 border-b border-line/70 px-2 py-1">
        <span className="pl-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">
          {language}
        </span>
        <CopyButton value={value} label="Copy code" />
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed text-ink-soft">
        <code>{value}</code>
      </pre>
    </div>
  )
}

/** Renders the subset of markdown the mock agent emits: lists, bold, inline code, fences. */
export function MessageContent({ content }: { content: string }) {
  return (
    <div className="space-y-2.5">
      {parseBlocks(content).map((block, index) =>
        block.type === 'code' ? (
          <CodeBlock key={`code-${index}`} language={block.language} value={block.value} />
        ) : (
          <TextBlock key={`text-${index}`} value={block.value} />
        ),
      )}
    </div>
  )
}
