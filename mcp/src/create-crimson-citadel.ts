import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client({ name: 'crimson-citadel-author', version: '1.0.0' })
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp/src/index.ts'], cwd: process.cwd(), stderr: 'inherit' }))
  const result = await client.callTool({ name: 'aurora_project_create_crimson_citadel', arguments: { name: 'Crimson Citadel | The White Gardens', ...(process.argv[2]?{projectId:process.argv[2]}:{}) } })
  if(result.isError)throw new Error(JSON.stringify(result.content))
  for(const c of result.content as Array<{type:string;text?:string}>)if(c.type==='text')console.log(c.text)
} finally { await client.close() }
