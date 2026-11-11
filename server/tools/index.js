import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { codeBlocks, rankSentences, topTerms, truncate, words } from './transcript.js'

const INSTRUCTIONS = {
  summarize:
    'Summarize the conversation above for the engineer who wrote it. Lead with a five-bullet digest of the ' +
    'actual claims or decisions, then list the open action items. Quote nothing that is not in the thread; ' +
    'if the thread is empty, ask for the material to summarize.',
  extractTasks:
    'Extract every action item from the conversation above as an ordered checklist. Each line must start with ' +
    '"1." style numbering and name the concrete next move. Put the same checklist in a fenced ```md block. ' +
    'If nothing is actionable, say so in one sentence.',
  explainCode:
    'Explain the code or error discussed above. Walk the actual call path, name the root cause in one ' +
    'sentence, then give a corrected snippet in a fenced block with the right language tag. Keep it under ' +
    '250 words and do not repeat the original snippet back.',
  plan:
    'Answer the latest user message directly. Use the earlier turns as context. If the request needs more ' +
    'than three steps, give the plan first and stop there.',
}

const TASK_PATTERNS = [
  { kind: 'checkbox', pattern: /^\s*[-*]\s*\[[ xX]\]\s+(.+)$/gm },
  { kind: 'marker', pattern: /\b(?:TODO|FIXME|ACTION|NEXT)\b:?\s+(.+)$/gim },
  { kind: 'modal', pattern: /\b(?:need to|needs to|should|must|have to|plan to|let's)\s+([^.!?\n]{8,160})/gi },
]

const PACKAGE_NAME = /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/i
const IMPORT_PATTERN =
  /(?:import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g

function buildArtifact(action, kind, title, meta, body, items) {
  return {
    id: `artifact-${action}-${randomUUID()}`,
    kind,
    title,
    meta,
    ...(body ? { body } : {}),
    ...(items && items.length > 0 ? { items } : {}),
  }
}

function threadText(history) {
  return history
    .map((turn) => turn.content)
    .filter((content) => typeof content === 'string' && content.trim().length > 0)
    .join('\n\n')
}

function collectTasks(history) {
  const found = new Map()

  history.forEach((turn, turnIndex) => {
    for (const { kind, pattern } of TASK_PATTERNS) {
      for (const match of turn.content.matchAll(pattern)) {
        const text = truncate((match[1] ?? '').replace(/[.,;:\s]+$/, ''), 180)
        if (text.length < 8) continue
        const key = text.toLowerCase()
        if (found.has(key)) continue
        found.set(key, { text, kind, source: `turn ${turnIndex + 1}` })
      }
    }
  })

  return [...found.values()].slice(0, 8)
}

function extractImports(code) {
  const names = new Set()

  for (const match of code.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2]
    if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) {
      continue
    }

    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0]

    if (PACKAGE_NAME.test(name)) names.add(name)
  }

  return [...names]
}

/** Real registry lookup — the only outbound call a tool makes. */
async function lookupPackage(name, signal) {
  const timeout = AbortSignal.timeout(config.toolTimeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal: combined,
      headers: { accept: 'application/json' },
    })

    if (!response.ok) return { name, found: false }

    const data = await response.json()
    return {
      name,
      found: true,
      version: typeof data.version === 'string' ? data.version : null,
      license: typeof data.license === 'string' ? data.license : null,
      description: typeof data.description === 'string' ? truncate(data.description, 120) : null,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return { name, found: false }
  }
}

async function runSummarize({ history }) {
  const text = threadText(history)
  const totalWords = words(text).length
  const terms = topTerms(text, 6)
  const excerpts = rankSentences(text, terms, 5)
  const blocks = codeBlocks(text)

  const artifact = buildArtifact(
    'summarize',
    'summary',
    'Thread brief',
    `${history.length} turns · ${totalWords} words`,
    excerpts.join('\n\n') || 'The thread has no prose yet — send a prompt, then rerun `/summarize`.',
    terms.map(({ term, count }) => `${term} · ${count}×`),
  )

  return {
    action: 'summarize_text',
    input: { source: 'thread', turns: history.length, target_length: 120, tone: 'technical' },
    output: {
      turns: history.length,
      words: totalWords,
      excerpts: excerpts.length,
      code_blocks: blocks.length,
      top_terms: terms,
      artifact: artifact.id,
    },
    summary:
      history.length === 0
        ? 'The thread has no turns to summarize yet.'
        : `Read ${history.length} turns (${totalWords} words) and ranked ${excerpts.length} excerpts.`,
    artifact,
  }
}

async function runExtractTasks({ history }) {
  const tasks = collectTasks(history)
  const confidence = tasks.length === 0 ? 0 : Math.min(0.99, Number((0.55 + tasks.length * 0.05).toFixed(2)))

  const artifact = buildArtifact(
    'extract_tasks',
    'tasks',
    'Action items',
    `${tasks.length} found · confidence ${confidence}`,
    tasks.length > 0
      ? `Scanned ${history.length} turns and matched ${tasks.length} action items.`
      : 'No action items found. Add checkboxes, TODOs or "should/need to" phrasing and rerun `/extract-tasks`.',
    tasks.map((task) => `${task.text} (${task.source})`),
  )

  return {
    action: 'extract_tasks',
    input: { source: 'thread', turns: history.length, format: 'checklist', dedupe: true },
    output: {
      items: tasks.length,
      confidence,
      matches: tasks,
      patterns_checked: TASK_PATTERNS.length,
      artifact: artifact.id,
    },
    summary:
      tasks.length === 0
        ? 'Scanned the thread; no actionable lines matched.'
        : `Extracted ${tasks.length} action items with ${confidence} confidence.`,
    artifact,
  }
}

async function runExplainCode({ history, signal }) {
  const text = threadText(history)
  const blocks = codeBlocks(text).sort((a, b) => b.lines - a.lines)
  const largest = blocks[0]

  if (!largest) {
    const artifact = buildArtifact(
      'explain_code',
      'code',
      'No fenced code found',
      `${history.length} turns scanned`,
      'The thread has no fenced code blocks. Paste a snippet inside triple backticks and rerun `/explain-code`.',
    )

    return {
      action: 'explain_code',
      input: { scope: 'thread', turns: history.length, blocks: 0 },
      output: { blocks: 0, languages: [], packages: [], artifact: artifact.id },
      summary: 'Scanned the thread; no fenced code to explain.',
      artifact,
    }
  }

  const imports = extractImports(largest.code)
  const packages = []
  for (const name of imports.slice(0, 2)) {
    packages.push(await lookupPackage(name, signal))
  }

  const facts = [
    `Language: ${largest.language}`,
    `${largest.lines} lines in the largest block`,
    `${blocks.length} fenced block(s) in the thread`,
  ]

  if (imports.length > 0) facts.push(`Imports: ${imports.slice(0, 6).join(', ')}`)

  const resolved = packages.filter((entry) => entry.version)
  if (resolved.length > 0) {
    facts.push(...resolved.map((entry) => `${entry.name}@${entry.version}${entry.license ? ` (${entry.license})` : ''}`))
  } else if (imports.length > 0) {
    facts.push('Package registry lookup returned no metadata — check the network from the API server.')
  }

  const languages = [...new Set(blocks.map((block) => block.language))]
  const artifact = buildArtifact(
    'explain_code',
    'code',
    `${largest.language} snippet — ${largest.lines} lines`,
    `${largest.lines} lines · ${blocks.length} block(s)`,
    truncate(largest.code, 5000),
    facts,
  )

  return {
    action: 'explain_code',
    input: { scope: 'thread', turns: history.length, blocks: blocks.length, include_registry: true },
    output: {
      blocks: blocks.length,
      languages,
      imports,
      packages,
      artifact: artifact.id,
    },
    summary: `Inspected ${blocks.length} block(s); the largest is ${largest.language} at ${largest.lines} lines.`,
    artifact,
  }
}

async function runPlan({ history, prompt }) {
  const cleaned = prompt.replace(/^\/[a-z-]+\s*/i, '').trim()
  const clauses = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((clause) => clause.trim())
    .filter(Boolean)
  const contextWords = words(threadText(history)).length

  const steps = [
    `Clarify the target: ${truncate(clauses[0] ?? cleaned, 140)}`,
    `Ground the answer in ${history.length} earlier turn(s) (${contextWords} words of context).`,
  ]

  if (clauses.length > 1) {
    steps.push(`Cover the remaining ${clauses.length - 1} point(s): ${truncate(clauses.slice(1).join(' '), 140)}`)
  }

  steps.push('Answer in Markdown, then name the single next action.')

  const artifact = buildArtifact(
    'plan_task',
    'tasks',
    'Execution plan',
    `${steps.length} steps · ${history.length} turns`,
    undefined,
    steps,
  )

  return {
    action: 'plan_task',
    input: { goal: truncate(cleaned, 140), context_turns: history.length, tools: ['summarize_text', 'extract_tasks', 'explain_code'] },
    output: {
      steps: steps.length,
      context_turns: history.length,
      tools_available: ['summarize_text', 'extract_tasks', 'explain_code'],
      artifact: artifact.id,
    },
    summary: `Drafted a ${steps.length}-step plan from the prompt and ${history.length} turns of context.`,
    artifact,
  }
}

export function detectCommand(prompt) {
  const match = /^\s*\/([a-z][a-z-]*)/i.exec(prompt)
  return match ? match[1].toLowerCase() : null
}

/**
 * Resolve the command to a tool descriptor. The route emits `tool_start` with
 * `action`/`runningSummary`, then awaits `execute` and reports the measured
 * duration, so no tool fakes its own latency anymore.
 */
export function resolveToolPlan(prompt) {
  switch (detectCommand(prompt)) {
    case 'summarize':
      return {
        action: 'summarize_text',
        runningSummary: 'Condensing the thread…',
        instruction: INSTRUCTIONS.summarize,
        execute: runSummarize,
      }
    case 'extract-tasks':
      return {
        action: 'extract_tasks',
        runningSummary: 'Scanning for action items…',
        instruction: INSTRUCTIONS.extractTasks,
        execute: runExtractTasks,
      }
    case 'explain-code':
      return {
        action: 'explain_code',
        runningSummary: 'Walking the code in this thread…',
        instruction: INSTRUCTIONS.explainCode,
        execute: runExplainCode,
      }
    default:
      return {
        action: 'plan_task',
        runningSummary: 'Planning the next step…',
        instruction: INSTRUCTIONS.plan,
        execute: runPlan,
      }
  }
}
