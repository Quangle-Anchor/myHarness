import { createServer } from 'node:http'
import { login, requireSession } from './auth/session.js'
import { listOrders, createOrder } from './orders/store.js'

const PORT = Number(process.env.PORT ?? 4317)

const routes = {
  'POST /login': login,
  'GET /orders': requireSession(listOrders),
  'POST /orders': requireSession(createOrder),
}

createServer((req, res) => {
  const handler = routes[`${req.method} ${req.url.split('?')[0]}`]
  if (!handler) {
    res.writeHead(404).end('not found')
    return
  }
  handler(req, res)
}).listen(PORT)
