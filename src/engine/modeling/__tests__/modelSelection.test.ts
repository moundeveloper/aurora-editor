import { describe,it,expect } from 'vitest'
import * as THREE from 'three'
import { createModel,applyModelOperation,validateMesh } from '../../../../shared/modeling'
import { meshEdges,convertSelection,selectionVertices,pickMeshElement,pickMeshElements,transformedVertices,selectionCenter } from '../modelSelection'
import { modelGeometry } from '../modelGeometry'

const viewport={width:800,height:600}
function fixture(){
  const draft=createModel().draft
  const body=new THREE.Mesh(modelGeometry(draft.mesh),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
  const camera=new THREE.PerspectiveCamera(45,800/600,.1,100)
  camera.position.set(4,3,5);camera.lookAt(0,0,0);camera.updateMatrixWorld()
  const screen=(position:THREE.Vector3)=>{const p=position.project(camera);return{x:(p.x+1)*400,y:(1-p.y)*300}}
  return{draft,body,camera,screen,dispose:()=>{body.geometry.dispose();body.material.dispose()}}
}
describe('quad mesh selection',()=>{
  it('exposes twelve cube edges, never the six render diagonals',()=>{
    const mesh=createModel().draft.mesh
    expect(meshEdges(mesh)).toHaveLength(12)
    expect(mesh.faces.every(f=>f.vertices.length===4)).toBe(true)
    const face=mesh.faces[0]!
    expect(meshEdges(mesh).some(e=>e.vertices.includes(face.vertices[0]!) && e.vertices.includes(face.vertices[2]!))).toBe(false)
  })
  it('selects either render triangle as the same quad face',()=>{
    const f=fixture()
    for(const position of [new THREE.Vector3(-.5,.2,1),new THREE.Vector3(.5,-.2,1)]) {
      expect(pickMeshElement(f.draft.mesh,f.body,f.camera,'face',f.screen(position),viewport)).toBe('f1')
    }
    f.dispose()
  })
  it('picks visible vertices and edges using pixel thresholds at different zoom levels',()=>{
    const f=fixture()
    for(const zoom of [1,2]) {
      f.camera.zoom=zoom;f.camera.updateProjectionMatrix()
      expect(pickMeshElement(f.draft.mesh,f.body,f.camera,'vertex',f.screen(new THREE.Vector3(1,1,1)),viewport)).toBe('v6')
      expect(pickMeshElement(f.draft.mesh,f.body,f.camera,'edge',f.screen(new THREE.Vector3(0,1,1)),viewport)).toBe(JSON.stringify(['v6','v7']))
    }
    f.dispose()
  })
  it('occludes rear vertices unless X-ray is enabled',()=>{
    const f=fixture(),point=f.screen(new THREE.Vector3(-1,-1,-1))
    expect(pickMeshElement(f.draft.mesh,f.body,f.camera,'vertex',point,viewport)).not.toBe('v0')
    expect(pickMeshElement(f.draft.mesh,f.body,f.camera,'vertex',point,viewport,true)).toBe('v0')
    f.dispose()
  })
  it('returns every face under the cursor when X-ray is enabled',()=>{
    const f=fixture()
    f.camera.position.set(0,0,5);f.camera.lookAt(0,0,0);f.camera.updateMatrixWorld()
    const point=f.screen(new THREE.Vector3(0,0,1))
    expect(pickMeshElements(f.draft.mesh,f.body,f.camera,'face',point,viewport)).toEqual(['f1'])
    expect(pickMeshElements(f.draft.mesh,f.body,f.camera,'face',point,viewport,true)).toEqual(expect.arrayContaining(['f1','f0']))
    expect(pickMeshElements(f.draft.mesh,f.body,f.camera,'face',point,viewport,true).length).toBeGreaterThan(1)
    f.dispose()
  })
  it('converts face selection to its four vertices and four edges',()=>{
    const mesh=createModel().draft.mesh
    const vertices=convertSelection(mesh,'face','vertex',['f5'])
    const edges=convertSelection(mesh,'vertex','edge',vertices)
    expect(vertices).toHaveLength(4);expect(edges).toHaveLength(4)
    expect(convertSelection(mesh,'edge','face',edges)).toEqual(['f5'])
    expect(selectionVertices(mesh,'edge',edges)).toHaveLength(4)
  })
})
describe('direct vertex transformations',()=>{
  it('allows a moved corner to bend source quads without converting them into triangles',()=>{
    const before=createModel().draft
    const after=applyModelOperation(before,1,{type:'set-positions',vertices:[{id:'v6',position:[1,1.5,1]}]})
    expect(after.mesh.faces.every(f=>f.vertices.length===4)).toBe(true)
    expect(validateMesh(after.mesh).boundaryEdges).toBe(0)
    expect(before.mesh.vertices.find(v=>v.id==='v6')!.position).toEqual([1,1,1])
    const geometry=modelGeometry(after.mesh);expect(geometry.getAttribute('position').count).toBe(36);geometry.dispose()
  })
  it('transforms selected vertices around their median without changing unselected geometry',()=>{
    const draft=createModel().draft,ids=selectionVertices(draft.mesh,'face',['f5']),center=selectionCenter(draft.mesh,ids)
    const matrix=new THREE.Matrix4().makeTranslation(center).multiply(new THREE.Matrix4().makeScale(.5,1,.5)).multiply(new THREE.Matrix4().makeTranslation(center.clone().negate()))
    const after=applyModelOperation(draft,1,{type:'set-positions',vertices:transformedVertices(draft.mesh,ids,matrix)})
    expect(after.mesh.vertices.find(v=>v.id==='v6')!.position).toEqual([.5,1,.5])
    expect(after.mesh.vertices.find(v=>v.id==='v0')).toEqual(draft.mesh.vertices.find(v=>v.id==='v0'))
  })
  it('keeps extrusion/inset entirely quad-based and rejects collapsed transforms atomically',()=>{
    const draft=createModel().draft
    const inset=applyModelOperation(draft,1,{type:'inset',faceId:'f5',fraction:.2})
    const extruded=applyModelOperation(inset,2,{type:'extrude',faceId:'f5',distance:2})
    expect(extruded.mesh.faces.every(f=>f.vertices.length===4)).toBe(true)
    const collapsed=transformedVertices(draft.mesh,draft.mesh.vertices.map(v=>v.id),new THREE.Matrix4().makeScale(0,0,0))
    expect(()=>applyModelOperation(draft,1,{type:'set-positions',vertices:collapsed})).toThrow()
    expect(draft.revision).toBe(1)
  })
})
