import crypto from 'node:crypto'

const KEY_LENGTH = 64

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false

  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false

  const expected = Buffer.from(hash, 'base64url')
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), expected.length)

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}
