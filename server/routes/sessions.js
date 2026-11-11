import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import { HttpError, parseSessionSnapshot } from '../lib/validate.js'
import { Message } from '../models/Message.js'
import { Session } from '../models/Session.js'
import { User } from '../models/User.js'
import { serializeSession } from '../serializers.js'

const router = Router()
router.use(requireAuth)

async function findOwned(userId, sessionId, { lean = false } = {}) {
  const query = Session.findOne({ userId, sessionId })
  const session = lean ? await query.lean() : await query
  if (!session) throw new HttpError(404, 'That thread does not exist.')
  return session
}

async function syncMessages(userId, sessionId, messages) {
  if (messages.length > 0) {
    await Message.bulkWrite(
      messages.map((message) => ({
        updateOne: {
          filter: { userId, sessionId, messageId: message.messageId },
          update: {
            $set: {
              userId,
              sessionId,
              role: message.role,
              content: message.content,
              timestamp: message.timestamp,
              status: message.status,
              order: message.order,
              ...(message.tool ? { tool: message.tool } : {}),
            },
            ...(message.tool ? {} : { $unset: { tool: '' } }),
          },
          upsert: true,
        },
      })),
    )
  }

  await Message.deleteMany({
    userId,
    sessionId,
    ...(messages.length > 0 ? { messageId: { $nin: messages.map((message) => message.messageId) } } : {}),
  })
}

router.get('/', async (req, res) => {
  const sessions = await Session.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean()
  const sessionIds = sessions.map((session) => session.sessionId)

  const messages =
    sessionIds.length > 0
      ? await Message.find({ userId: req.userId, sessionId: { $in: sessionIds } })
          .sort({ sessionId: 1, order: 1 })
          .lean()
      : []

  const grouped = new Map()
  for (const message of messages) {
    const bucket = grouped.get(message.sessionId)
    if (bucket) bucket.push(message)
    else grouped.set(message.sessionId, [message])
  }

  const user = await User.findById(req.userId).select('activeSessionId').lean()
  const storedActive = user?.activeSessionId
  const activeSessionId = sessionIds.some((id) => id === storedActive) ? storedActive : sessionIds[0] ?? null

  res.json({
    sessions: sessions.map((session) => serializeSession(session, grouped.get(session.sessionId) ?? [])),
    activeSessionId,
  })
})

router.post('/', async (req, res) => {
  const snapshot = parseSessionSnapshot(req.body)
  const requestedId = typeof req.body?.id === 'string' ? req.body.id.trim().slice(0, 160) : ''
  const sessionId = requestedId || randomUUID()

  // Idempotent create: StrictMode (and a retried request) can post a seed twice.
  const existing = await Session.findOne({ userId: req.userId, sessionId })
  if (existing) {
    const stored = await Message.find({ userId: req.userId, sessionId }).sort({ order: 1 }).lean()
    res.json({ session: serializeSession(existing.toObject(), stored) })
    return
  }

  let session
  try {
    session = await Session.create({
      userId: req.userId,
      sessionId,
      title: snapshot.title,
      model: snapshot.model,
      displayUpdatedAt: snapshot.displayUpdatedAt,
      artifacts: snapshot.artifacts,
    })
  } catch (error) {
    // Two concurrent creates can both pass the check; the unique index wins.
    if (error?.code === 11000) {
      const raced = await Session.findOne({ userId: req.userId, sessionId })
      if (raced) {
        const stored = await Message.find({ userId: req.userId, sessionId }).sort({ order: 1 }).lean()
        res.json({ session: serializeSession(raced.toObject(), stored) })
        return
      }
    }
    throw error
  }

  await syncMessages(req.userId, sessionId, snapshot.messages)
  await User.findByIdAndUpdate(req.userId, { activeSessionId: sessionId })

  res.status(201).json({ session: serializeSession(session.toObject(), snapshot.messages) })
})

router.get('/:id', async (req, res) => {
  const session = await findOwned(req.userId, req.params.id, { lean: true })
  const messages = await Message.find({ userId: req.userId, sessionId: req.params.id })
    .sort({ order: 1 })
    .lean()

  res.json({ session: serializeSession(session, messages) })
})

router.patch('/:id', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  if (!title || title.length > 200) throw new HttpError(400, 'title must be 1–200 characters.')

  const session = await findOwned(req.userId, req.params.id)
  session.title = title
  await session.save()

  res.json({ session: serializeSession(session.toObject(), []) })
})

/** Full snapshot sync: upserts messages by id and removes deleted ones. */
router.put('/:id', async (req, res) => {
  const snapshot = parseSessionSnapshot(req.body)
  const session = await findOwned(req.userId, req.params.id)

  session.title = snapshot.title
  session.model = snapshot.model
  session.displayUpdatedAt = snapshot.displayUpdatedAt
  session.artifacts = snapshot.artifacts
  await session.save()

  await syncMessages(req.userId, session.sessionId, snapshot.messages)

  res.json({ session: serializeSession(session.toObject(), snapshot.messages) })
})

router.post('/:id/messages', async (req, res) => {
  const session = await findOwned(req.userId, req.params.id)
  const raw = req.body
  if (!raw || typeof raw.id !== 'string' || raw.id.trim().length === 0) {
    throw new HttpError(400, 'A message id is required.')
  }

  const count = await Message.countDocuments({ userId: req.userId, sessionId: session.sessionId })
  const message = await Message.create({
    userId: req.userId,
    sessionId: session.sessionId,
    messageId: raw.id.trim().slice(0, 160),
    role: raw.role === 'user' ? 'user' : 'agent',
    content: typeof raw.content === 'string' ? raw.content.slice(0, 40000) : '',
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp.slice(0, 40) : '',
    status: ['streaming', 'complete', 'stopped', 'error'].includes(raw.status) ? raw.status : 'complete',
    order: count,
  })

  res.status(201).json({ message: serializeSession(session.toObject(), [message]).messages[0] })
})

router.delete('/:id/messages/:messageId', async (req, res) => {
  await findOwned(req.userId, req.params.id)
  const result = await Message.deleteOne({
    userId: req.userId,
    sessionId: req.params.id,
    messageId: req.params.messageId,
  })

  if (result.deletedCount === 0) throw new HttpError(404, 'That message does not exist.')
  res.status(204).end()
})

router.delete('/:id', async (req, res) => {
  const session = await findOwned(req.userId, req.params.id)

  await Message.deleteMany({ userId: req.userId, sessionId: session.sessionId })
  await session.deleteOne()

  const user = await User.findById(req.userId).select('activeSessionId').lean()
  if (user?.activeSessionId === session.sessionId) {
    const next = await Session.findOne({ userId: req.userId }).sort({ updatedAt: -1 }).select('sessionId').lean()
    await User.findByIdAndUpdate(req.userId, { activeSessionId: next?.sessionId ?? null })
  }

  res.status(204).end()
})

/** Reset helper: wipe every thread for the caller. */
router.delete('/', async (req, res) => {
  await Message.deleteMany({ userId: req.userId })
  await Session.deleteMany({ userId: req.userId })
  await User.findByIdAndUpdate(req.userId, { activeSessionId: null })
  res.status(204).end()
})

export default router
