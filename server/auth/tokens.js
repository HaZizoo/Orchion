import crypto from 'node:crypto'

function signBody(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url')
}

export function signToken(userId, { secret, ttlMs }) {
  const payload = { sub: String(userId), iat: Date.now(), exp: Date.now() + ttlMs }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${signBody(body, secret)}`
}

/** Returns the user id for a valid, unexpired token, otherwise `null`. */
export function verifyToken(token, secret) {
  if (typeof token !== 'string') return null

  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const body = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!signature) return null

  const expected = Buffer.from(signBody(body, secret))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload.sub
  } catch {
    return null
  }
}
