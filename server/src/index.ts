import { serve } from '@hono/node-server'
import { createServer } from './app.ts'

const port = Number(process.env.AURORA_PORT ?? 5174)

const { app, layout, close } = await createServer()

const server = serve({
  fetch: app.fetch,
  port,
  // Loopback only. This process hands out file contents and accepts uploads; it has no business
  // being reachable from the network, and binding explicitly means it never is by accident.
  hostname: '127.0.0.1',
}, (info) => {
  console.log(`aurora server  →  http://127.0.0.1:${info.port}`)
  console.log(`vault          →  ${layout.root}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      close()
      process.exit(0)
    })
  })
}
