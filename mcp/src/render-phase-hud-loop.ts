import { mkdir,writeFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const client=new Client({name:'hud-loop-preview',version:'1'})
const projectId=process.argv[2]
if(!projectId)throw new Error('Supply a saved project id')
await mkdir('artifacts/phase-hud/frames',{recursive:true})
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:['mcp/src/index.ts'],cwd:process.cwd(),stderr:'inherit'}))
  for(let i=0;i<36;i++){
    const result=await client.callTool({name:'aurora_scene_render_preview',arguments:{projectId,width:360,height:500,time:i/3,quality:'full',benchmarkFrames:1}},undefined,{timeout:180000})
    if(result.isError)throw new Error(JSON.stringify(result.content))
    const img=(result.content as Array<{type:string;data?:string}>).find(c=>c.type==='image')
    if(!img?.data)throw new Error('Missing frame')
    await writeFile(`artifacts/phase-hud/frames/${String(i).padStart(3,'0')}.png`,Buffer.from(img.data,'base64'))
    if(i%6===0)console.log(`Rendered ${i+1}/36 preview frames`)
  }
}finally{await client.close()}
