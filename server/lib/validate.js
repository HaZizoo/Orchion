const LIMITS = {
  title: 200,
  content: 40000,
  messages: 400,
  artifacts: 60,
  json: 12000,
  items: 40,
  item: 1000,
}

const MESSAGE_STATUSES = ['streaming', 'complete', 'stopped', 'error']
const TOOL_STATUSES = ['running', 'completed', 'failed', 'cancelled']
const ARTIFACT_KINDS = ['summary', 'tasks', 'code', 'schema']

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

function fail(message) {
  throw new HttpError(400, message)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value, max, field) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') fail(`${field} must be a string`)
  if (value.length > max) fail(`${field} is longer than ${max} characters`)
  return value
}

function readJsonRecord(value, field) {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) fail(`${field} must be a JSON object`)
  if (JSON.stringify(value).length > LIMITS.json) fail(`${field} is larger than ${LIMITS.json} bytes`)
  return value
}

function parseTool(value, index) {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) fail(`messages[${index}].tool must be an object`)

  const action = readString(value.action, 120, `messages[${index}].tool.action`)?.trim()
  if (!action) fail(`messages[${index}].tool.action is required`)

  const status = TOOL_STATUSES.includes(value.status) ? value.status : 'completed'
  const durationMs =
    typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
      ? Math.min(Math.max(Math.round(value.durationMs), 0), 600000)
      : 0

  return {
    action,
    status,
    durationMs,
    summary: readString(value.summary, 500, `messages[${index}].tool.summary`),
    input: readJsonRecord(value.input, `messages[${index}].tool.input`),
    output: readJsonRecord(value.output, `messages[${index}].tool.output`),
  }
}

function parseMessage(value, index) {
  if (!isRecord(value)) fail(`messages[${index}] must be an object`)

  const id = readString(value.id, 160, `messages[${index}].id`)?.trim()
  if (!id) fail(`messages[${index}].id is required`)

  return {
    messageId: id,
    role: value.role === 'user' ? 'user' : 'agent',
    content: readString(value.content, LIMITS.content, `messages[${index}].content`) ?? '',
    timestamp: readString(value.timestamp, 40, `messages[${index}].timestamp`) ?? '',
    status: MESSAGE_STATUSES.includes(value.status) ? value.status : 'complete',
    tool: parseTool(value.tool, index),
    order: index,
  }
}

function parseArtifact(value, index) {
  if (!isRecord(value)) fail(`artifacts[${index}] must be an object`)

  const id = readString(value.id, 160, `artifacts[${index}].id`)?.trim()
  if (!id) fail(`artifacts[${index}].id is required`)

  const kind = ARTIFACT_KINDS.includes(value.kind) ? value.kind : fail(`artifacts[${index}].kind is invalid`)
  const title = readString(value.title, LIMITS.title, `artifacts[${index}].title`)?.trim()
  if (!title) fail(`artifacts[${index}].title is required`)

  const items = Array.isArray(value.items)
    ? value.items.slice(0, LIMITS.items).map((item, itemIndex) => {
        if (typeof item !== 'string' || item.length > LIMITS.item) {
          fail(`artifacts[${index}].items[${itemIndex}] must be a string under ${LIMITS.item} characters`)
        }
        return item
      })
    : undefined

  return {
    artifactId: id,
    kind,
    title,
    meta: readString(value.meta, 200, `artifacts[${index}].meta`) ?? '',
    body: readString(value.body, LIMITS.content, `artifacts[${index}].body`),
    items,
  }
}

/** Shape a client session snapshot into Mongoose-ready fields. */
export function parseSessionSnapshot(body) {
  if (!isRecord(body)) fail('Expected a JSON object.')

  const title = readString(body.title, LIMITS.title, 'title')?.trim()
  if (!title) fail('title is required')

  const artifacts = body.artifacts ?? []
  if (!Array.isArray(artifacts) || artifacts.length > LIMITS.artifacts) {
    fail(`artifacts must be an array of at most ${LIMITS.artifacts} items`)
  }

  const messages = body.messages ?? []
  if (!Array.isArray(messages) || messages.length > LIMITS.messages) {
    fail(`messages must be an array of at most ${LIMITS.messages} items`)
  }

  return {
    title,
    model: readString(body.model, 80, 'model') ?? 'orchion-agent-0.2',
    displayUpdatedAt: readString(body.updatedAt, 40, 'updatedAt') ?? '',
    artifacts: artifacts.map(parseArtifact),
    messages: messages.map(parseMessage),
  }
}

/** Bounded, role-checked conversation turns for the Groq prompt and tools. */
export function parseHistory(value) {
  if (!Array.isArray(value)) return []

  const turns = []
  for (const item of value.slice(-40)) {
    if (!isRecord(item)) continue
    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!role || content.length === 0) continue
    turns.push({ role, content: content.slice(-12000) })
  }

  return turns
}
