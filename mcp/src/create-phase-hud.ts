import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const client=new Client({name:'phase-hud-author',version:'1.0'})
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:['mcp/src/index.ts'],cwd:process.cwd(),stderr:'inherit'}))
  const result=await client.callTool({name:'aurora_project_create_phase_hud',arguments:{name:process.argv[2]??'PHASE / Animated HUD'}})
  for(const c of result.content as Array<{type:string;text?:string}>)if(c.type==='text')console.log(c.text)
  if(result.isError)process.exitCode=1
}finally{await client.close()}
