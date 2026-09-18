import { describe, expect, it } from 'vitest'
import { applyModelOperation, createModel, validateMesh } from '../../../../shared/modeling'
import { topologyEdgeKey } from '../../../../shared/loopCut'

describe('edit-mode deletion', () => {
  it('deletes a vertex and its incident faces while preserving the source draft', () => {
    const base = createModel().draft
    const result = applyModelOperation(base, 1, { type: 'delete', mode: 'vertex', ids: ['v0'] })

    expect(result.mesh.vertices.some(vertex => vertex.id === 'v0')).toBe(false)
    expect(result.mesh.faces.every(face => !face.vertices.includes('v0'))).toBe(true)
    expect(result.mesh.faces).toHaveLength(3)
    expect(validateMesh(result.mesh).boundaryEdges).toBeGreaterThan(0)
    expect(base.mesh.vertices).toHaveLength(8)
    expect(base.mesh.faces).toHaveLength(6)
  })

  it('deletes faces and edges by their stable edit-mode IDs', () => {
    const faceDeleted = applyModelOperation(createModel().draft, 1, { type: 'delete', mode: 'face', ids: ['f5'] })
    expect(faceDeleted.mesh.faces).toHaveLength(5)
    expect(faceDeleted.mesh.faces.some(face => face.id === 'f5')).toBe(false)
    expect(validateMesh(faceDeleted.mesh).boundaryEdges).toBe(4)

    const edgeId = topologyEdgeKey('v3', 'v2')
    const edgeDeleted = applyModelOperation(createModel().draft, 1, { type: 'delete', mode: 'edge', ids: [edgeId] })
    expect(edgeDeleted.mesh.faces).toHaveLength(4)
    expect(edgeDeleted.mesh.faces.every(face => !face.vertices.includes('v3') || !face.vertices.includes('v2'))).toBe(true)
    expect(validateMesh(edgeDeleted.mesh).boundaryEdges).toBeGreaterThan(0)
  })

  it('supports multi-delete and rejects unknown or all-face selections atomically', () => {
    const base = createModel().draft
    const multi = applyModelOperation(base, 1, { type: 'delete', mode: 'vertex', ids: ['v0', 'v2'] })
    expect(multi.mesh.faces).toHaveLength(1)
    expect(validateMesh(multi.mesh).boundaryEdges).toBe(4)

    const snapshot = JSON.stringify(base)
    expect(() => applyModelOperation(base, 1, { type: 'delete', mode: 'face', ids: ['f0', 'missing'] })).toThrow(/Unknown face/)
    expect(() => applyModelOperation(base, 1, { type: 'delete', mode: 'face', ids: base.mesh.faces.map(face => face.id) })).toThrow(/Cannot delete all faces/)
    expect(JSON.stringify(base)).toBe(snapshot)
  })
})
