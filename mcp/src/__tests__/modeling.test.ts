import { selectEdgeLoop } from '../../../shared/edgeLoops'
import { topologyEdgeKey } from '../../../shared/loopCut'
import type { ModelMesh } from '../../../shared/modeling'
import { mkdtemp, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { it, expect } from 'vitest'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createAuroraMcpServer } from '../server'

import { ProjectRepository } from '../../../server/src/projects/ProjectRepository'



it('authors, inspects, publishes and places native source through MCP; rejects stale writers and rolls back batches',async()=>{

  const root=await mkdtemp(join(tmpdir(),'aurora-native-'))

  const {server,projects,layout}=await createAuroraMcpServer(root)

  const client=new Client({name:'native-test',version:'1'})

  const [a,b]=InMemoryTransport.createLinkedPair()

  await server.connect(b); await client.connect(a)

  try {

    const call=async(name:string,args:Record<string,unknown>)=>client.callTool({name,arguments:args})

    await call('aurora_project_create_pillar_run',{projectId:'native-test',name:'Native Test'})

    const created=await call('aurora_model_create',{projectId:'native-test',name:'Pillar'})

    const data=JSON.parse((created.content as Array<{text:string}>)[0]!.text)

    const refs={projectId:'native-test',assetId:data.assetId}

    expect((await call('aurora_model_operations_apply',{...refs,expectedRevision:1,operations:[{type:'extrude',faceId:'f5',distance:3}]})).isError).not.toBe(true)

    expect((await call('aurora_model_operations_apply',{...refs,expectedRevision:2,operations:[{type:'inset',faceId:'f5',fraction:.2},{type:'extrude',faceId:'missing',distance:1}]})).isError).toBe(true)

    const inspected=await call('aurora_model_get',refs)

    expect(JSON.parse((inspected.content as Array<{text:string}>)[0]!.text).revision).toBe(2)

    expect((await call('aurora_model_publish',{...refs,expectedRevision:2})).isError).not.toBe(true)

    expect((await call('aurora_scene_model_add',{...refs,sceneId:'scene-pillar-run',objectId:'native-pillar'})).isError).not.toBe(true)

    const cut=await call('aurora_model_operations_apply',{...refs,expectedRevision:2,operations:[{type:'loop-cut',edge:['v0','v1'],cuts:2,position:.5}]})

    expect(cut.isError).not.toBe(true)

    expect(JSON.parse((cut.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:3,statistics:{boundaryEdges:0}})

    const afterCut=await projects.load('native-test')
    const mesh=(afterCut!.assets.find(a=>a.id===data.assetId)!.nativeModel as {draft:{mesh:ModelMesh}}).draft.mesh
    const positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
    const pairs=mesh.faces.flatMap(f=>f.vertices.map((v,i)=>[v,f.vertices[(i+1)%f.vertices.length]!] as [string,string]))
    const edge=pairs.find(([a,b])=>Math.abs(positions.get(a)![0])<.9 && positions.get(a)![0]===positions.get(b)![0])!
    const slide=await call('aurora_model_operations_apply',{...refs,expectedRevision:3,operations:[{type:'edge-slide',edgeIds:selectEdgeLoop(mesh,topologyEdgeKey(...edge)),factor:.2}]})
    expect(slide.isError).not.toBe(true)
    expect(JSON.parse((slide.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:4,statistics:{boundaryEdges:0}})
    const regionAsset=await call('aurora_model_create',{projectId:'native-test',name:'Region test'})
    const regionId=JSON.parse((regionAsset.content as Array<{text:string}>)[0]!.text).assetId
    const region=await call('aurora_model_operations_apply',{projectId:'native-test',assetId:regionId,expectedRevision:1,operations:[{type:'extrude-region',faceIds:['f1','f5'],distance:.5}]})
    expect(region.isError).not.toBe(true)
    expect(JSON.parse((region.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:2,statistics:{faces:12,boundaryEdges:0}})
    const inset=await call('aurora_model_operations_apply',{projectId:'native-test',assetId:regionId,expectedRevision:2,operations:[{type:'inset-region',faceIds:['f1','f5'],thickness:.1}]})
    expect(inset.isError).not.toBe(true)
    expect(JSON.parse((inset.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:3,statistics:{faces:18,boundaryEdges:0}})
    const knifeAsset=await call('aurora_model_create',{projectId:'native-test',name:'Knife test'})
    const knifeId=JSON.parse((knifeAsset.content as Array<{text:string}>)[0]!.text).assetId
    const knife=await call('aurora_model_operations_apply',{projectId:'native-test',assetId:knifeId,expectedRevision:1,operations:[{type:'knife',faceId:'f5',start:{edge:['v3','v2'],t:.25},end:{edge:['v7','v6'],t:.75}}]})
    expect(knife.isError).not.toBe(true)
    expect(JSON.parse((knife.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:2,statistics:{vertices:10,faces:7,boundaryEdges:0}})
    const deleted=await call('aurora_model_operations_apply',{projectId:'native-test',assetId:knifeId,expectedRevision:2,operations:[{type:'delete',mode:'face',ids:['f5']}]})
    expect(deleted.isError).not.toBe(true)
    expect(JSON.parse((deleted.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:3,statistics:{faces:6}})
    const throughAsset=await call('aurora_model_create',{projectId:'native-test',name:'Through knife test'})
    const throughId=JSON.parse((throughAsset.content as Array<{text:string}>)[0]!.text).assetId
    const through=await call('aurora_model_operations_apply',{projectId:'native-test',assetId:throughId,expectedRevision:1,operations:[{type:'knife',through:true,segments:[
      {faceId:'f5',start:{edge:['v3','v2'],t:.25},end:{edge:['v7','v6'],t:.75}},
      {faceId:'f0',start:{edge:['v3','v2'],t:.25},end:{edge:['v0','v1'],t:.75}},
    ]}]})
    expect(through.isError).not.toBe(true)
    expect(JSON.parse((through.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:2,statistics:{vertices:11,faces:8,boundaryEdges:0}})
    const snapshot=await projects.load('native-test')

    const scene=snapshot!.scenes3D[0] as {objects:Array<{id:string;primitive:string;modelRevision:number}>}

    expect(scene.objects.find(o=>o.id==='native-pillar')).toMatchObject({primitive:'native',modelRevision:2})

    const other=new ProjectRepository(layout)

    const stale=await other.load('native-test')

    snapshot!.project.name='Newer change'; await projects.save(snapshot)

    stale!.project.name='Stale change'

    await expect(other.save(stale)).rejects.toThrow('changed in another session')

    expect((await projects.load('native-test'))!.project.name).toBe('Newer change')

  } finally { await client.close(); await server.close(); await rm(root,{recursive:true,force:true}) }

})

