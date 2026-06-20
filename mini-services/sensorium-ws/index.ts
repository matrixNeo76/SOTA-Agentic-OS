/**
 * Sensorium WebSocket Service
 *
 * Mini-service indipendente (porta 3003) che fa da event-bus real-time
 * tra il backend Next.js (publisher) e i client browser (subscriber).
 *
 * Architettura:
 *  - Socket.io sulla porta 3003 per il broadcast ai browser
 *  - HTTP endpoint interno sulla porta 3004 per /publish (chiamato da Next.js)
 *
 * Canali:
 *  - sensorium   : broadcast del blocco Sensorium XML + dati
 *  - agent_event : eventi del kernel (PatchBoard tx, steering, verify, reflect)
 *  - state_diff  : patch applicate allo stato globale
 */
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server, Socket } from 'socket.io'

const WS_PORT = 3003
const HTTP_PORT = 3004

// ===== Socket.io server (per browser) =====
const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket: Socket) => {
  console.log(`[ws] client connected: ${socket.id} (total: ${io.engine.clientsCount})`)

  socket.on('subscribe', (channels: string[]) => {
    if (Array.isArray(channels)) {
      channels.forEach((c) => {
        if (typeof c === 'string' && ['sensorium', 'agent_event', 'state_diff'].includes(c)) {
          socket.join(c)
        }
      })
      socket.emit('subscribed', { channels, sid: socket.id })
    }
  })

  socket.on('disconnect', () => {
    console.log(`[ws] client disconnected: ${socket.id} (total: ${io.engine.clientsCount})`)
  })

  socket.on('error', (err: any) => {
    console.error(`[ws] socket error ${socket.id}:`, err)
  })
})

// ===== HTTP publish server (per Next.js API routes) =====
const publishServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'POST' && req.url === '/publish') {
    let body = ''
    req.on('data', (chunk) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const { channel, payload } = JSON.parse(body)
        if (channel && payload) {
          io.emit(channel, payload)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, channel, subscribers: io.engine.clientsCount }))
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'channel e payload obbligatori' }))
        }
      } catch (e: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      wsClients: io.engine.clientsCount,
      uptime: process.uptime(),
    }))
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
})

httpServer.listen(WS_PORT, () => {
  console.log(`[sensorium-ws] Socket.io broadcast on port ${WS_PORT}`)
})

publishServer.listen(HTTP_PORT, () => {
  console.log(`[sensorium-ws] HTTP publish endpoint on port ${HTTP_PORT}`)
})

process.on('SIGTERM', () => {
  console.log('[sensorium-ws] SIGTERM, shutting down...')
  io.close()
  httpServer.close()
  publishServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('[sensorium-ws] SIGINT, shutting down...')
  io.close()
  httpServer.close()
  publishServer.close(() => process.exit(0))
})
