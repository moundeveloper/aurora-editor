import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const name = process.argv.slice(2).join(' ').trim() || 'Pillar Run // Drone-07'
const projectId = process.env.AURORA_DRONE_PROJECT_ID
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['mcp/src/index.ts'],
  cwd: process.cwd(),
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
})
const client = new Client({ name: 'aurora-drone-author', version: '0.1.0' })

try {
  await client.connect(transport)
  const tools = await client.listTools()
  if (!tools.tools.some((tool) => tool.name === 'aurora_project_create_pillar_run')) {
    throw new Error('Aurora pillar-run authoring tool was not advertised by the MCP server')
  }
  const result = await client.callTool({
    name: 'aurora_project_create_pillar_run',
    arguments: { name, ...(projectId ? { projectId } : {}) },
  })
  if (result.isError) throw new Error(JSON.stringify(result.content))
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  const text = content.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('MCP tool returned no project summary')
  process.stdout.write(`${text}\n`)
} finally {
  await client.close()
}
