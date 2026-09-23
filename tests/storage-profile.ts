// Read the saved scene through MCP; all save/reload measurements use a temporary vault.
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {mkdtemp,rm,readdir,stat,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
import {ProjectRepository,projectETag} from '../server/src/projects/ProjectRepository.ts'
import {ensureVault,vaultLayout} from '../server/src/storage/paths.ts'
import {serializedProjectSchema} from '../shared/contracts.ts'
const client=new Client({name:'storage-profile',version:'1.0'}),root=await mkdtemp(join(tmpdir(),'aurora-storage-profile-'))
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:['mcp/src/index.ts'],cwd:process.cwd(),stderr:'inherit',maxBufferSize:128*1024*1024}))
  const result=await client.callTool({name:'aurora_project_get',arguments:{projectId:process.argv[2]??'31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f'}})
  if(result.isError)throw new Error(JSON.stringify(result.content))
  const content=result.content as Array<{type:string;text?:string}>
  const snapshot=serializedProjectSchema.parse(JSON.parse(content.find(c=>c.type==='text')!.text!))
  const layout=await ensureVault(vaultLayout(root)),repository=new ProjectRepository(layout)
  const start=performance.now();await repository.save(snapshot,'new');const saveMs=performance.now()-start
  const reload=performance.now(),restored=await repository.load(snapshot.project.id),loadMs=performance.now()-reload
  assert.equal(projectETag(restored),projectETag(snapshot))
  const listing=performance.now();assert.equal((await repository.list()).length,1);const listMs=performance.now()-listing
  const blobs=await readdir(join(layout.projects,'.geometry'))
  const blobBytes=(await Promise.all(blobs.map(async name=>(await stat(join(layout.projects,'.geometry',name))).size))).reduce((a,b)=>a+b,0)
  const manifestBytes=(await stat(join(layout.projects,`${snapshot.project.id}.aurora.json`))).size
  const report={legacyCompactJsonBytes:Buffer.byteLength(JSON.stringify(snapshot)),manifestBytes,blobBytes,totalBytes:manifestBytes+blobBytes,blobs:blobs.length,saveMs,loadMs,listMs,logicalETagPreserved:true}
  await mkdir('artifacts/engine-final',{recursive:true});await writeFile('artifacts/engine-final/storage.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
} finally {await client.close();await rm(root,{recursive:true,force:true})}
