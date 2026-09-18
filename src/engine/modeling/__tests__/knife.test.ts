import { describe, expect, it } from 'vitest'
import { applyModelOperation, createModel, validateMesh } from '../../../../shared/modeling'

describe('knife topology cuts', () => {
  it('cuts a quad between opposite edges and keeps neighboring edge splits shared', () => {
    const base = createModel().draft
    const result = applyModelOperation(base, 1, {
      type: 'knife', faceId: 'f5',
      start: { edge: ['v3', 'v2'], t: .25 },
      end: { edge: ['v7', 'v6'], t: .75 },
    })
    expect(validateMesh(result.mesh)).toMatchObject({ vertices: 10, faces: 7, boundaryEdges: 0 })
    expect(result.mesh.faces.every(face => face.vertices.length >= 4)).toBe(true)
    expect(result.mesh.faces.find(face => face.id === 'f5')!.vertices).toHaveLength(4)
    expect(result.mesh.faces.some(face => face.id === 'f22' && face.vertices.length === 4)).toBe(true)
    expect(base.mesh.vertices).toHaveLength(8)
  })

  it('works from reversed edge endpoints and rejects invalid points atomically', () => {
    const base = createModel().draft
    const before = JSON.stringify(base)
    const reversed = applyModelOperation(base, 1, {
      type: 'knife', faceId: 'f5',
      start: { edge: ['v2', 'v3'], t: .75 },
      end: { edge: ['v6', 'v7'], t: .25 },
    })
    expect(validateMesh(reversed.mesh).boundaryEdges).toBe(0)
    const adjacent = applyModelOperation(base, 1, {
      type: 'knife', faceId: 'f5',
      start: { edge: ['v3', 'v2'], t: .25 }, end: { edge: ['v6', 'v2'], t: .5 },
    })
    expect(validateMesh(adjacent.mesh).boundaryEdges).toBe(0)
    expect(() => applyModelOperation(base, 1, {
      type: 'knife', faceId: 'f5',
      start: { edge: ['v3', 'v2'], t: .001 }, end: { edge: ['v7', 'v6'], t: .5 },
    })).toThrow(/inside/)
    expect(JSON.stringify(base)).toBe(before)
  })

  it('splits multiple faces from one through-path while sharing a common edge point', () => {
    const base = createModel().draft
    const result = applyModelOperation(base, 1, {
      type: 'knife', through: true, segments: [
        { faceId: 'f5', start: { edge: ['v3', 'v2'], t: .25 }, end: { edge: ['v7', 'v6'], t: .75 } },
        { faceId: 'f0', start: { edge: ['v3', 'v2'], t: .25 }, end: { edge: ['v0', 'v1'], t: .75 } },
      ],
    })
    expect(validateMesh(result.mesh).boundaryEdges).toBe(0)
    expect(result.mesh.faces).toHaveLength(8)
    expect(result.mesh.vertices).toHaveLength(11)
  })
})
