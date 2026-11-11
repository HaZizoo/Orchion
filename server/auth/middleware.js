import { config } from '../config.js'
import { verifyToken } from './tokens.js'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  const token =
    typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''

  const userId = token ? verifyToken(token, config.authSecret) : null

  if (!userId) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'The API token is missing or expired. Reload the app to get a new session.',
    })
    return
  }

  req.userId = userId
  next()
}
