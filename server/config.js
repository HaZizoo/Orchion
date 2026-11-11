import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// Load `server/.env` regardless of the directory the process was started from.
dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)), quiet: true })

function readInt(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const configuredSecret = process.env.AUTH_SECRET?.trim()

if (!configuredSecret) {
  console.warn(
    '[orchion] AUTH_SECRET is not set — signing tokens with an ephemeral key. ' +
      'Every API session is invalidated when the server restarts.',
  )
}

export const config = {
  port: readInt('PORT', 8787),
  mongoUri: process.env.MONGODB_URI?.trim() || 'mongodb://127.0.0.1:27017/orchion',
  authSecret: configuredSecret || crypto.randomBytes(32).toString('hex'),
  tokenTtlMs: 30 * 24 * 60 * 60 * 1000,
  groqApiKey: process.env.GROQ_API_KEY?.trim() || '',
  groqModel: process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b',
  maxCompletionTokens: 1200,
  historyTurns: 16,
  historyChars: 6000,
  toolTimeoutMs: readInt('TOOL_TIMEOUT_MS', 5000),
}
