import { runStdioServer } from './server.ts'

runStdioServer().catch((error: unknown) => {
  console.error('[aurora-mcp]', error)
  process.exitCode = 1
})
