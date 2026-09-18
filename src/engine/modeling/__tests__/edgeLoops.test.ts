import { describe,it,expect } from 'vitest'
import { createPinia,setActivePinia } from 'pinia'
import { createModel,applyModelOperation,validateMesh } from '../../../../shared/modeling'
import { insertQuadLoop,topologyEdgeKey } from '../../../../shared/loopCut'
import { selectEdgeLoop,selectFaceLoop,edgeSlideVertices } from '../../../../shared/edgeLoops'
import { useEditorStore } from '@/stores/editor'
function fixture(){
  const draft=createModel().draft
  const {cutEdges}=insertQuadLoop(draft.mesh,{edge:['v0','v1'],cuts:1,position:.5})
  return {draft,edges:cutEdges.map(([a,b])=>topologyEdgeKey(a,b))}
}
describe('edge loops and constrained slide',()=>{
  it('selects a full loop from any seed without selecting its perpendicular ring',()=>{
    const {draft,edges}=fixture()
    for(const seed of edges)expect(new Set(selectEdgeLoop(draft.mesh,seed))).toEqual(new Set(edges))
  })
  it('stops at poles and follows a boundary without guessing a direction',()=>{
    const cube=createModel().draft.mesh
    expect(selectEdgeLoop(cube,topologyEdgeKey('v0','v1'))).toHaveLength(1)
    expect(selectEdgeLoop(createModel('plane').draft.mesh,topologyEdgeKey('v0','v1'))).toHaveLength(4)
    expect(selectEdgeLoop(cube,'absent')).toEqual([])
  })
  it('selects a perpendicular row of faces in face mode',()=>{
    const mesh=createModel().draft.mesh
    const faces=selectFaceLoop(mesh,topologyEdgeKey('v0','v1'))
    expect(faces).toHaveLength(4)
    expect(faces).toContain('f0');expect(faces).toContain('f4')
    expect(faces).not.toContain('f2');expect(faces).not.toContain('f3')
  })
  it('slides both ways along rails while retaining quads, source and all unselected vertices',()=>{
    const {draft,edges}=fixture(),before=JSON.stringify(draft)
    const moved=new Set(edgeSlideVertices(draft.mesh,edges,0).map(v=>v.id))
    for(const factor of [-.8,.5]){
      const result=applyModelOperation(draft,1,{type:'edge-slide',edgeIds:edges,factor})
      expect(result.mesh.faces).toEqual(draft.mesh.faces)
      expect(validateMesh(result.mesh)).toMatchObject({vertices:12,faces:10,boundaryEdges:0})
      const xs=new Set(result.mesh.vertices.filter(v=>moved.has(v.id)).map(v=>v.position[0]))
      expect(xs.size).toBe(1);expect(Math.abs([...xs][0]!)).toBeCloseTo(Math.abs(factor))
      for(const v of result.mesh.vertices){const original=draft.mesh.vertices.find(o=>o.id===v.id)!
        if(!moved.has(v.id))expect(v).toEqual(original)
        else expect(v.position.slice(1)).toEqual(original.position.slice(1))
      }
    }
    expect(JSON.stringify(draft)).toBe(before)
  })
  it('follows slanted rails rather than translating a loop rigidly',()=>{
    const {draft,edges}=fixture()
    // An affine shear changes the direction of every rail without changing connectivity.
    for(const v of draft.mesh.vertices)v.position[1]+=v.position[0]*.4
    const result=applyModelOperation(draft,1,{type:'edge-slide',edgeIds:edges,factor:.5})
    for(const v of result.mesh.vertices.slice(8)){
      const original=draft.mesh.vertices.find(o=>o.id===v.id)!
      expect(v.position[1]-original.position[1]).toBeCloseTo(v.position[0]*.4)
    }
  })
  it('supports a partial edge chain with matching side orientation',()=>{
    const {draft,edges}=fixture()
    const result=applyModelOperation(draft,1,{type:'edge-slide',edgeIds:edges.slice(0,1),factor:.2})
    expect(validateMesh(result.mesh).boundaryEdges).toBe(0)
    expect(edgeSlideVertices(draft.mesh,edges.slice(0,1),.2)).toHaveLength(2)
  })
  it('rejects branches, boundary slides, invalid rails and out-of-range factors atomically',()=>{
    const {draft,edges}=fixture(),before=JSON.stringify(draft)
    for(const op of [
      {type:'edge-slide' as const,edgeIds:edges,factor:1},
      {type:'edge-slide' as const,edgeIds:['missing'],factor:.2},
      {type:'edge-slide' as const,edgeIds:[...edges,topologyEdgeKey('v0','v3')],factor:.2}
    ])expect(()=>applyModelOperation(draft,1,op)).toThrow()
    const plane=createModel('plane').draft
    expect(()=>edgeSlideVertices(plane.mesh,[topologyEdgeKey('v0','v1')],.2)).toThrow(/two adjacent/)
    expect(JSON.stringify(draft)).toBe(before)
  })
  it('commits one undo step; previews do not mutate the store',()=>{
    setActivePinia(createPinia());const store=useEditorStore(),asset=store.createNativeModel('Slide','cube')
    store.editNativeModel(asset.id,1,{type:'loop-cut',edge:['v0','v1'],cuts:1,position:.5})
    const source=store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft
    const {edges}=fixture(),before=JSON.stringify(source)
    for(const factor of [.1,.2,.3])applyModelOperation(source,2,{type:'edge-slide',edgeIds:edges,factor})
    expect(JSON.stringify(source)).toBe(before)
    store.editNativeModel(asset.id,2,{type:'edge-slide',edgeIds:edges,factor:.3})
    store.undo();expect(JSON.stringify(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft)).toBe(before)
    store.redo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.revision).toBe(3)
  })
})
