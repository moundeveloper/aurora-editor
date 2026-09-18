import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect } from 'vitest'
import { createServer } from '../app.ts'
import { createPillarRunProject } from '../../../mcp/src/showcase.ts'
import { serializedProjectSchema } from '../../../shared/contracts.ts'

it('allows only one HTTP writer to commit against the same project version',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aurora-cas-')), server=await createServer(root)
  try {
    await server.projects.save(createPillarRunProject('Concurrency','concurrency'))
    const response=await server.app.request('/api/projects/concurrency')
    const version=response.headers.get('ETag')!, snapshot=serializedProjectSchema.parse(await response.json())
    const save=(name:string)=>server.app.request('/api/projects/concurrency',{
      method:'PUT',headers:{'Content-Type':'application/json','If-Match':version},
      body:JSON.stringify({...snapshot,project:{...snapshot.project,name}}),
    })
    const responses=await Promise.all([save('First'),save('Second')])
    expect(responses.map(r=>r.status).sort()).toEqual([200,409])
    const winner=responses.find(r=>r.status===200)!
    expect(winner.headers.get('ETag')).not.toBe(version)
    const saved=serializedProjectSchema.parse(await winner.json())
    expect((await server.projects.load('concurrency'))!.project.name).toBe(saved.project.name)
  } finally {server.close(); await rm(root,{recursive:true,force:true})}
})
