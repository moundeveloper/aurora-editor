import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createModel, applyModelOperation, modelOperationResult, validateMesh, type ModelDraft, type ModelOperation } from '../../../../shared/modeling'
import { topologyEdgeKey } from '../../../../shared/loopCut'
import { useEditorStore } from '@/stores/editor'
import { serializeEditorState, deserializeEditorState } from '@/engine/project/serialization'
const apply = (draft: ModelDraft, op: ModelOperation) => applyModelOperation(draft, draft.revision, op)
const triangulated = () => apply(createModel('plane').draft, {type:'connect-path',vertexIds:['v0','v2']})

describe('edge rotation', () => {
  it('flips a diagonal, preserves winding and face IDs, and selects the replacement', () => {
    const base=triangulated(), result=modelOperationResult(base,2,{type:'rotate-edge',edgeIds:[topologyEdgeKey('v0','v2')]})
    expect(validateMesh(result.draft.mesh)).toEqual(validateMesh(base.mesh))
    expect(result.selection.edge).toEqual([topologyEdgeKey('v1','v3')])
    expect(result.deleted.edge).toEqual([topologyEdgeKey('v0','v2')])
    expect(result.draft.mesh.faces.map(f=>f.id)).toEqual(base.mesh.faces.map(f=>f.id))
    const back=apply(result.draft,{type:'rotate-edge',edgeIds:result.selection.edge})
    expect(back.mesh.faces.every(f=>f.vertices.includes('v0')&&f.vertices.includes('v2'))).toBe(true)
  })
  it('rejects boundaries, quads, unknown edges and duplicate input', () => {
    const base=triangulated(), edge=topologyEdgeKey('v0','v2')
    expect(()=>apply(base,{type:'rotate-edge',edgeIds:[topologyEdgeKey('v0','v1')]})).toThrow(/interior/)
    expect(()=>apply(createModel().draft,{type:'rotate-edge',edgeIds:[topologyEdgeKey('v0','v1')]})).toThrow(/triangles/)
    expect(()=>apply(base,{type:'rotate-edge',edgeIds:['missing']})).toThrow(/interior/)
    expect(()=>apply(base,{type:'rotate-edge',edgeIds:[edge,edge]})).toThrow(/distinct/)
  })
  it('rejects folded surfaces and rolls back a batch whose later edge fails', () => {
    const base=triangulated(), before=JSON.stringify(base)
    expect(()=>apply(base,{type:'rotate-edge',edgeIds:[topologyEdgeKey('v0','v2'),'missing']})).toThrow()
    expect(JSON.stringify(base)).toBe(before)
    base.mesh.vertices[1]!.position[1]=.5
    expect(()=>apply(base,{type:'rotate-edge',edgeIds:[topologyEdgeKey('v0','v2')]})).toThrow(/coplanar/)
  })
  it('rejects a diagonal outside a concave triangle pair', () => {
    const base=triangulated();base.mesh.vertices[2]!.position=[-.5,0,-.5]
    validateMesh(base.mesh)
    expect(()=>apply(base,{type:'rotate-edge',edgeIds:[topologyEdgeKey('v0','v2')]})).toThrow(/outside/)
  })
})

describe('face region split and rip', () => {
  it('duplicates only shared vertices and retains selected face IDs', () => {
    const base=createModel().draft,result=modelOperationResult(base,1,{type:'split',faceIds:['f5']})
    expect(validateMesh(result.draft.mesh)).toMatchObject({vertices:12,faces:6,boundaryEdges:8})
    expect(result.selection.face).toEqual(['f5'])
    expect(result.created.vertex).toHaveLength(4)
    expect(result.draft.mesh.faces.filter(f=>f.id!=='f5')).toEqual(base.mesh.faces.filter(f=>f.id!=='f5'))
    expect(base.mesh.vertices).toHaveLength(8)
  })
  it('keeps adjoining selected faces connected and moves the whole region', () => {
    const base=createModel().draft,result=apply(base,{type:'rip',faceIds:['f1','f5'],offset:[0,2,0]})
    expect(validateMesh(result.mesh)).toMatchObject({vertices:14,faces:6,boundaryEdges:12})
    const faces=result.mesh.faces.filter(f=>['f1','f5'].includes(f.id))
    expect(faces[0]!.vertices.filter(id=>faces[1]!.vertices.includes(id))).toHaveLength(2)
    expect(result.mesh.vertices.filter(v=>faces.some(f=>f.vertices.includes(v.id))).every(v=>v.position[1]>=1)).toBe(true)
    expect(result.mesh.vertices.slice(0,8)).toEqual(base.mesh.vertices)
  })
  it('moves interior vertices as well as duplicated boundary vertices', () => {
    const base=apply(createModel().draft,{type:'poke',faceIds:['f5'],offset:0})
    const ids=base.mesh.faces.filter(f=>f.id==='f5'||!createModel().draft.mesh.faces.some(old=>old.id===f.id)).map(f=>f.id)
    const result=apply(base,{type:'rip',faceIds:ids,offset:[0,1,0]})
    const center=base.mesh.vertices.find(v=>v.id==='v20')!
    expect(result.mesh.vertices.find(v=>v.id===center.id)!.position).toEqual([0,2,0])
    expect(result.mesh.vertices).toHaveLength(base.mesh.vertices.length+4)
  })
  it('rejects disconnected, stale, repeated selections and zero rip offsets atomically', () => {
    const base=createModel().draft,before=JSON.stringify(base)
    expect(()=>apply(base,{type:'split',faceIds:base.mesh.faces.map(f=>f.id)})).toThrow(/already disconnected/)
    expect(()=>apply(base,{type:'split',faceIds:['missing']})).toThrow(/Unknown/)
    expect(()=>apply(base,{type:'split',faceIds:['f0','f0']})).toThrow(/distinct/)
    expect(()=>apply(base,{type:'rip',faceIds:['f5'],offset:[0,0,0]})).toThrow(/nonzero/)
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('poke faces', () => {
  it.each([0,.5,-.5])('creates watertight fans with offset %s', offset => {
    const base=createModel().draft,result=modelOperationResult(base,1,{type:'poke',faceIds:base.mesh.faces.map(f=>f.id),offset})
    expect(validateMesh(result.draft.mesh)).toMatchObject({vertices:14,faces:24,boundaryEdges:0})
    expect(result.selection.face).toHaveLength(24)
    expect(result.draft.mesh.faces.every(f=>f.vertices.length===3)).toBe(true)
    expect(result.undo).toEqual(base)
  })
  it('rejects bent quads without changing the draft', () => {
    const base=createModel('plane').draft;base.mesh.vertices[0]!.position[1]=.5
    const before=JSON.stringify(base)
    expect(()=>apply(base,{type:'poke',faceIds:['f0'],offset:0})).toThrow(/coplanar/)
    expect(JSON.stringify(base)).toBe(before)
  })
  it('persists and undoes a complete construction operation', () => {
    setActivePinia(createPinia());const store=useEditorStore(), asset=store.createNativeModel('cube')
    if(!asset)throw new Error('Missing model')
    const original=JSON.stringify(asset.nativeModel!.draft)
    store.editNativeModel(asset.id,1,{type:'poke',faceIds:['f5'],offset:.25})
    const edited=JSON.stringify(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft)
    const state={project:store.project,layers:store.layers,scenes3D:store.scenes3D,assets:store.assets,nodes:store.nodes,nodeConnections:store.nodeConnections,rigs:store.rigs}
    const loaded=deserializeEditorState(serializeEditorState(state),state).assets.find(a=>a.id===asset.id)!.nativeModel!.draft
    expect(loaded).toEqual(JSON.parse(edited))
    expect(JSON.parse(edited).mesh.faces).toHaveLength(9)
    store.undo();expect(JSON.stringify(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft)).toBe(original)
    store.redo();expect(JSON.stringify(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft)).toBe(edited)
    expect(validateMesh(JSON.parse(edited).mesh)).toMatchObject({boundaryEdges:0})
  })
})
