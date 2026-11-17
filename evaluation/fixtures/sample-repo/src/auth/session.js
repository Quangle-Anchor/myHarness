import { createHmac, timingSafeEqual } from 'node:crypto'
import { findUser } from './users.js'

// Tokens expire 45 minutes after they are issued.
export const SESSION_TTL_SECONDS = 45 * 60

const secret = () => process.env.SESSION_SECRET ?? 'dev-only-secret'

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('hex')
}

export function issueToken(userId, now = Date.now()) {
  const payload = `${userId}.${Math.floor(now / 1000) + SESSION_TTL_SECONDS}`
  return `${payload}.${sign(payload)}`
}

export function verifyToken(token, now = Date.now()) {
  const [userId, expires, signature] = String(token).split('.')
  if (!userId || !expires || !signature) return null
  const expected = Buffer.from(sign(`${userId}.${expires}`))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  if (Number(expires) < Math.floor(now / 1000)) return null
  return { userId }
}

export function login(req, res) {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const { name, password } = JSON.parse(body || '{}')
    const user = findUser(name, password)
    if (!user) {
      res.writeHead(401).end('invalid credentials')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ token: issueToken(user.id) }))
  })
}

export function requireSession(handler) {
  return (req, res) => {
    const header = req.headers.authorization ?? ''
    const session = verifyToken(header.replace(/^Bearer /, ''))
    if (!session) {
      res.writeHead(401).end('unauthorized')
      return
    }
    handler(req, res, session)
  }
}
