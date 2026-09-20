import { describe,it,expect } from 'vitest'
import { createPinia,setActivePinia } from 'pinia'
import { createModel,applyModelOperation,modelOperationResult,validateMesh,type ModelDraft,type ModelOperation } from '../../../../shared/modeling'
import { topologyEdgeKey } from '../../../../shared/loopCut'
import { meshTopology } from '../../../../shared/meshTopology'
import { useEditorStore } from '@/stores/editor'
import { serializeEditorState,deserializeEditorState } from '@/engine/project/serialization'

const apply=(draft:ModelDraft,op:ModelOperation)=>applyModelOperation(draft,draft.revision,op)
const split=(draft:ModelDraft,cuts=1)=>apply(draft,{type:'subdivide',mode:'face',ids:draft.mesh.faces.map(f=>f.id),cuts})
const coarsen=(draft:ModelDraft,iterations=1)=>apply(draft,{type:'unsubdivide',faceIds:draft.mesh.faces.map(f=>f.id),iterations})

describe('uniform subdivision and coarsening',()=>{
  it.each([1,2,3])('subdivides a cube with %i cuts and shared watertight topology',cuts=>{
    const source=createModel().draft,result=split(source,cuts),n=cuts+1
    expect(validateMesh(result.mesh)).toMatchObject({faces:6*n*n,vertices:6*n*n+2,boundaryEdges:0})
    expect(source.mesh.faces).toHaveLength(6)
    expect(source.mesh.faces.every(f=>result.mesh.faces.some(next=>next.id===f.id))).toBe(true)
    expect(result.mesh.faces.every(f=>f.vertices.length===4)).toBe(true)
  })
  it('propagates splits to unselected neighbors without cracks and preserves their IDs',()=>{
    const source=createModel().draft,result=apply(source,{type:'subdivide',mode:'face',ids:['f5'],cuts:1})
    expect(validateMesh(result.mesh)).toMatchObject({faces:9,vertices:13,boundaryEdges:0})
    expect(result.mesh.faces.find(f=>f.id==='f0')!.vertices).toHaveLength(5)
    expect(result.mesh.faces.find(f=>f.id==='f4')).toEqual(source.mesh.faces.find(f=>f.id==='f4'))
    const selected=['f5',...result.mesh.faces.filter(f=>!source.mesh.faces.some(old=>old.id===f.id)).map(f=>f.id)]
    const restored=apply(result,{type:'unsubdivide',faceIds:selected,iterations:1})
    expect(validateMesh(restored.mesh)).toMatchObject({vertices:8,faces:6,boundaryEdges:0})
  })
  it('splits selected edges and subdivides a face when all of its edges are selected',()=>{
    const source=createModel('plane').draft
    const partial=apply(source,{type:'subdivide',mode:'edge',ids:[topologyEdgeKey('v0','v1')],cuts:2})
    expect(validateMesh(partial.mesh)).toMatchObject({vertices:6,faces:1,edges:6})
    const full=apply(source,{type:'subdivide',mode:'edge',ids:[...meshTopology(source.mesh).edges.keys()],cuts:1})
    expect(validateMesh(full.mesh)).toMatchObject({vertices:9,faces:4})
  })
  it.each([1,2,3])('subdivides a triangle into a regular triangular grid (%i cuts)',cuts=>{
    const base=createModel('plane').draft
    base.mesh.faces[0]!.vertices=['v0','v1','v2'];base.mesh.vertices=base.mesh.vertices.filter(v=>v.id!=='v3')
    const result=split(base,cuts),n=cuts+1
    expect(validateMesh(result.mesh)).toMatchObject({vertices:(n+1)*(n+2)/2,faces:n*n,boundaryEdges:3*n})
    expect(result.mesh.faces.every(f=>f.vertices.length===3)).toBe(true)
  })
  it('roundtrips regular quad grids with one or multiple coarsening iterations',()=>{
    for(const primitive of ['cube','plane'] as const){
      const base=createModel(primitive).draft,result=coarsen(split(base,3),2)
      expect(validateMesh(result.mesh)).toEqual(validateMesh(base.mesh))
      expect(result.mesh.vertices).toEqual(base.mesh.vertices)
      expect(result.mesh.faces.map(f=>[...f.vertices].sort()).sort()).toEqual(base.mesh.faces.map(f=>[...f.vertices].sort()).sort())
    }
  })
  it('coarsens bilinear bent quads without flattening their corners',()=>{
    const base=createModel('plane').draft;base.mesh.vertices[0]!.position[1]=.5
    const result=coarsen(split(base))
    expect(result.mesh.vertices).toEqual(base.mesh.vertices)
    expect(result.mesh.faces[0]!.vertices).toHaveLength(4)
  })
  it('keeps transition vertices when coarsening a block beside finer geometry',()=>{
    const base=split(createModel('plane').draft,3),positions=new Map(base.mesh.vertices.map(v=>[v.id,v.position]))
    const ids=base.mesh.faces.filter(f=>f.vertices.every(id=>positions.get(id)![0]<=0&&positions.get(id)![2]<=0)).map(f=>f.id)
    expect(ids).toHaveLength(4)
    const result=apply(base,{type:'unsubdivide',faceIds:ids,iterations:1})
    expect(validateMesh(result.mesh)).toMatchObject({faces:13,vertices:22,boundaryEdges:14})
    expect(result.mesh.faces.some(f=>f.vertices.length===6)).toBe(true)
  })
  it('rejects a subdivision that would exceed the geometry limit without changing source',()=>{
    const base=split(createModel().draft,7),snapshot=JSON.stringify(base)
    expect(()=>split(base,7)).toThrow(/limit/)
    expect(JSON.stringify(base)).toBe(snapshot)
  })
  it('rejects odd grids, edited centers, excessive iterations and stale references atomically',()=>{
    const odd=split(createModel('plane').draft,2),before=JSON.stringify(odd)
    expect(()=>coarsen(odd)).toThrow(/2×2/)
    expect(JSON.stringify(odd)).toBe(before)
    const base=split(createModel('plane').draft)
    const center=base.mesh.vertices.find(v=>v.position.every(n=>n===0))!;center.position[1]=.2
    expect(()=>coarsen(base)).toThrow(/2×2/)
    expect(()=>coarsen(split(createModel('plane').draft),2)).toThrow(/2×2/)
    expect(()=>apply(createModel().draft,{type:'subdivide',mode:'face',ids:['missing'],cuts:1})).toThrow(/Unknown/)
  })
  it('returns all selected child faces, including the reused source face',()=>{
    const base=createModel('plane').draft,result=modelOperationResult(base,1,{type:'subdivide',mode:'face',ids:['f0'],cuts:1})
    expect(result.selection.face).toHaveLength(4)
    expect(result.selection.face).toContain('f0')
    const restored=modelOperationResult(result.draft,2,{type:'unsubdivide',faceIds:result.selection.face,iterations:1})
    expect(restored.selection.face).toHaveLength(1)
  })
  it('persists subdivided topology and coarsens after reload, with independent undo steps',()=>{
    setActivePinia(createPinia())
    const store=useEditorStore(),asset=store.createNativeModel()
    store.editNativeModel(asset.id,1,{type:'subdivide',mode:'face',ids:asset.nativeModel!.draft.mesh.faces.map(f=>f.id),cuts:1})
    const state={project:store.project,layers:store.layers,scenes3D:store.scenes3D,assets:store.assets,nodes:store.nodes,nodeConnections:store.nodeConnections,rigs:store.rigs}
    const loaded=deserializeEditorState(serializeEditorState(state),state).assets.find(a=>a.id===asset.id)!.nativeModel!.draft
    expect(validateMesh(coarsen(loaded).mesh).faces).toBe(6)
    store.editNativeModel(asset.id,2,{type:'unsubdivide',faceIds:loaded.mesh.faces.map(f=>f.id),iterations:1})
    store.undo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces).toHaveLength(24)
    store.redo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces).toHaveLength(6)
  })
})

describe('connect vertex paths',()=>{
  it('connects opposite quad vertices and selects the authored diagonal',()=>{
    const base=createModel('plane').draft,result=modelOperationResult(base,1,{type:'connect-path',vertexIds:['v0','v2']})
    expect(validateMesh(result.draft.mesh)).toMatchObject({vertices:4,faces:2,boundaryEdges:4})
    expect(result.selection.edge).toEqual([topologyEdgeKey('v0','v2')])
    expect(base.mesh.faces).toHaveLength(1)
  })
  it('crosses coplanar faces and shares intersection vertices with their neighbors',()=>{
    const base=apply(createModel('plane').draft,{type:'loop-cut',edge:['v0','v1'],cuts:1,position:.5})
    const result=modelOperationResult(base,base.revision,{type:'connect-path',vertexIds:['v0','v2']})
    expect(validateMesh(result.draft.mesh)).toMatchObject({vertices:7,faces:4,boundaryEdges:6})
    expect(result.selection.edge).toHaveLength(2)
    const center=result.draft.mesh.vertices.filter(v=>v.position.every(n=>Math.abs(n)<1e-7))
    expect(center).toHaveLength(1)
    expect(result.draft.mesh.faces.filter(f=>f.vertices.includes(center[0]!.id))).toHaveLength(4)
  })
  it('passes through existing interior vertices without duplication',()=>{
    const base=split(createModel('plane').draft)
    const result=modelOperationResult(base,2,{type:'connect-path',vertexIds:['v0','v2']})
    expect(validateMesh(result.draft.mesh)).toMatchObject({vertices:9,faces:6,boundaryEdges:8})
    expect(result.selection.edge).toHaveLength(2)
  })
  it('uses explicit path order and may follow existing edges between new connections',()=>{
    const base=createModel().draft
    const result=apply(base,{type:'connect-path',vertexIds:['v0','v2','v6','v4']})
    expect(validateMesh(result.mesh)).toMatchObject({vertices:8,faces:8,boundaryEdges:0})
  })
  it('rejects paths through empty space, nonplanar faces, stale and repeated vertices',()=>{
    const base=createModel().draft,before=JSON.stringify(base)
    expect(()=>apply(base,{type:'connect-path',vertexIds:['v0','v6']})).toThrow(/coplanar/)
    expect(()=>apply(base,{type:'connect-path',vertexIds:['v0','missing']})).toThrow(/Unknown/)
    expect(()=>apply(base,{type:'connect-path',vertexIds:['v0','v0']})).toThrow(/distinct/)
    expect(()=>apply(base,{type:'connect-path',vertexIds:['v0','v1']})).toThrow(/already connected/)
    const bent=createModel('plane').draft;bent.mesh.vertices[0]!.position[1]=.5
    expect(()=>apply(bent,{type:'connect-path',vertexIds:['v0','v2']})).toThrow(/coplanar/)
    expect(JSON.stringify(base)).toBe(before)
  })
  it('rejects geometrically touching but disconnected surfaces instead of making a broken path',()=>{
    const base=createModel('plane').draft
    base.mesh.vertices.push({id:'a',position:[1,0,-1]},{id:'b',position:[1,0,1]},{id:'c',position:[3,0,1]},{id:'d',position:[3,0,-1]})
    base.mesh.faces.push({id:'other',vertices:['a','b','c','d']})
    const before=JSON.stringify(base)
    expect(()=>apply(base,{type:'connect-path',vertexIds:['v0','c']})).toThrow(/disconnected/)
    expect(JSON.stringify(base)).toBe(before)
  })
})
