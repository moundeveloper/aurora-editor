import { faceNormal, facePositions, validateMesh, type ModelMesh, type Vec3 } from './modeling.ts'
import { boundaryRings, meshTopology } from './meshTopology.ts'

export function mergeVertices(mesh: ModelMesh, ids: string[], method: 'distance' | 'center' | 'first' | 'last', distance: number) {
  const byId = new Map(mesh.vertices.map(v => [v.id, v])), unique = [...new Set(ids)]
  if (unique.some(id => !byId.has(id))) throw new Error('Unknown vertex in selection')
  if (unique.length < 2) throw new Error('Select at least two vertices to merge')
  const parent = new Map(unique.map(id => [id, id]))
  const root = (id: string): string => {
    let current = id
    while (parent.get(current) !== current) current = parent.get(current)!
    while (id !== current) { const next = parent.get(id)!; parent.set(id, current); id = next }
    return current
  }
  if (method === 'distance') {
    // Spatial hashing keeps ordinary welding linear in the selection size.
    const buckets = new Map<string, string[]>()
    for (const id of unique) {
      const p = byId.get(id)!.position, cell = p.map(n => Math.floor(n / distance))
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        for (const other of buckets.get(`${cell[0]! + x},${cell[1]! + y},${cell[2]! + z}`) ?? []) {
          const q = byId.get(other)!.position
          if (Math.hypot(...p.map((n, axis) => n - q[axis]!)) <= distance) parent.set(root(id), root(other))
        }
      }
      const key = cell.join(','), bucket = buckets.get(key) ?? []
      bucket.push(id); buckets.set(key, bucket)
    }
  } else {
    const survivor = method === 'last' ? unique.at(-1)! : unique[0]!
    for (const id of unique) parent.set(id, survivor)
    if (method === 'center') byId.get(survivor)!.position = [0, 1, 2].map(axis => unique.reduce((sum, id) => sum + byId.get(id)!.position[axis]!, 0) / unique.length) as Vec3
  }
  const remap = new Map(unique.map(id => [id, root(id)]))
  if (unique.every(id => remap.get(id) === id)) throw new Error('No vertices within the merge distance')
  mesh.vertices = mesh.vertices.filter(v => !remap.has(v.id) || remap.get(v.id) === v.id)
  const polygons = new Set<string>()
  mesh.faces = mesh.faces.flatMap(face => {
    const mapped = face.vertices.map(id => remap.get(id) ?? id)
    const vertices = mapped.filter((id, i) => id !== mapped[(i + mapped.length - 1) % mapped.length])
    if (vertices.length < 3) return []
    if (new Set(vertices).size !== vertices.length) throw new Error('Merge would pinch a face; choose a smaller selection')
    const key = [...vertices].sort().join(',')
    if (polygons.has(key)) return []
    polygons.add(key)
    return [{ ...face, vertices }]
  })
}

export function dissolveElements(mesh: ModelMesh, mode: 'vertex' | 'edge' | 'face', ids: string[]) {
  const selected = new Set(ids), topology = meshTopology(mesh)
  if (mode === 'vertex') {
    if ([...selected].some(id => !topology.vertexEdges.has(id))) throw new Error('Unknown vertex in selection')
    // Removing a degree-two point preserves every incident surface. Junctions require edge/face dissolve.
    if ([...selected].some(id => topology.vertexEdges.get(id)!.size !== 2)) throw new Error('Vertex dissolve requires degree-two vertices; dissolve edges or faces at junctions')
    const positions = new Map(mesh.vertices.map(v => [v.id, v.position]))
    for (const id of selected) {
      const neighbors = [...topology.vertexEdges.get(id)!].map(key => topology.edges.get(key)![0]!).map(use => use.from === id ? use.to : use.from)
      const p = positions.get(id)!, a = positions.get(neighbors[0]!)!, b = positions.get(neighbors[1]!)!
      const ab = Math.hypot(...a.map((n, i) => n - b[i]!))
      if (Math.abs(Math.hypot(...p.map((n, i) => n - a[i]!)) + Math.hypot(...p.map((n, i) => n - b[i]!)) - ab) > 1e-7) throw new Error('Vertex dissolve requires collinear points to preserve the boundary')
    }
    for (const face of mesh.faces) face.vertices = face.vertices.filter(id => !selected.has(id))
    mesh.vertices = mesh.vertices.filter(v => !selected.has(v.id))
    return
  }
  const faceMap = new Map(mesh.faces.map(f => [f.id, f]))
  if ([...selected].some(id => !(mode === 'edge' ? topology.edges : faceMap).has(id))) throw new Error(`Unknown ${mode} in selection`)
  const joins = new Map<string, Set<string>>()
  for (const [id, uses] of topology.edges) {
    const chosen = mode === 'edge' ? selected.has(id) : uses.length === 2 && uses.every(use => selected.has(use.faceId))
    if (!chosen) continue
    if (uses.length !== 2) throw new Error('Dissolve requires interior edges shared by two faces')
    const a = uses[0]!.faceId, b = uses[1]!.faceId
    if (!joins.has(a)) joins.set(a, new Set())
    if (!joins.has(b)) joins.set(b, new Set())
    joins.get(a)!.add(b); joins.get(b)!.add(a)
  }
  if (!joins.size) throw new Error('Select interior edges or adjacent faces to dissolve')
  const visited = new Set<string>(), removed = new Set<string>()
  for (const seed of joins.keys()) {
    if (visited.has(seed)) continue
    const group = [seed]; visited.add(seed)
    for (let i = 0; i < group.length; i++) for (const next of joins.get(group[i]!) ?? []) if (!visited.has(next)) { visited.add(next); group.push(next) }
    const region = new Set(group)
    const border = [...topology.edges.values()].flatMap(uses => {
      const inside = uses.filter(use => region.has(use.faceId))
      return inside.length === 1 ? inside : []
    })
    const rings = boundaryRings(border)
    if (rings.length !== 1) throw new Error('Dissolve requires a region with one boundary and no holes')
    const vertices = rings[0]!, points = vertices.map(id => mesh.vertices.find(v => v.id === id)!.position)
    const normal = faceNormal(points), origin = points[0]!
    const regionVertices = new Set(group.flatMap(id => faceMap.get(id)!.vertices))
    if (mesh.vertices.some(v => regionVertices.has(v.id) && Math.abs(v.position.reduce((s, n, i) => s + (n - origin[i]!) * normal[i]!, 0)) > 1e-5)) throw new Error('Dissolve requires coplanar faces to preserve the surface')
    // All shared edges in this region disappear. Do not silently dissolve unselected seams.
    if (mode === 'edge' && [...topology.edges].some(([id, uses]) => uses.length === 2 && uses.every(u => region.has(u.faceId)) && !selected.has(id))) throw new Error('Select all internal edges of the region to dissolve')
    faceMap.get(seed)!.vertices = vertices
    group.slice(1).forEach(id => removed.add(id))
  }
  mesh.faces = mesh.faces.filter(f => !removed.has(f.id))
  // Only remove vertices orphaned by this operation; unrelated loose geometry stays intact.
  const used = new Set(mesh.faces.flatMap(f => f.vertices))
  mesh.vertices = mesh.vertices.filter(v => used.has(v.id) || !topology.vertexFaces.get(v.id)!.size)
}

export function fillBoundaries(mesh: ModelMesh, mode: 'vertex' | 'edge', ids: string[], style: 'polygon' | 'triangles' | 'grid', all = false) {
  const topology = meshTopology(mesh), selected = new Set(ids)
  if (!all && [...selected].some(id => !(mode === 'edge' ? topology.edges : topology.vertexEdges).has(id))) throw new Error(`Unknown ${mode} in selection`)
  const boundary = [...topology.edges].filter(([id, uses]) => uses.length === 1 && (all || (mode === 'edge' ? selected.has(id) : selected.has(uses[0]!.from) && selected.has(uses[0]!.to))))
  if (!boundary.length) throw new Error('Select a closed open boundary to fill')
  if (!all) {
    const covered = new Set(boundary.flatMap(([id, uses]) => mode === 'edge' ? [id] : [uses[0]!.from, uses[0]!.to]))
    if ([...selected].some(id => !covered.has(id))) throw new Error('Fill selection must contain only boundary elements')
  }
  // Reverse the existing half-edges so the patch has consistent winding.
  const rings = boundaryRings(boundary.map(([, uses]) => ({ ...uses[0]!, from: uses[0]!.to, to: uses[0]!.from })))
  for (const vertices of rings) {
    if (mesh.faces.some(f => f.vertices.length === vertices.length && f.vertices.every(id => vertices.includes(id)))) throw new Error('Boundary already has a face; fill would create a duplicate surface')
    if (style === 'grid') { gridPatch(mesh, vertices); continue }
    if (style === 'polygon') mesh.faces.push({ id: `f${mesh.nextId++}`, vertices })
    else {
      // A center fan supports convex planar holes and collinear subdivided boundary edges.
      validateMesh({ ...mesh, faces: [{ id: `f${mesh.nextId}`, vertices }] })
      const points = facePositions(mesh, { id: '', vertices }), normal = faceNormal(points)
      const origin = points[0]!
      if (points.some(p => Math.abs(p.reduce((s, n, i) => s + (n - origin[i]!) * normal[i]!, 0)) > 1e-5)) throw new Error('Triangle fill requires a planar boundary')
      const center = `v${mesh.nextId++}`
      mesh.vertices.push({ id: center, position: [0, 1, 2].map(axis => points.reduce((s, p) => s + p[axis]!, 0) / points.length) as Vec3 })
      vertices.forEach((id, i) => mesh.faces.push({ id: `f${mesh.nextId++}`, vertices: [id, vertices[(i + 1) % vertices.length]!, center] }))
    }
  }
}

/** Coons patch on four equally sampled sides; each boundary edge is reused exactly once. */
function gridPatch(mesh: ModelMesh, ring: string[]) {
  if (ring.length % 4 !== 0) throw new Error('Grid fill requires a boundary with 4, 8, 12, … vertices and four equally sampled sides')
  const n = ring.length / 4
  if (mesh.vertices.length + (n - 1) ** 2 > 12000 || mesh.faces.length + n ** 2 > 12000) throw new Error('Grid fill would exceed the model geometry limit')
  const positions = new Map(mesh.vertices.map(v => [v.id, v.position]))
  const at = (i: number) => ring[(i + ring.length) % ring.length]!
  const grid = new Map<string, string>()
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
    let id = y === 0 ? at(x) : x === n ? at(n + y) : y === n ? at(3 * n - x) : x === 0 ? at(4 * n - y) : ''
    if (!id) {
      const u = x / n, v = y / n
      const bottom = positions.get(at(x))!, right = positions.get(at(n + y))!, top = positions.get(at(3 * n - x))!, left = positions.get(at(4 * n - y))!
      const corners = [0, n, 2 * n, 3 * n].map(i => positions.get(at(i))!)
      const position = [0, 1, 2].map(a => (1 - v) * bottom[a]! + v * top[a]! + (1 - u) * left[a]! + u * right[a]! - ((1 - u) * (1 - v) * corners[0]![a]! + u * (1 - v) * corners[1]![a]! + u * v * corners[2]![a]! + (1 - u) * v * corners[3]![a]!)) as Vec3
      id = `v${mesh.nextId++}`; mesh.vertices.push({ id, position })
    }
    grid.set(`${x},${y}`, id)
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) mesh.faces.push({ id: `f${mesh.nextId++}`, vertices: [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([a, b]) => grid.get(`${a},${b}`)!) })
}

export function deleteLooseVertices(mesh: ModelMesh) {
  const used = new Set(mesh.faces.flatMap(f => f.vertices))
  if (mesh.vertices.every(v => used.has(v.id))) throw new Error('No loose vertices to remove')
  mesh.vertices = mesh.vertices.filter(v => used.has(v.id))
}
