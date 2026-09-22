import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const [projectId,sceneId,settingsFile]=process.argv.slice(2)
if(!projectId||!sceneId||!settingsFile)throw new Error('Usage: node mcp/src/set-scene-look.ts <project-id> <scene-id> <settings.json>')
const settings=JSON.parse(await readFile(settingsFile,'utf8'))
const client=new Client({name:'aurora-scene-look',version:'1.0'})
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:['mcp/src/index.ts'],cwd:process.cwd(),stderr:'inherit'}))
  const result=await client.callTool({name:'aurora_scene_look_set',arguments:{projectId,sceneId,settings}})
  for(const content of result.content as Array<{type:string;text?:string}>)if(content.type==='text')console.log(content.text)
  if(result.isError)process.exitCode=1
} finally {await client.close()}
