import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import {
  EMPTY_MESSAGE,
  MISSING_KEY_MESSAGE,
  UNREACHABLE_MESSAGE,
  buildGroqMessages,
  httpErrorMessage,
  isGroqConfigured,
  openGroqStream,
  readErrorDetail,
  readGroqTokens,
} from '../lib/groq.js'
import { parseHistory } from '../lib/validate.js'
import { Message } from '../models/Message.js'
import { resolveToolPlan } from '../tools/index.js'
import { truncate } from '../tools/transcript.js'

const router = Router()
const PROMPT_LIMIT = 8000

function openSse(res) {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  res.write(': connected\n\n')
}

function send(res, event) {
  if (res.writableEnded) return
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

/**
 * One assistant turn: execute the real tool first, then relay Groq's SSE
 * stream. The client's AbortController closes this response, which aborts the
 * in-flight registry/Groq requests through the shared signal.
 */
router.post('/chat', requireAuth, async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''
  if (prompt.length === 0) {
    res.status(400).json({ error: 'invalid_prompt', message: 'prompt is required.' })
    return
  }
  if (prompt.length > PROMPT_LIMIT) {
    res.status(413).json({ error: 'prompt_too_long', message: `prompt must be under ${PROMPT_LIMIT} characters.` })
    return
  }

  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.slice(0, 160) : ''
  let history = parseHistory(req.body?.history)

  if (history.length === 0 && sessionId) {
    const stored = await Message.find({ userId: req.userId, sessionId }).sort({ order: 1 }).limit(60).lean()
    history = stored
      .filter((message) => message.content?.trim())
      .map((message) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: message.content }))
  }

  openSse(res)

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, 15000)
  heartbeat.unref?.()

  try {
    const plan = resolveToolPlan(prompt)
    send(res, { type: 'tool_start', action: plan.action, summary: plan.runningSummary })

    const started = performance.now()
    try {
      const result = await plan.execute({ history, prompt, signal: controller.signal })
      if (controller.signal.aborted) return

      const durationMs = Math.max(1, Math.round(performance.now() - started))
      const meta = `${result.action} · ${durationMs}ms${result.artifact.meta ? ` · ${result.artifact.meta}` : ''}`

      send(res, {
        type: 'tool_complete',
        tool: {
          action: result.action,
          status: 'completed',
          durationMs,
          summary: result.summary,
          input: result.input,
          output: result.output,
        },
        artifact: { ...result.artifact, meta },
      })
    } catch (error) {
      if (controller.signal.aborted) return

      console.error('[orchion] tool failed:', error)
      const durationMs = Math.max(1, Math.round(performance.now() - started))
      send(res, {
        type: 'tool_complete',
        tool: {
          action: plan.action,
          status: 'failed',
          durationMs,
          summary: `Tool failed: ${truncate(error instanceof Error ? error.message : 'unknown error', 120)}`,
        },
      })
    }

    if (controller.signal.aborted) return

    if (!isGroqConfigured()) {
      send(res, { type: 'token', delta: MISSING_KEY_MESSAGE })
      send(res, { type: 'done' })
      return
    }

    let response
    try {
      response = await openGroqStream({
        messages: buildGroqMessages({ instruction: plan.instruction, history, prompt }),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      console.error('[orchion] Groq request failed:', error)
      send(res, { type: 'token', delta: UNREACHABLE_MESSAGE })
      send(res, { type: 'done' })
      return
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response)
      if (controller.signal.aborted) return
      send(res, { type: 'token', delta: httpErrorMessage(response.status, detail) })
      send(res, { type: 'done' })
      return
    }

    if (!response.body) {
      send(res, { type: 'token', delta: EMPTY_MESSAGE })
      send(res, { type: 'done' })
      return
    }

    let received = false
    try {
      for await (const delta of readGroqTokens(response.body)) {
        received = true
        send(res, { type: 'token', delta })
      }
    } catch (error) {
      if (controller.signal.aborted) return

      const message = error instanceof Error ? error.message : 'unknown error'
      send(res, {
        type: 'token',
        delta: `\n\nStream interrupted: ${message}. The partial reply is kept — send again to retry.`,
      })
      send(res, { type: 'error', message })
      return
    }

    if (!received) {
      send(res, {
        type: 'token',
        delta: 'The model finished without returning visible text. Try rephrasing the request.',
      })
    }

    send(res, { type: 'done' })
  } catch (error) {
    console.error('[orchion] chat stream failed:', error)
    if (!controller.signal.aborted) {
      send(res, { type: 'token', delta: 'The API hit an unexpected error while streaming. Try again.' })
    }
  } finally {
    clearInterval(heartbeat)
    if (!res.writableEnded) res.end()
  }
})

export default router
