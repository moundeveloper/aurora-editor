import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createModel, applyModelOperation, modelOperationResult, validateMesh, type ModelDraft, type ModelOperation } from '../../../../shared/modeling'
import { meshTopology } from '../../../../shared/meshTopology'
import { topologyEdgeKey } from '../../../../shared/loopCut'
import { useEditorStore } from '@/stores/editor'

const apply=(draft:ModelDraft,op:ModelOperation)=>applyModelOperation(draft,draft.revision,op)
const bevelOp=(ids:string[],extra:Partial<Extract<ModelOperation,{type:'bevel'}>>={}):Extract<ModelOperation,{type:'bevel'}>=>({type:'bevel',mode:'edge',ids,width:.2,segments:1,profile:.5,clampOverlap:true,...extra})
function twoCaps(){
  const draft=createModel().draft
  draft.mesh.faces=draft.mesh.faces.filter(f=>f.id==='f0'||f.id==='f1')
  return draft
}
const boundaries=(draft:ModelDraft)=>[...meshTopology(draft.mesh).edges].filter(([,u])=>u.length===1).map(([id])=>id)

describe('construction operations',()=>{
  it('bevels one cube edge with stable original faces and a closed chamfer',()=>{
    const base=createModel().draft, snapshot=JSON.stringify(base)
    const result=modelOperationResult(base,1,bevelOp([topologyEdgeKey('v0','v1')]))
    expect(validateMesh(result.draft.mesh)).toMatchObject({faces:7,boundaryEdges:0})
    expect(result.created.face).toHaveLength(1)
    expect(result.deleted.edge).toContain(topologyEdgeKey('v0','v1'))
    expect(base.mesh.faces.every(f=>result.draft.mesh.faces.some(next=>next.id===f.id))).toBe(true)
    expect(JSON.stringify(base)).toBe(snapshot)
  })
  it.each([2,4,8])('adds %i bevel facets along a selected edge',segments=>{
    const result=apply(createModel().draft,bevelOp([topologyEdgeKey('v0','v1')],{segments}))
    expect(validateMesh(result.mesh)).toMatchObject({faces:6+segments,boundaryEdges:0})
  })
  it('bevels connected edge selections and all cube edges without cracks',()=>{
    const base=createModel().draft, edges=[...meshTopology(base.mesh).edges.keys()]
    for(const segments of [1,3]){
      const result=apply(base,bevelOp(edges,{segments}))
      expect(validateMesh(result.mesh).boundaryEdges).toBe(0)
      expect(result.mesh.faces.length).toBeGreaterThan(6)
    }
  })
  it('changes the rounded profile and supports vertex chamfers',()=>{
    const base=createModel().draft, edge=topologyEdgeKey('v0','v1')
    const a=apply(base,bevelOp([edge],{segments:4,profile:.2})), b=apply(base,bevelOp([edge],{segments:4,profile:.8}))
    expect(a.mesh.vertices).not.toEqual(b.mesh.vertices)
    const vertex=apply(base,bevelOp(['v0'],{mode:'vertex'}))
    expect(validateMesh(vertex.mesh)).toMatchObject({faces:7,boundaryEdges:0})
    expect(vertex.mesh.vertices.some(v=>v.id==='v0')).toBe(false)
    expect(validateMesh(apply(base,bevelOp(base.mesh.vertices.map(v=>v.id),{mode:'vertex'})).mesh).boundaryEdges).toBe(0)
  })
  it('requires the full straight corner when authoring edges have been subdivided',()=>{
    const base=apply(createModel().draft,{type:'loop-cut',edge:['v0','v1'],cuts:1,position:.5})
    const positions=new Map(base.mesh.vertices.map(v=>[v.id,v.position]))
    const edges=[...meshTopology(base.mesh).edges].filter(([,uses])=>[uses[0]!.from,uses[0]!.to].every(id=>positions.get(id)![1]===-1&&positions.get(id)![2]===-1)).map(([id])=>id)
    expect(edges).toHaveLength(2)
    expect(()=>apply(base,bevelOp([edges[0]!]))).toThrow(/every segment/)
    expect(validateMesh(apply(base,bevelOp(edges)).mesh).boundaryEdges).toBe(0)
  })
  it('clamps excessive width or rejects it atomically when clamping is disabled',()=>{
    const base=createModel().draft, snapshot=JSON.stringify(base), ids=[topologyEdgeKey('v0','v1')]
    expect(validateMesh(apply(base,bevelOp(ids,{width:100})).mesh).boundaryEdges).toBe(0)
    expect(()=>apply(base,bevelOp(ids,{width:100,clampOverlap:false}))).toThrow(/safe limit/)
    expect(JSON.stringify(base)).toBe(snapshot)
  })
  it('rejects open geometry, stale IDs and unsupported vertex segments',()=>{
    expect(()=>apply(createModel('plane').draft,bevelOp([topologyEdgeKey('v0','v1')]))).toThrow(/closed solid/)
    expect(()=>apply(createModel().draft,bevelOp(['missing']))).toThrow(/Unknown/)
    expect(()=>apply(createModel().draft,bevelOp(['v0'],{mode:'vertex',segments:2}))).toThrow(/one-segment/)
    const concave=apply(createModel().draft,{type:'inset',faceId:'f5',fraction:.4})
    const recessed=apply(concave,{type:'extrude',faceId:'f5',distance:-.5})
    expect(()=>apply(recessed,bevelOp([topologyEdgeKey('v0','v1')]))).toThrow(/convex/)
  })
  it.each([0,1,4])('bridges two separated caps with %i intermediate rows',cuts=>{
    const base=twoCaps(), snapshot=JSON.stringify(base)
    const result=modelOperationResult(base,1,{type:'bridge',edgeIds:boundaries(base),cuts,twist:0})
    expect(validateMesh(result.draft.mesh)).toMatchObject({vertices:8+cuts*4,faces:2+4*(cuts+1),boundaryEdges:0})
    expect(result.created.face).toHaveLength(4*(cuts+1))
    expect(JSON.stringify(base)).toBe(snapshot)
  })
  it('rejects partial, interior and unequal bridge selections atomically',()=>{
    const base=twoCaps(), snapshot=JSON.stringify(base)
    expect(()=>apply(base,{type:'bridge',edgeIds:boundaries(base).slice(0,7),cuts:0,twist:0})).toThrow(/complete closed/)
    expect(()=>apply(createModel().draft,{type:'bridge',edgeIds:boundaries(base),cuts:0,twist:0})).toThrow(/open boundary/)
    expect(JSON.stringify(base)).toBe(snapshot)
    base.mesh.faces[0]!.vertices.pop()
    expect(()=>apply(base,{type:'bridge',edgeIds:boundaries(base),cuts:0,twist:0})).toThrow(/same vertex count/)
  })
  it('undoes bevel as one operation and restores identical geometry on redo',()=>{
    setActivePinia(createPinia())
    const store=useEditorStore(),asset=store.createNativeModel(),base=JSON.stringify(asset.nativeModel!.draft)
    store.editNativeModel(asset.id,1,bevelOp([topologyEdgeKey('v0','v1')],{segments:3}))
    const result=JSON.stringify(asset.nativeModel!.draft)
    store.undo();expect(JSON.stringify(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft)).toBe(base)
    store.redo();expect(JSON.stringify(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft)).toBe(result)
  })
  it('does not bevel an unrelated disconnected component',()=>{
    const base=createModel().draft, other=createModel().draft.mesh
    other.vertices=other.vertices.map(v=>({id:`other-${v.id}`,position:[v.position[0]+5,v.position[1],v.position[2]]}))
    other.faces=other.faces.map(f=>({id:`other-${f.id}`,vertices:f.vertices.map(id=>`other-${id}`)}))
    base.mesh.vertices.push(...other.vertices);base.mesh.faces.push(...other.faces)
    const result=apply(base,bevelOp([topologyEdgeKey('v0','v1')]))
    expect(result.mesh.vertices.filter(v=>v.id.startsWith('other-'))).toEqual(other.vertices)
    expect(result.mesh.faces.filter(f=>f.id.startsWith('other-'))).toEqual(other.faces)
  })
  it('applies twist to correspondence and rejects a bridge over existing walls',()=>{
    const base=twoCaps(),edges=boundaries(base)
    const straight=apply(base,{type:'bridge',edgeIds:edges,cuts:2,twist:0})
    const twisted=apply(base,{type:'bridge',edgeIds:edges,cuts:2,twist:1})
    expect(validateMesh(twisted.mesh).boundaryEdges).toBe(0)
    expect(twisted.mesh.vertices).not.toEqual(straight.mesh.vertices)
    const tube=apply(createModel().draft,{type:'delete',mode:'face',ids:['f0','f1']})
    expect(()=>apply(tube,{type:'bridge',edgeIds:boundaries(tube),cuts:2,twist:0})).toThrow(/already joined/)
  })
})
