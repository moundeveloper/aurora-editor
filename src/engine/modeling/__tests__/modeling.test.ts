import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createModel, applyModelOperation, faceNormal, facePositions, publishModel, validateMesh } from '../../../../shared/modeling'
import { modelGeometry } from '../modelGeometry'
import { useEditorStore } from '@/stores/editor'
import { serializeEditorState, deserializeEditorState } from '@/engine/project/serialization'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import * as THREE from 'three'
import Dexie from 'dexie'
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'
import { AuroraProjectDatabase } from '@/engine/project/AuroraProjectDatabase'

describe('native polygon operations', () => {
  it('extrudes a selected cap without opening the solid or changing unrelated IDs', () => {
    const original=createModel().draft
    const edited=applyModelOperation(original,1,{type:'extrude',faceId:'f5',distance:2})
    expect(validateMesh(edited.mesh)).toMatchObject({vertices:12,faces:10,boundaryEdges:0})
    expect(original.mesh.vertices).toHaveLength(8)
    const cap=edited.mesh.faces.find(f=>f.id==='f5')!
    expect(facePositions(edited.mesh,cap).every(p=>p[1]===3)).toBe(true)
    expect(faceNormal(facePositions(edited.mesh,cap))).toEqual([0,1,0])
    expect(edited.mesh.faces[0]).toEqual(original.mesh.faces[0])
  })
  it('insets before repeated extrusion, preserving a selectable cap and render mapping', () => {
    let draft=createModel().draft
    draft=applyModelOperation(draft,1,{type:'inset',faceId:'f5',fraction:.2})
    draft=applyModelOperation(draft,2,{type:'extrude',faceId:'f5',distance:1})
    expect(validateMesh(draft.mesh).boundaryEdges).toBe(0)
    const geometry=modelGeometry(draft.mesh)
    expect(geometry.userData.faceIds).toHaveLength(geometry.getAttribute('position').count/3)
    expect(geometry.userData.faceIds.filter((id:string)=>id==='f5')).toHaveLength(2)
    geometry.dispose()
  })
  it('rejects stale selections and invalid edits without mutation', () => {
    const draft=createModel().draft, before=JSON.stringify(draft)
    expect(()=>applyModelOperation(draft,9,{type:'extrude',faceId:'f5',distance:1})).toThrow('Stale')
    expect(()=>applyModelOperation(draft,1,{type:'translate',vertexIds:['missing'],offset:[0,1,0]})).toThrow('Unknown vertex')
    expect(()=>applyModelOperation(draft,1,{type:'scale',factors:[0,1,1]})).toThrow('Scale')
    expect(JSON.stringify(draft)).toBe(before)
  })
  it('published geometry stays immutable when the draft changes', () => {
    const model=createModel(), published=publishModel(model,1)
    model.draft=applyModelOperation(model.draft,1,{type:'scale',factors:[2,3,1]})
    expect(published.mesh.vertices[0]!.position).toEqual([-1,-1,-1])
    expect(model.draft.mesh.vertices[0]!.position).toEqual([-2,-3,-1])
    expect(publishModel(model,2).revision).toBe(2)
  })
})

describe('native project asset workflow', () => {
  beforeEach(()=>setActivePinia(createPinia()))
  it('publishes, places, updates selected copies, makes unique, and roundtrips source', () => {
    const store=useEditorStore(), asset=store.createNativeModel('Pillar')
    store.publishNativeModel(asset.id)
    const first=store.add3DModel(asset.id)!, second=store.add3DModel(asset.id)!
    expect(first.primitive).toBe('native')
    store.editNativeModel(asset.id,1,{type:'extrude',faceId:'f5',distance:3})
    store.publishNativeModel(asset.id)
    store.updateNativeModelInstance(first.id)
    expect(first.modelRevision).toBe(2)
    expect(second.modelRevision).toBe(1)
    const unique=store.makeNativeModelUnique(second.id)
    expect(second.assetId).toBe(unique.id)
    expect(unique.nativeModel!.draft.mesh.vertices).toHaveLength(8)
    const state={project:store.project,layers:store.layers,scenes3D:store.scenes3D,assets:store.assets,nodes:store.nodes,nodeConnections:store.nodeConnections,rigs:store.rigs}
    const restored=deserializeEditorState(serializeEditorState(state),state)
    expect(restored.assets.find(a=>a.id===asset.id)?.nativeModel).toEqual(JSON.parse(JSON.stringify(asset.nativeModel)))
    expect(restored.scenes3D[0]!.objects.find(o=>o.id===first.id)?.modelRevision).toBe(2)
  })
  it('undoes a modeling operation and restores the polygon source on redo', () => {
    const store=useEditorStore(), asset=store.createNativeModel()
    store.editNativeModel(asset.id,1,{type:'extrude',faceId:'f5',distance:1})
    store.undo()
    expect(store.assets.find(a=>a.id===asset.id)?.nativeModel!.draft.mesh.faces).toHaveLength(6)
    store.redo()
    expect(store.assets.find(a=>a.id===asset.id)?.nativeModel!.draft.mesh.faces).toHaveLength(10)
  })
  it('renders pinned geometry and invalidates the runtime when the instance revision changes', () => {
    const store=useEditorStore(), asset=store.createNativeModel()
    store.publishNativeModel(asset.id)
    const object=store.add3DModel(asset.id)!, registry=new ThreeSceneRuntimeRegistry()
    const before=registry.get(store.selectedScene!,640,360,0,store.assets)
    const mesh=before.objects.get(object.id) as THREE.Mesh
    expect(mesh.geometry.getAttribute('position').count).toBe(36)
    store.editNativeModel(asset.id,1,{type:'extrude',faceId:'f5',distance:3})
    store.publishNativeModel(asset.id)
    const pinned=registry.get(store.selectedScene!,640,360,0,store.assets)
    expect((pinned.objects.get(object.id) as THREE.Mesh).geometry.getAttribute('position').count).toBe(36)
    store.updateNativeModelInstance(object.id)
    const updated=registry.get(store.selectedScene!,640,360,0,store.assets)
    expect((updated.objects.get(object.id) as THREE.Mesh).geometry.getAttribute('position').count).toBe(60)
    expect(store.deleteMediaAsset(asset.id)).toBe(false)
    registry.dispose()
  })
  it('retains source and published revisions across IndexedDB close and reopen', async () => {
    Dexie.dependencies.indexedDB=indexedDB
    Dexie.dependencies.IDBKeyRange=IDBKeyRange
    const store=useEditorStore(), asset=store.createNativeModel('Persistent Pillar')
    store.editNativeModel(asset.id,1,{type:'extrude',faceId:'f5',distance:3})
    store.publishNativeModel(asset.id)
    const name=`model-test-${crypto.randomUUID()}`
    const database=new AuroraProjectDatabase(name)
    try {
      await database.saveSnapshot(JSON.parse(serializeEditorState({project:store.project,layers:store.layers,scenes3D:store.scenes3D,assets:store.assets,nodes:store.nodes,nodeConnections:store.nodeConnections,rigs:store.rigs})))
      database.close()
      await database.open()
      const restored=await database.loadSnapshot(store.project.id)
      expect(restored!.assets.find(a=>a.id===asset.id)!.nativeModel!.revisions[0]!.mesh.faces).toHaveLength(10)
    } finally {await database.delete()}
  })
})
