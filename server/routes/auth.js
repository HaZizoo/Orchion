import crypto from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import { hashPassword, verifyPassword } from '../auth/passwords.js'
import { signToken } from '../auth/tokens.js'
import { config } from '../config.js'
import { Session } from '../models/Session.js'
import { User } from '../models/User.js'
import { serializeUser } from '../serializers.js'

const router = Router()
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function issueToken(user) {
  return signToken(user._id, { secret: config.authSecret, ttlMs: config.tokenTtlMs })
}

function readCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  return { email, password, name }
}

/**
 * Guest sign-in keeps the demo usable without a login screen while still
 * scoping every document to a real user id (and therefore isolating accounts).
 */
router.post('/guest', async (_req, res) => {
  const user = await User.create({
    name: `Guest ${crypto.randomBytes(2).toString('hex')}`,
    kind: 'guest',
  })

  res.status(201).json({ token: issueToken(user), user: serializeUser(user) })
})

router.post('/register', async (req, res) => {
  const { email, password, name } = readCredentials(req.body)

  if (!EMAIL_PATTERN.test(email)) {
    res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' })
    return
  }
  if (password.length < 8 || password.length > 200) {
    res.status(400).json({ error: 'invalid_password', message: 'Passwords need at least 8 characters.' })
    return
  }

  const existing = await User.findOne({ email })
  if (existing) {
    res.status(409).json({ error: 'email_taken', message: 'That email already has an account.' })
    return
  }

  const user = await User.create({
    name: name || email.split('@')[0],
    email,
    passwordHash: hashPassword(password),
    kind: 'account',
  })

  res.status(201).json({ token: issueToken(user), user: serializeUser(user) })
})

router.post('/login', async (req, res) => {
  const { email, password } = readCredentials(req.body)

  const user = await User.findOne({ email })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' })
    return
  }

  res.json({ token: issueToken(user), user: serializeUser(user) })
})

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId)
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'This account no longer exists.' })
    return
  }

  res.json({ user: serializeUser(user) })
})

router.patch('/me', requireAuth, async (req, res) => {
  const activeSessionId = req.body?.activeSessionId

  if (activeSessionId !== null && typeof activeSessionId !== 'string') {
    res.status(400).json({ error: 'invalid_session', message: 'activeSessionId must be a string or null.' })
    return
  }

  if (activeSessionId) {
    const owned = await Session.exists({ userId: req.userId, sessionId: activeSessionId })
    if (!owned) {
      res.status(404).json({ error: 'not_found', message: 'That thread does not belong to this account.' })
      return
    }
  }

  const user = await User.findByIdAndUpdate(
    req.userId,
    { activeSessionId: activeSessionId ?? null },
    { new: true },
  )

  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'This account no longer exists.' })
    return
  }

  res.json({ user: serializeUser(user) })
})

export default router
