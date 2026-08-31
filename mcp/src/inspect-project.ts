import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const projectId = process.argv[2]
if (!projectId) throw new Error('Usage: pnpm mcp:inspect-project <project-id>')

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['mcp/src/index.ts'],
  cwd: process.cwd(),
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
})
const client = new Client({ name: 'aurora-project-inspector', version: '0.1.0' })

try {
  await client.connect(transport)
  const result = await client.callTool({ name: 'aurora_project_get', arguments: { projectId } })
  if (result.isError) throw new Error(JSON.stringify(result.content))
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  const text = content.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('MCP tool returned no project')
  const project = JSON.parse(text) as {
    project: { id: string; name: string; duration: number }
    layers: unknown[]
    scenes3D: Array<{ objects: unknown[] }>
    nodes: unknown[]
  }
  process.stdout.write(`${JSON.stringify({
    project: project.project,
    layers: project.layers.length,
    scenes3D: project.scenes3D.length,
    objects3D: project.scenes3D.reduce((total, scene) => total + scene.objects.length, 0),
    nodes: project.nodes.length,
  }, null, 2)}\n`)
} finally {
  await client.close()
}
