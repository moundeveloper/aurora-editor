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
    const selectionQuery=await call('aurora_model_selection_query',{...refs,expectedRevision:1,selection:{mode:'face',action:'path',ids:['f0','f1']}})
    expect(selectionQuery.isError).not.toBe(true)
    expect(JSON.parse((selectionQuery.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:1,mode:'face',ids:expect.arrayContaining(['f0','f1'])})
    expect(JSON.parse((selectionQuery.content as Array<{text:string}>)[0]!.text).ids).toHaveLength(3)
    const similar=await call('aurora_model_selection_query',{...refs,expectedRevision:1,selection:{mode:'face',action:'similar',ids:['f0'],property:'area',tolerance:0}})
    expect(similar.isError).not.toBe(true)
    expect(JSON.parse((similar.content as Array<{text:string}>)[0]!.text).ids).toHaveLength(6)
    const trait=await call('aurora_model_selection_query',{...refs,expectedRevision:1,selection:{mode:'vertex',action:'trait',ids:[],trait:'poles'}})
    expect(trait.isError).not.toBe(true)
    expect(JSON.parse((trait.content as Array<{text:string}>)[0]!.text).ids).toHaveLength(8)
    const badSimilar=await call('aurora_model_selection_query',{...refs,expectedRevision:1,selection:{mode:'face',action:'similar',ids:['f0'],property:'length'}})
    expect(badSimilar.isError).toBe(true)
    const staleSelection=await call('aurora_model_selection_query',{...refs,expectedRevision:2,selection:{mode:'face',action:'linked',ids:['f0']}})
    expect(staleSelection.isError).toBe(true)
    const selectionSource=await call('aurora_model_get',refs)
    expect(JSON.parse((selectionSource.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:1,statistics:{faces:6,vertices:8}})
    const shapeAsset=await call('aurora_model_create',{projectId:'native-test',name:'Shape tools',primitive:'plane'})
    const shapeRefs={projectId:'native-test',assetId:JSON.parse((shapeAsset.content as Array<{text:string}>)[0]!.text).assetId}
    const shaped=await call('aurora_model_operations_apply',{...shapeRefs,expectedRevision:1,operations:[{type:'set-positions',vertices:[{id:'v0',position:[-1,.4,-1]}]},{type:'flatten',vertexIds:['v0','v1','v2','v3'],plane:'y'},{type:'shrink-fatten',vertexIds:['v0','v1','v2','v3'],distance:.2},{type:'push-pull',vertexIds:['v0','v1','v2','v3'],distance:.1}]})
    expect(shaped.isError).not.toBe(true)
    expect(JSON.parse((shaped.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:5,statistics:{vertices:4,faces:1}})
    const invalidShape=await call('aurora_model_operations_apply',{...shapeRefs,expectedRevision:5,operations:[{type:'color',color:'#123456'},{type:'push-pull',vertexIds:['v0','v1','v2','v3'],distance:-100}]})
    expect(invalidShape.isError).toBe(true)
    const shapeRead=await call('aurora_model_get',shapeRefs)
    expect(JSON.parse((shapeRead.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:5,color:'#9aa8bd'})
    const setAsset=await call('aurora_model_create',{projectId:'native-test',name:'Selection sets'})
    const setRefs={projectId:'native-test',assetId:JSON.parse((setAsset.content as Array<{text:string}>)[0]!.text).assetId}
    const setSave=await call('aurora_model_operations_apply',{...setRefs,expectedRevision:1,operations:[{type:'selection-set-save',name:'Top',mode:'face',ids:['f5','f0']}]})
    expect(setSave.isError).not.toBe(true)
    const setRead=await call('aurora_model_get',{...setRefs,selectionSet:'Top',offset:1,limit:1})
    expect(JSON.parse((setRead.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:2,selectionSets:[{name:'Top',mode:'face',count:2}],selectionSet:{name:'Top',mode:'face',count:2,ids:['f0']}})
    const checkers=await call('aurora_model_selection_query',{...setRefs,expectedRevision:2,selection:{mode:'vertex',action:'checker',ids:['v0','v1','v2','v3'],keep:1,skip:1,offset:0}})
    expect(checkers.isError).not.toBe(true)
    expect(JSON.parse((checkers.content as Array<{text:string}>)[0]!.text).ids).toEqual(['v0','v2'])
    const setRollback=await call('aurora_model_operations_apply',{...setRefs,expectedRevision:2,operations:[{type:'selection-set-delete',name:'Top'},{type:'selection-set-delete',name:'missing'}]})
    expect(setRollback.isError).toBe(true)
    const afterSetFailure=await call('aurora_model_get',{...setRefs,selectionSet:'Top'})
    expect(JSON.parse((afterSetFailure.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:2,selectionSet:{ids:['f5','f0']}})
    const subdivisionAsset=await call('aurora_model_create',{projectId:'native-test',name:'Subdivision test',primitive:'plane'})
    const subdivisionRefs={projectId:'native-test',assetId:JSON.parse((subdivisionAsset.content as Array<{text:string}>)[0]!.text).assetId}
    const subdivided=await call('aurora_model_operations_apply',{...subdivisionRefs,expectedRevision:1,operations:[{type:'subdivide',mode:'face',ids:['f0']}]})
    expect(subdivided.isError).not.toBe(true)
    const subdividedData=JSON.parse((subdivided.content as Array<{text:string}>)[0]!.text)
    expect(subdividedData).toMatchObject({revision:2,statistics:{faces:4,vertices:9}})
    expect(subdividedData.changes[0].selection.face).toHaveLength(4)
    const coarsened=await call('aurora_model_operations_apply',{...subdivisionRefs,expectedRevision:2,operations:[{type:'unsubdivide',faceIds:subdividedData.changes[0].selection.face}]})
    expect(coarsened.isError).not.toBe(true)
    expect(JSON.parse((coarsened.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:3,statistics:{faces:1,vertices:4}})
    const connected=await call('aurora_model_operations_apply',{...subdivisionRefs,expectedRevision:3,operations:[{type:'connect-path',vertexIds:['v0','v2']}]})
    expect(connected.isError).not.toBe(true)
    expect(JSON.parse((connected.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:4,statistics:{faces:2},changes:[{selection:{edge:[topologyEdgeKey('v0','v2')]}}]})
    const failedPath=await call('aurora_model_operations_apply',{...subdivisionRefs,expectedRevision:4,operations:[{type:'color',color:'#123456'},{type:'connect-path',vertexIds:['v0','missing']}]})
    expect(failedPath.isError).toBe(true)
    const pathAfterFailure=await call('aurora_model_get',subdivisionRefs)
    expect(JSON.parse((pathAfterFailure.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:4,color:'#9aa8bd'})
    const rotated=await call('aurora_model_operations_apply',{...subdivisionRefs,expectedRevision:4,operations:[{type:'rotate-edge',edgeIds:[topologyEdgeKey('v0','v2')]}]})
    expect(rotated.isError).not.toBe(true)
    expect(JSON.parse((rotated.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:5,changes:[{selection:{edge:[topologyEdgeKey('v1','v3')]}}]})
    const edgeAsset=await call('aurora_model_create',{projectId:'native-test',name:'Edge construction test'})
    const edgeRefs={projectId:'native-test',assetId:JSON.parse((edgeAsset.content as Array<{text:string}>)[0]!.text).assetId}
    const detached=await call('aurora_model_operations_apply',{...edgeRefs,expectedRevision:1,operations:[{type:'split',faceIds:['f5']},{type:'rip',faceIds:['f1'],offset:[0,0,1]},{type:'poke',faceIds:['f5']}]})
    expect(detached.isError).not.toBe(true)
    expect(JSON.parse((detached.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:4,statistics:{faces:9},changes:[{selection:{face:['f5']}},{selection:{face:['f1']}},{selection:{face:expect.arrayContaining(['f5'])}}]})
    const failedDetach=await call('aurora_model_operations_apply',{...edgeRefs,expectedRevision:4,operations:[{type:'color',color:'#123456'},{type:'split',faceIds:['missing']}]})
    expect(failedDetach.isError).toBe(true)
    const detachReload=await call('aurora_model_get',edgeRefs)
    expect(JSON.parse((detachReload.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:4,color:'#9aa8bd'})
    const constructionAsset=await call('aurora_model_create',{projectId:'native-test',name:'Construction test'})
    const constructionRefs={projectId:'native-test',assetId:JSON.parse((constructionAsset.content as Array<{text:string}>)[0]!.text).assetId}
    const beveled=await call('aurora_model_operations_apply',{...constructionRefs,expectedRevision:1,operations:[{type:'bevel',mode:'edge',ids:[topologyEdgeKey('v0','v1')],width:.2,segments:3}]})
    expect(beveled.isError).not.toBe(true)
    expect(JSON.parse((beveled.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:2,statistics:{faces:9,boundaryEdges:0}})
    const bridgeAsset=await call('aurora_model_create',{projectId:'native-test',name:'Bridge test'})
    const bridgeRefs={projectId:'native-test',assetId:JSON.parse((bridgeAsset.content as Array<{text:string}>)[0]!.text).assetId}
    const bridgeEdges=[['v0','v3','v2','v1'],['v4','v5','v6','v7']].flatMap(ring=>ring.map((id,i)=>topologyEdgeKey(id,ring[(i+1)%4]!)))
    const bridged=await call('aurora_model_operations_apply',{...bridgeRefs,expectedRevision:1,operations:[{type:'delete',mode:'face',ids:['f2','f3','f4','f5']},{type:'bridge',edgeIds:bridgeEdges,cuts:2}]})
    expect(bridged.isError).not.toBe(true)
    expect(JSON.parse((bridged.content as Array<{text:string}>)[0]!.text)).toMatchObject({revision:3,statistics:{faces:14,boundaryEdges:0}})
    const rejectedBevel=await call('aurora_model_operations_apply',{...constructionRefs,expectedRevision:2,operations:[{type:'color',color:'#123456'},{type:'bevel',mode:'edge',ids:['missing'],width:.2}]})
    expect(rejectedBevel.isError).toBe(true)
    const constructionAfterFailure=await call('aurora_model_get',constructionRefs)
    expect(JSON.parse((constructionAfterFailure.content as Array<{text:string}>)[0]!.text).revision).toBe(2)

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
    const repaired=await call('aurora_model_operations_apply',{projectId:'native-test',assetId:knifeId,expectedRevision:3,operations:[{type:'fill-holes',style:'polygon'}]})
    expect(repaired.isError).not.toBe(true)
    const repairedData=JSON.parse((repaired.content as Array<{text:string}>)[0]!.text)
    expect(repairedData).toMatchObject({revision:4,statistics:{faces:7,boundaryEdges:0}})
    expect(repairedData.changes[0].created.face).toHaveLength(1)
    const failedRepair=await call('aurora_model_operations_apply',{projectId:'native-test',assetId:knifeId,expectedRevision:4,operations:[{type:'delete',mode:'face',ids:['f0']},{type:'fill',mode:'edge',ids:['missing','other','stale'],style:'grid'}]})
    expect(failedRepair.isError).toBe(true)
    const repairAfterFailure=await call('aurora_model_get',{projectId:'native-test',assetId:knifeId})
    expect(JSON.parse((repairAfterFailure.content as Array<{text:string}>)[0]!.text).revision).toBe(4)
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

