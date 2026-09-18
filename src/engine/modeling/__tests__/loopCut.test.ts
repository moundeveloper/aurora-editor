import { describe,it,expect } from 'vitest'
import { createPinia,setActivePinia } from 'pinia'
import { createModel,applyModelOperation,validateMesh } from '../../../../shared/modeling'
import { useEditorStore } from '@/stores/editor'
import { configureViewportNavigation } from '@/engine/scene3d/viewportNavigation'
import { MOUSE } from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const op={type:'loop-cut' as const,edge:['v0','v1'] as [string,string],cuts:1,position:.25}
describe('quad loop cuts',()=>{
  it('cuts a closed cube with shared vertices and consistent off-center placement',()=>{
    const base=createModel().draft,result=applyModelOperation(base,1,op)
    expect(validateMesh(result.mesh)).toMatchObject({vertices:12,faces:10,boundaryEdges:0})
    expect(result.mesh.faces.every(f=>f.vertices.length===4)).toBe(true)
    expect(result.mesh.vertices.slice(8).every(v=>v.position[0]===-.5)).toBe(true)
    expect(base.mesh.vertices).toHaveLength(8)
    const reversed=applyModelOperation(base,1,{...op,edge:['v1','v0'],position:.75})
    expect(reversed.mesh.vertices.slice(8).map(v=>v.position).sort()).toEqual(result.mesh.vertices.slice(8).map(v=>v.position).sort())
  })
  it('makes evenly spaced multiple loops and permits subsequent cuts',()=>{
    const base=createModel().draft,result=applyModelOperation(base,1,{...op,cuts:3})
    expect(validateMesh(result.mesh)).toMatchObject({vertices:20,faces:18,boundaryEdges:0})
    expect([...new Set(result.mesh.vertices.slice(8).map(v=>v.position[0]))].sort()).toEqual([-.5,0,.5])
    const face=result.mesh.faces[0]!
    const next=applyModelOperation(result,2,{...op,edge:[face.vertices[0]!,face.vertices[1]!]})
    expect(validateMesh(next.mesh).boundaryEdges).toBe(0)
  })
  it('cuts an open plane into quads',()=>{
    const base=createModel('plane').draft,f=base.mesh.faces[0]!
    const result=applyModelOperation(base,1,{...op,edge:[f.vertices[0]!,f.vertices[1]!]})
    expect(validateMesh(result.mesh)).toMatchObject({vertices:6,faces:2,boundaryEdges:6})
  })
  it('rejects missing edges, invalid counts, and non-quad strips atomically',()=>{
    const base=createModel('plane').draft
    const f=base.mesh.faces[0]!,[a,b,c,d]=f.vertices
    base.mesh.faces=[{id:'f0',vertices:[a!,b!,c!]},{id:'f1',vertices:[a!,c!,d!]}]
    const saved=JSON.stringify(base)
    expect(()=>applyModelOperation(base,1,op)).toThrow(/quad/)
    expect(()=>applyModelOperation(base,1,{...op,edge:['absent','v1']})).toThrow()
    expect(()=>applyModelOperation(base,1,{...op,cuts:0})).toThrow()
    expect(JSON.stringify(base)).toBe(saved)
  })
  it('undoes and redoes a loop cut as a single store edit',()=>{
    setActivePinia(createPinia());const store=useEditorStore()
    const asset=store.createNativeModel('Loop test','cube')
    store.editNativeModel(asset.id,1,op)
    expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces).toHaveLength(10)
    store.undo()
    expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces).toHaveLength(6)
    store.redo()
    expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces).toHaveLength(10)
  })
  it('shares the 3D Scene mouse mapping',()=>{
    const controls={mouseButtons:{}} as OrbitControls
    configureViewportNavigation(controls)
    expect(controls.mouseButtons).toEqual({LEFT:MOUSE.ROTATE,MIDDLE:MOUSE.PAN,RIGHT:MOUSE.PAN})
  })
})
