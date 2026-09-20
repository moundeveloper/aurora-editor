import { faceNormal, facePositions, type ModelMesh, type Vec3 } from './modeling.ts'
import { meshTopology } from './meshTopology.ts'
import { topologyEdgeKey } from './loopCut.ts'

function selectedFaces(mesh: ModelMesh, ids: string[]) {
  const selected = new Set(ids)
  if (!selected.size || selected.size !== ids.length) throw new Error('Select distinct faces')
  const faces = mesh.faces.filter(face => selected.has(face.id))
  if (faces.length !== selected.size) throw new Error('Unknown face; refresh the selection')
  return faces
}

function planar(points: Vec3[], normal = faceNormal(points)) {
  const origin = points[0]!
  if (points.some(p => Math.abs(p.reduce((sum, n, i) => sum + (n - origin[i]!) * normal[i]!, 0)) > 1e-5)) {
    throw new Error('This operation requires coplanar faces')
  }
  return normal
}

/** Flip independent triangle diagonals; preserve both source face IDs and boundary winding. */
export function rotateEdges(mesh: ModelMesh, edgeIds: string[]) {
  const topology = meshTopology(mesh), used = new Set<string>()
  const faces = new Map(mesh.faces.map(face => [face.id, face]))
  const positions = new Map(mesh.vertices.map(v => [v.id, v.position]))
  if (new Set(edgeIds).size !== edgeIds.length) throw new Error('Select distinct edges')
  for (const id of edgeIds) {
    const corners = topology.edges.get(id)
    if (!corners || corners.length !== 2) throw new Error('Rotate requires an interior edge shared by two triangles')
    const [a, b] = corners, first = faces.get(a!.faceId)!, second = faces.get(b!.faceId)!
    if (first.vertices.length !== 3 || second.vertices.length !== 3) throw new Error('Rotate requires two triangles')
    if (used.has(first.id) || used.has(second.id)) throw new Error('Rotated edges must not share faces; rotate them separately')
    used.add(first.id); used.add(second.id)
    const from = a!.from, to = a!.to
    const c = first.vertices.find(v => v !== from && v !== to)!, d = second.vertices.find(v => v !== from && v !== to)!
    if (c === d || topology.edges.has(topologyEdgeKey(c, d))) throw new Error('The replacement diagonal already exists')
    // Both new triangles must keep the old normal: this also rejects concave quadrilaterals.
    const oldNormal = faceNormal(facePositions(mesh, first, positions))
    planar([from, to, c, d].map(v => positions.get(v)!), oldNormal)
    const replacements = [[c, d, to], [d, c, from]]
    for (const vertices of replacements) {
      const nextNormal = faceNormal(vertices.map(v => positions.get(v)!))
      if (nextNormal.reduce((sum, n, i) => sum + n * oldNormal[i]!, 0) < .99999) throw new Error('The replacement diagonal lies outside the surface')
    }
    first.vertices = replacements[0]!; second.vertices = replacements[1]!
  }
}

/** Detach the selected side by duplicating only vertices also used by unselected faces. */
export function splitFaceRegion(mesh: ModelMesh, faceIds: string[], offset?: Vec3) {
  const faces = selectedFaces(mesh, faceIds), selected = new Set(faceIds)
  const outside = new Set(mesh.faces.filter(f => !selected.has(f.id)).flatMap(f => f.vertices))
  const inside = new Set(faces.flatMap(f => f.vertices)), duplicates = new Map<string, string>()
  for (const vertex of [...mesh.vertices]) {
    if (!inside.has(vertex.id) || !outside.has(vertex.id)) continue
    const id = `v${mesh.nextId++}`
    duplicates.set(vertex.id, id)
    mesh.vertices.push({ id, position: [...vertex.position] })
  }
  if (!duplicates.size) throw new Error('The selected faces are already disconnected; select a region adjoining unselected faces')
  for (const face of faces) face.vertices = face.vertices.map(id => duplicates.get(id) ?? id)
  if (offset) {
    if (Math.hypot(...offset) < 1e-7) throw new Error('Rip offset must be nonzero')
    const moving = new Set(faces.flatMap(f => f.vertices))
    for (const vertex of mesh.vertices) if (moving.has(vertex.id)) vertex.position = vertex.position.map((n, i) => n + offset[i]!) as Vec3
  }
}

/** Fan triangulation retains the original face ID on one triangle. */
export function pokeFaces(mesh: ModelMesh, faceIds: string[], offset: number) {
  for (const face of selectedFaces(mesh, faceIds)) {
    const points = facePositions(mesh, face), normal = planar(points)
    const position = points.reduce<Vec3>((sum, p) => sum.map((n, i) => n + p[i]! / points.length) as Vec3, [0, 0, 0])
    const id = `v${mesh.nextId++}`, boundary = [...face.vertices]
    mesh.vertices.push({ id, position: position.map((n, i) => n + offset * normal[i]!) as Vec3 })
    boundary.forEach((from, i) => {
      const vertices = [from, boundary[(i + 1) % boundary.length]!, id]
      if (i === 0) face.vertices = vertices
      else mesh.faces.push({ id: `f${mesh.nextId++}`, vertices })
    })
  }
}
