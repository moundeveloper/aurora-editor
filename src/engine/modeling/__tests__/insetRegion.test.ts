import {describe,it,expect} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {createModel,applyModelOperation,validateMesh,type ModelDraft} from '../../../../shared/modeling'
import {useEditorStore} from '@/stores/editor'
function grid(size=2):ModelDraft{
 const draft=createModel('plane').draft;draft.mesh={vertices:[],faces:[],nextId:100}
 for(let z=0;z<=size;z++)for(let x=0;x<=size;x++)draft.mesh.vertices.push({id:`v${z*(size+1)+x}`,position:[x,0,z]})
 for(let z=0;z<size;z++)for(let x=0;x<size;x++){const a=z*(size+1)+x;draft.mesh.faces.push({id:`f${z*size+x}`,vertices:[a,a+size+1,a+size+2,a+1].map(i=>`v${i}`)})}
 return draft
}
describe('region inset',()=>{
 it('adds an even-width outer border while retaining the interior grid and shared vertices',()=>{
  const base=grid(),before=JSON.stringify(base),faceIds=base.mesh.faces.map(f=>f.id)
  const out=applyModelOperation(base,1,{type:'inset-region',faceIds,thickness:.2})
  expect(validateMesh(out.mesh)).toMatchObject({vertices:17,faces:12,boundaryEdges:8})
  expect(out.mesh.faces.every(f=>f.vertices.length===4)).toBe(true)
  expect(out.mesh.vertices.find(v=>v.id==='v4')!.position).toEqual([1,0,1])
  const capIds=new Set(out.mesh.faces.filter(f=>faceIds.includes(f.id)).flatMap(f=>f.vertices))
  expect(capIds.size).toBe(9)
  const points=out.mesh.vertices.filter(v=>capIds.has(v.id)).map(v=>v.position)
  expect(Math.min(...points.map(p=>p[0]))).toBeCloseTo(.2);expect(Math.max(...points.map(p=>p[2]))).toBeCloseTo(1.8)
  expect(JSON.stringify(base)).toBe(before)
  const twice=applyModelOperation(out,2,{type:'inset-region',faceIds,thickness:.1})
  expect(validateMesh(twice.mesh).faces).toBe(20)
  const extruded=applyModelOperation(twice,3,{type:'extrude-region',faceIds,distance:1})
  expect(validateMesh(extruded.mesh).boundaryEdges).toBe(8)
 })
 it('insets adjacent faces across a cube corner without internal border walls',()=>{
  const base=createModel().draft,out=applyModelOperation(base,1,{type:'inset-region',faceIds:['f1','f5'],thickness:.2})
  expect(validateMesh(out.mesh)).toMatchObject({vertices:14,faces:12,boundaryEdges:0})
  const a=out.mesh.faces.find(f=>f.id==='f1')!,b=out.mesh.faces.find(f=>f.id==='f5')!
  expect(a.vertices.filter(id=>b.vertices.includes(id))).toHaveLength(2)
 })
 it('shrinks the outside and expands a hole, preserving both boundary loops',()=>{
  const base=grid(3);base.mesh.faces=base.mesh.faces.filter(f=>f.id!=='f4')
  const out=applyModelOperation(base,1,{type:'inset-region',faceIds:base.mesh.faces.map(f=>f.id),thickness:.1})
  expect(validateMesh(out.mesh)).toMatchObject({vertices:32,faces:24,boundaryEdges:16})
  expect(out.mesh.vertices.some(v=>Math.abs(v.position[0]-.9)<1e-8 && Math.abs(v.position[2]-.9)<1e-8)).toBe(true)
 })
 it('handles disconnected patches independently',()=>{
  const base=createModel().draft,out=applyModelOperation(base,1,{type:'inset-region',faceIds:['f0','f1'],thickness:.1})
  expect(validateMesh(out.mesh)).toMatchObject({vertices:16,faces:14,boundaryEdges:0})
 })
 it('rejects invalid widths, pinched boundaries, closed shells and bent faces atomically',()=>{
  const base=grid(),before=JSON.stringify(base)
  for(const [faceIds,thickness] of [[['f0','f3'],.1],[['missing'],.1],[['f0'],0],[['f0'],2]] as const)
   expect(()=>applyModelOperation(base,1,{type:'inset-region',faceIds:[...faceIds],thickness})).toThrow()
  expect(JSON.stringify(base)).toBe(before)
  const cube=createModel().draft
  expect(()=>applyModelOperation(cube,1,{type:'inset-region',faceIds:cube.mesh.faces.map(f=>f.id),thickness:.1})).toThrow(/boundary/)
  base.mesh.vertices[0]!.position[1]=.3
  expect(()=>applyModelOperation(base,1,{type:'inset-region',faceIds:['f0'],thickness:.1})).toThrow(/planar/)
 })
 it('supports one undo step and leaves source untouched during previews',()=>{
  setActivePinia(createPinia());const store=useEditorStore(),asset=store.createNativeModel('Inset','cube')
  const original=JSON.stringify(asset.nativeModel!.draft)
  const operation={type:'inset-region' as const,faceIds:['f1','f5'],thickness:.2}
  applyModelOperation(asset.nativeModel!.draft,1,operation)
  expect(JSON.stringify(asset.nativeModel!.draft)).toBe(original)
  store.editNativeModel(asset.id,1,operation);store.undo()
  expect(JSON.stringify(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft)).toBe(original)
  store.redo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.mesh.faces).toHaveLength(12)
 })
})
