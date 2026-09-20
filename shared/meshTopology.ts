import type { ModelMesh } from './modeling.ts'
import { topologyEdgeKey } from './loopCut.ts'

export interface MeshCorner { id: string; faceId: string; from: string; to: string }
/** Authored adjacency. Edge IDs and corner IDs survive unrelated edits; GPU diagonals never enter this index. */
export function meshTopology(mesh: ModelMesh) {
  const edges = new Map<string, MeshCorner[]>()
  const vertexEdges = new Map(mesh.vertices.map(v => [v.id, new Set<string>()]))
  const vertexFaces = new Map(mesh.vertices.map(v => [v.id, new Set<string>()]))
  for (const face of mesh.faces) face.vertices.forEach((from, index) => {
    const to = face.vertices[(index + 1) % face.vertices.length]!
    const key = topologyEdgeKey(from, to)
    const uses = edges.get(key) ?? []
    uses.push({ id: JSON.stringify([face.id, from]), faceId: face.id, from, to })
    edges.set(key, uses)
    vertexEdges.get(from)?.add(key); vertexEdges.get(to)?.add(key)
    vertexFaces.get(from)?.add(face.id)
  })
  return { edges, vertexEdges, vertexFaces }
}

/** Follow directed, non-branching rings. Reject partial/ambiguous boundaries instead of guessing. */
export function boundaryRings(corners: MeshCorner[]): string[][] {
  const next = new Map<string, string>(), incoming = new Set<string>()
  for (const { from, to } of corners) {
    if (next.has(from) || incoming.has(to)) throw new Error('Boundary branches or touches itself; select a simple closed loop')
    next.set(from, to); incoming.add(to)
  }
  if ([...next.keys()].some(id => !incoming.has(id))) throw new Error('Select a complete closed boundary loop')
  const rings: string[][] = []
  while (next.size) {
    const start = next.keys().next().value!, ring: string[] = []
    let current = start
    do {
      ring.push(current)
      const to = next.get(current)
      if (!to) throw new Error('Select a complete closed boundary loop')
      next.delete(current); current = to
    } while (current !== start)
    if (ring.length < 3) throw new Error('Boundary must have at least three vertices')
    rings.push(ring)
  }
  return rings
}
