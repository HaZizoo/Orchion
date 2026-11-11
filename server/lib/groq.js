import { config } from '../config.js'

const ERROR_DETAIL_CHARS = 220

export const MISSING_KEY_MESSAGE =
  "Groq isn't connected yet: `GROQ_API_KEY` is not set on the API server. Add it to `server/.env` " +
  '(for example `GROQ_API_KEY=…`) and restart `npm run dev:server` — the key now stays on the server and ' +
  'never reaches the browser.'

export const UNREACHABLE_MESSAGE =
  "Couldn't reach Groq from the API server — the request failed before any tokens arrived. " +
  'Check the server logs and the connection, then send again.'

export const EMPTY_MESSAGE = 'Groq accepted the request but returned no body. Send it again.'

export const BASE_SYSTEM_PROMPT =
  'You are Orchion, a terse senior engineering assistant inside a developer console. ' +
  'Answer in GitHub-flavoured Markdown: short paragraphs, bullet lists, and fenced code blocks with a language tag. ' +
  'Be concrete and skip filler. Never claim to have run tools, read files, or written artifacts — the console ' +
  'reports those separately.'

export function isGroqConfigured() {
  return config.groqApiKey.length > 0
}

export function buildGroqMessages({ instruction, history, prompt }) {
  const messages = [{ role: 'system', content: BASE_SYSTEM_PROMPT }]

  if (instruction) messages.push({ role: 'system', content: instruction })

  for (const turn of history.slice(-config.historyTurns)) {
    const content = turn.content.trim()
    if (content.length > 0) {
      messages.push({ role: turn.role, content: content.slice(-config.historyChars) })
    }
  }

  const cleaned = prompt.replace(/^\/[a-z-]+\s*/i, '').trim()
  messages.push({ role: 'user', content: cleaned || 'Apply the requested action to this conversation.' })

  return messages
}

export async function openGroqStream({ messages, signal }) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model: config.groqModel,
      stream: true,
      temperature: 0.5,
      max_completion_tokens: config.maxCompletionTokens,
      messages,
    }),
    signal,
  })
}

export async function readErrorDetail(response) {
  try {
    const text = await response.text()
    const compact = text.replace(/\s+/g, ' ').trim()
    return compact.length > ERROR_DETAIL_CHARS ? `${compact.slice(0, ERROR_DETAIL_CHARS)}…` : compact
  } catch {
    return ''
  }
}

export function httpErrorMessage(status, detail) {
  const suffix = detail.length > 0 ? `\n\nGroq said: \`${detail}\`` : ''

  if (status === 401 || status === 403) {
    return (
      `Groq rejected the API key (HTTP ${status}). Update \`GROQ_API_KEY\` in \`server/.env\` and restart ` +
      `the API server. The key must be a Groq API key with access to \`${config.groqModel}\`.` +
      suffix
    )
  }

  if (status === 429) {
    return (
      "Groq is rate limiting this key (HTTP 429). Wait a few seconds and send again, or check the key's " +
      'limits in the Groq console.' +
      suffix
    )
  }

  if (status === 404) {
    return (
      `Groq has no model \`${config.groqModel}\` available to this key (HTTP 404). Pick a model the account ` +
      'can access, or set `GROQ_MODEL` in `server/.env`.' +
      suffix
    )
  }

  return `Groq returned HTTP ${status} before any tokens arrived. Try again in a moment.${suffix}`
}

/** Parses one OpenAI-style SSE line; reasoning deltas are ignored. */
function parseSseLine(line) {
  if (!line.startsWith('data:')) return null

  const payload = line.slice(5).trim()
  if (payload.length === 0 || payload === '[DONE]') return null

  let parsed
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }

  if (parsed?.error?.message) throw new Error(parsed.error.message)

  const delta = parsed?.choices?.[0]?.delta?.content
  return typeof delta === 'string' && delta.length > 0 ? delta : null
}

/** Yields Groq text deltas, buffering partial lines across chunks. */
export async function* readGroqTokens(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')

        const delta = parseSseLine(line)
        if (delta !== null) yield delta
      }
    }

    buffer += decoder.decode()
    const tail = parseSseLine(buffer.replace(/\r$/, ''))
    if (tail !== null) yield tail
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}
