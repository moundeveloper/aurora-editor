import {describe,it,expect} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {createModel,applyModelOperation,validateMesh,type ModelDraft} from '../../../../shared/modeling'
import {useEditorStore} from '@/stores/editor'
function grid(size=2):ModelDraft{
 const draft=createModel('plane').draft
 draft.mesh={vertices:[],faces:[],nextId:100}
 for(let z=0;z<=size;z++)for(let x=0;x<=size;x++)draft.mesh.vertices.push({id:`v${z*(size+1)+x}`,position:[x,0,z]})
 for(let z=0;z<size;z++)for(let x=0;x<size;x++){const a=z*(size+1)+x;draft.mesh.faces.push({id:`f${z*size+x}`,vertices:[a,a+size+1,a+size+2,a+1].map(i=>`v${i}`)})}
 return draft
}
describe('region extrusion',()=>{
 it('extrudes joined quads without internal walls or duplicated cap seams',()=>{
  const base=grid(),faceIds=base.mesh.faces.map(f=>f.id),saved=JSON.stringify(base)
  const out=applyModelOperation(base,1,{type:'extrude-region',faceIds,distance:2})
  expect(validateMesh(out.mesh)).toMatchObject({vertices:17,faces:12,boundaryEdges:8})
  expect(out.mesh.faces.every(f=>f.vertices.length===4)).toBe(true)
  const cap=out.mesh.faces.filter(f=>faceIds.includes(f.id))
  expect(new Set(cap.flatMap(f=>f.vertices)).size).toBe(9)
  expect(out.mesh.vertices.some(v=>v.id==='v4')).toBe(false)
  for(const id of new Set(cap.flatMap(f=>f.vertices)))expect(out.mesh.vertices.find(v=>v.id===id)!.position[1]).toBe(2)
  expect(JSON.stringify(base)).toBe(saved)
  const twice=applyModelOperation(out,2,{type:'extrude-region',faceIds,distance:1})
  expect(validateMesh(twice.mesh)).toMatchObject({faces:20,boundaryEdges:8})
 })
 it('keeps the new cap topology at its starting position when movement is cancelled',()=>{
  const base=createModel().draft
  const out=applyModelOperation(base,1,{type:'extrude-region',faceIds:['f5'],distance:1e-5,direction:[0,1,0]})
  expect(out.mesh.faces).toHaveLength(10)
  expect(out.mesh.faces.find(f=>f.id==='f5')!.vertices).not.toEqual(base.mesh.faces.find(f=>f.id==='f5')!.vertices)
  const original=base.mesh.vertices.filter(v=>['v3','v7','v6','v2'].includes(v.id)).map(v=>v.position)
  const cap=out.mesh.faces.find(f=>f.id==='f5')!
  const capPositions=cap.vertices.map(id=>out.mesh.vertices.find(v=>v.id===id)!.position)
  expect(capPositions).toHaveLength(4)
  for(const position of capPositions)expect(position[0]).toBeCloseTo(original.find(p=>Math.abs(p[0]-position[0])<1e-8)![0])
  // The cap is distinct and remains the active face ID, so the next movement can continue it.
  expect(cap.id).toBe('f5')
 })
 it('preserves a hole by extruding both inner and outer boundary loops',()=>{
  const base=grid(3);base.mesh.faces=base.mesh.faces.filter(f=>f.id!=='f4')
  const out=applyModelOperation(base,1,{type:'extrude-region',faceIds:base.mesh.faces.map(f=>f.id),distance:1})
  expect(validateMesh(out.mesh)).toMatchObject({vertices:32,faces:24,boundaryEdges:16})
 })
 it('keeps a solid closed when extruding adjacent noncoplanar faces',()=>{
  const base=createModel().draft
  const out=applyModelOperation(base,1,{type:'extrude-region',faceIds:['f1','f5'],distance:1})
  expect(validateMesh(out.mesh)).toMatchObject({vertices:14,faces:12,boundaryEdges:0})
  expect(out.mesh.faces.find(f=>f.id==='f0')).toEqual(base.mesh.faces.find(f=>f.id==='f0'))
 })
 it('handles disconnected face regions, explicit directions, and a closed shell',()=>{
  const base=createModel().draft
  const out=applyModelOperation(base,1,{type:'extrude-region',faceIds:['f0','f1'],distance:.3,direction:[0,0,1]})
  expect(validateMesh(out.mesh).boundaryEdges).toBe(0)
  const all=applyModelOperation(base,1,{type:'extrude-region',faceIds:base.mesh.faces.map(f=>f.id),distance:2,direction:[1,0,0]})
  expect(validateMesh(all.mesh)).toMatchObject({vertices:8,faces:6,boundaryEdges:0})
  expect(all.mesh.vertices[0]!.position[0]).toBe(1)
 })
 it('rejects pinched boundaries, missing selections and zero directions atomically',()=>{
  const base=grid(),saved=JSON.stringify(base)
  for(const op of [
   {type:'extrude-region' as const,faceIds:['f0','f3'],distance:1},
   {type:'extrude-region' as const,faceIds:['missing'],distance:1},
   {type:'extrude-region' as const,faceIds:['f0'],distance:0},
   {type:'extrude-region' as const,faceIds:['f0'],distance:1,direction:[0,0,0] as [number,number,number]}
  ])expect(()=>applyModelOperation(base,1,op)).toThrow()
  expect(JSON.stringify(base)).toBe(saved)
 })
 it('commits the region as one undoable operation and retains selected face IDs',()=>{
  setActivePinia(createPinia());const store=useEditorStore(),asset=store.createNativeModel('Region','cube')
  store.editNativeModel(asset.id,1,{type:'extrude-region',faceIds:['f1','f5'],distance:.5})
  expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces).toHaveLength(12)
  store.undo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces).toHaveLength(6)
  store.redo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces.filter(f=>['f1','f5'].includes(f.id))).toHaveLength(2)
 })
})
