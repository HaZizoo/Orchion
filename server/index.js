import express from 'express'
import mongoose from 'mongoose'
import { config } from './config.js'
import { connectDatabase, disconnectDatabase } from './db.js'
import authRoutes from './routes/auth.js'
import chatRoutes from './routes/chat.js'
import sessionRoutes from './routes/sessions.js'

const app = express()
app.disable('x-powered-by')

app.use(express.json({ limit: '1mb' }))
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    groq: config.groqApiKey.length > 0 ? 'configured' : 'missing_key',
    model: config.groqModel,
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/sessions', sessionRoutes)
app.use('/api', chatRoutes)

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'No such API route.' })
})

app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error?.status) ? error.status : 500

  if (status >= 500) console.error('[orchion] request failed:', error)
  if (res.headersSent) return

  res.status(status).json({
    error: status >= 500 ? 'server_error' : 'request_error',
    message: status >= 500 ? 'The API hit an unexpected error.' : (error?.message ?? 'Bad request.'),
  })
})

async function start() {
  try {
    await connectDatabase(config.mongoUri)
  } catch (error) {
    console.error(`[orchion] MongoDB is unreachable at ${config.mongoUri}`)
    console.error(`[orchion] ${error instanceof Error ? error.message : error}`)
    console.error('[orchion] Start one with:')
    console.error('  docker run -d --name orchion-mongo -p 27017:27017 mongo:7')
    console.error('…or set MONGODB_URI in server/.env to your Atlas connection string.')
    process.exit(1)
  }

  const server = app.listen(config.port, () => {
    console.log(`[orchion] API listening on http://localhost:${config.port}`)
    console.log(`[orchion] Groq key: ${config.groqApiKey.length > 0 ? 'configured' : 'MISSING (chat tools still run)'}`)
  })

  function shutdown() {
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0))
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void start()
