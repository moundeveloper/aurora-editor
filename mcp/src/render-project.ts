import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const projectId=process.argv[2]
if(!projectId)throw new Error('Usage: node mcp/src/render-project.ts <project-id> [draft|preview|full] [width] [height]')
const client=new Client({name:'aurora-render-preview',version:'1.0'})
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:['mcp/src/index.ts'],cwd:process.cwd(),stderr:'inherit'}))
  const result=await client.callTool({name:'aurora_scene_render_preview',arguments:{projectId,...(process.argv[3]?{quality:process.argv[3]}:{}),width:Number(process.argv[4]??960),height:Number(process.argv[5]??540),time:Number(process.argv[6]??0)}},undefined,{timeout:180000})
  for(const content of result.content as Array<{type:string;text?:string}>)if(content.type==='text')console.log(content.text)
  if(result.isError)process.exitCode=1
} finally {await client.close()}
