import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { applyModelOperation, createModel, modelOperationResult, validateMesh, type ModelDraft, type ModelOperation } from '../../../../shared/modeling'
import { meshTopology } from '../../../../shared/meshTopology'
import { topologyEdgeKey } from '../../../../shared/loopCut'
import { useEditorStore } from '@/stores/editor'
import { serializeEditorState, deserializeEditorState } from '@/engine/project/serialization'

const apply = (draft: ModelDraft, operation: ModelOperation) => applyModelOperation(draft, draft.revision, operation)
const openCube = () => apply(createModel().draft, { type: 'delete', mode: 'face', ids: ['f5'] })
const boundary = (draft: ModelDraft) => [...meshTopology(draft.mesh).edges].filter(([, uses]) => uses.length === 1).map(([id]) => id)

describe('topology repair', () => {
  it.each(['polygon', 'triangles', 'grid'] as const)('repairs a deleted cube cap with %s fill and consistent winding', style => {
    const draft = openCube(), before = JSON.stringify(draft)
    const result = modelOperationResult(draft, draft.revision, { type: 'fill', mode: 'edge', ids: boundary(draft), style })
    expect(validateMesh(result.draft.mesh).boundaryEdges).toBe(0)
    expect(result.created.face).toHaveLength(style === 'triangles' ? 4 : 1)
    expect(result.undo).toEqual(draft)
    expect(JSON.stringify(draft)).toBe(before)
    expect(result.draft.mesh.faces.slice(0, 5)).toEqual(draft.mesh.faces)
  })

  it('fills multiple holes atomically', () => {
    const draft = apply(createModel().draft, { type: 'delete', mode: 'face', ids: ['f0', 'f1'] })
    expect(validateMesh(apply(draft, { type: 'fill-holes', style: 'polygon' }).mesh).boundaryEdges).toBe(0)
  })

  it('creates a true quad grid with a shared center on an eight-vertex opening', () => {
    const draft = openCube(), mesh = draft.mesh
    for (const [i, key] of boundary(draft).entries()) {
      const use = meshTopology(mesh).edges.get(key)![0]!, a = mesh.vertices.find(v => v.id === use.from)!, b = mesh.vertices.find(v => v.id === use.to)!
      const id = `mid${i}`
      mesh.vertices.push({ id, position: [(a.position[0] + b.position[0]) / 2, (a.position[1] + b.position[1]) / 2, (a.position[2] + b.position[2]) / 2] })
      const face = mesh.faces.find(f => f.id === use.faceId)!
      face.vertices.splice(face.vertices.indexOf(use.from) + 1, 0, id)
    }
    const result = apply(draft, { type: 'fill-holes', style: 'grid' })
    expect(validateMesh(result.mesh)).toMatchObject({ vertices: 13, faces: 9, boundaryEdges: 0 })
    expect(result.mesh.faces.slice(5).every(f => f.vertices.length === 4)).toBe(true)
  })

  it('rejects partial, stale, duplicate-surface and unsuitable grid boundaries without mutation', () => {
    const draft = openCube(), before = JSON.stringify(draft)
    expect(() => apply(draft, { type: 'fill', mode: 'edge', ids: boundary(draft).slice(0, 3), style: 'polygon' })).toThrow(/complete closed/)
    expect(() => apply(draft, { type: 'fill', mode: 'vertex', ids: ['v0', 'v1', 'missing'], style: 'polygon' })).toThrow(/Unknown/)
    expect(() => apply(createModel('plane').draft, { type: 'fill-holes', style: 'polygon' })).toThrow(/duplicate surface/)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('dissolves a Knife seam and preserves the original surface and surrounding IDs', () => {
    const base = createModel().draft
    const cut = apply(base, { type: 'knife', faceId: 'f5', start: { edge: ['v3', 'v2'], t: .5 }, end: { edge: ['v7', 'v6'], t: .5 } })
    const created = cut.mesh.vertices.filter(v => !base.mesh.vertices.some(old => old.id === v.id)).map(v => v.id)
    const seam = topologyEdgeKey(created[0]!, created[1]!)
    const result = modelOperationResult(cut, cut.revision, { type: 'dissolve', mode: 'edge', ids: [seam] })
    expect(validateMesh(result.draft.mesh)).toMatchObject({ faces: 6, boundaryEdges: 0 })
    expect(result.deleted.edge).toContain(seam)
    expect(result.selection.face).toEqual(['f5'])
    expect(result.draft.mesh.faces.find(f => f.id === 'f5')!.vertices).toHaveLength(6)
    expect(result.draft.mesh.faces.filter(f => f.id !== 'f5')).toEqual(cut.mesh.faces.filter(f => f.id !== 'f5' && base.mesh.faces.some(old => old.id === f.id)))
  })

  it('dissolves adjacent coplanar faces and refuses folded cube faces', () => {
    const plane = apply(createModel('plane').draft, { type: 'loop-cut', edge: ['v0', 'v1'], cuts: 1, position: .5 })
    expect(apply(plane, { type: 'dissolve', mode: 'face', ids: plane.mesh.faces.map(f => f.id) }).mesh.faces).toHaveLength(1)
    expect(() => apply(createModel().draft, { type: 'dissolve', mode: 'face', ids: ['f1', 'f5'] })).toThrow(/coplanar/)
    expect(() => apply(createModel('plane').draft, { type: 'dissolve', mode: 'edge', ids: [topologyEdgeKey('v0', 'v1')] })).toThrow(/interior/)
  })

  it('dissolves collinear boundary vertices but refuses junctions and corners', () => {
    let draft = apply(createModel('plane').draft, { type: 'loop-cut', edge: ['v0', 'v1'], cuts: 1, position: .5 })
    const added = draft.mesh.vertices.filter(v => !['v0', 'v1', 'v2', 'v3'].includes(v.id)).map(v => v.id)
    draft = apply(draft, { type: 'dissolve', mode: 'face', ids: draft.mesh.faces.map(f => f.id) })
    const result = apply(draft, { type: 'dissolve', mode: 'vertex', ids: added })
    expect(validateMesh(result.mesh)).toMatchObject({ vertices: 4, faces: 1 })
    expect(() => apply(createModel().draft, { type: 'dissolve', mode: 'vertex', ids: ['v0'] })).toThrow(/degree-two/)
    expect(() => apply(createModel('plane').draft, { type: 'dissolve', mode: 'vertex', ids: ['v0'] })).toThrow(/collinear/)
  })

  it.each(['first', 'last', 'center'] as const)('merges at %s using explicit selection order', method => {
    const draft = createModel('plane').draft
    const result = apply(draft, { type: 'merge', vertexIds: ['v1', 'v0'], method, distance: .001 })
    expect(validateMesh(result.mesh)).toMatchObject({ vertices: 3, faces: 1 })
    const survivor = method === 'last' ? 'v0' : 'v1'
    expect(result.mesh.vertices.find(v => v.id === survivor)!.position).toEqual(method === 'center' ? [-1, 0, 0] : draft.mesh.vertices.find(v => v.id === survivor)!.position)
    expect(result.mesh.faces[0]!.vertices).toHaveLength(3)
  })

  it('welds disconnected touching surfaces by distance without moving unselected vertices', () => {
    const draft = createModel('plane').draft
    draft.mesh.vertices.push({ id: 'a', position: [1, 0, -1] }, { id: 'b', position: [1, 0, 1] }, { id: 'c', position: [3, 0, 1] }, { id: 'd', position: [3, 0, -1] })
    draft.mesh.faces.push({ id: 'other', vertices: ['a', 'b', 'c', 'd'] })
    const result = apply(draft, { type: 'merge', method: 'distance', vertexIds: ['v2', 'v3', 'a', 'b'], distance: .001 })
    expect(validateMesh(result.mesh)).toMatchObject({ vertices: 6, faces: 2, boundaryEdges: 6 })
    expect(result.mesh.vertices.find(v => v.id === 'c')!.position).toEqual([3, 0, 1])
    expect(() => apply(draft, { type: 'merge', method: 'distance', vertexIds: ['v0', 'v1'], distance: .001 })).toThrow(/No vertices/)
  })

  it('rejects pinching and destructive merges atomically and reports loose cleanup', () => {
    const draft = createModel('plane').draft, before = JSON.stringify(draft)
    expect(() => apply(draft, { type: 'merge', method: 'center', vertexIds: ['v0', 'v2'], distance: .001 })).toThrow(/pinch/)
    expect(() => apply(draft, { type: 'merge', method: 'first', vertexIds: ['v0', 'v1', 'v2', 'v3'], distance: .001 })).toThrow()
    expect(JSON.stringify(draft)).toBe(before)
    draft.mesh.vertices.push({ id: 'loose', position: [3, 2, 1] })
    const result = modelOperationResult(draft, 1, { type: 'delete-loose' })
    expect(result.deleted.vertex).toEqual(['loose'])
    expect(result.draft.mesh.faces).toEqual(draft.mesh.faces)
  })

  it('commits a repair as one undo step and persists the repaired source', () => {
    setActivePinia(createPinia())
    const store = useEditorStore(), asset = store.createNativeModel()
    store.editNativeModel(asset.id, 1, { type: 'delete', mode: 'face', ids: ['f5'] })
    const before = JSON.stringify(asset.nativeModel!.draft)
    const preview = modelOperationResult(asset.nativeModel!.draft, 2, { type: 'fill-holes', style: 'grid' })
    expect(JSON.stringify(asset.nativeModel!.draft)).toBe(before)
    store.editNativeModel(asset.id, 2, { type: 'fill-holes', style: 'grid' })
    expect(asset.nativeModel!.draft).toEqual(preview.draft)
    store.undo()
    expect(JSON.stringify(store.assets.find(a => a.id === asset.id)!.nativeModel!.draft)).toBe(before)
    store.redo()
    const state = { project: store.project, layers: store.layers, scenes3D: store.scenes3D, assets: store.assets, nodes: store.nodes, nodeConnections: store.nodeConnections, rigs: store.rigs }
    const restored = deserializeEditorState(serializeEditorState(state), state)
    expect(restored.assets.find(a => a.id === asset.id)!.nativeModel!.draft).toEqual(preview.draft)
  })
})
