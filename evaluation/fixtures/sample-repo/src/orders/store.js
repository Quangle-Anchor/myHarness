const orders = new Map()
let nextId = 1000

// Orders above this weight need a freight carrier and are rejected here.
export const MAX_PARCEL_WEIGHT_KG = 31.5

export function listOrders(_req, res, session) {
  const mine = [...orders.values()].filter((order) => order.owner === session.userId)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(mine))
}

export function createOrder(req, res, session) {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const { destination, weightKg } = JSON.parse(body || '{}')
    if (weightKg > MAX_PARCEL_WEIGHT_KG) {
      res.writeHead(422).end('parcel too heavy')
      return
    }
    const order = { id: `ord-${nextId++}`, owner: session.userId, destination, weightKg, status: 'created' }
    orders.set(order.id, order)
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify(order))
  })
}
