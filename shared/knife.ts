import type { ModelMesh } from './modeling.ts'
import { topologyEdgeKey } from './loopCut.ts'

export interface KnifePoint { edge: [string, string]; t: number }
export interface KnifeSegment { faceId: string; start: KnifePoint; end: KnifePoint }
export interface KnifeOptions {
  /** Legacy single-face form, retained for MCP/client compatibility. */
  faceId?: string
  start?: KnifePoint
  end?: KnifePoint
  /** Screen-space path resolved by the editor into one segment per intersected face. */
  segments?: KnifeSegment[]
  /** True when the editor requested the equivalent of Blender's Cut Through mode. */
  through?: boolean
}

interface CutPoint extends KnifePoint { id: string; key: string }

const pointKey = (point: KnifePoint) => {
  const [a, b] = point.edge
  const edge = topologyEdgeKey(a, b)
  const t = a < b ? point.t : 1 - point.t
  return `${edge}:${t.toFixed(8)}`
}

function validatePoint(point: KnifePoint) {
  if (!Number.isFinite(point.t) || point.t <= .001 || point.t >= .999) throw new Error('Knife points must be inside their edges')
}

/** Insert all cut points on their original edges, sharing points across adjacent faces. */
function splitEdges(mesh: ModelMesh, points: CutPoint[]) {
  const byEdge = new Map<string, CutPoint[]>()
  for (const point of points) {
    const key = topologyEdgeKey(...point.edge)
    const list = byEdge.get(key) ?? []
    list.push(point)
    byEdge.set(key, list)
  }
  for (const face of mesh.faces) {
    const original = [...face.vertices]
    const vertices: string[] = []
    for (let index = 0; index < original.length; index++) {
      const a = original[index]!, b = original[(index + 1) % original.length]!
      vertices.push(a)
      const cuts = (byEdge.get(topologyEdgeKey(a, b)) ?? [])
        .slice()
        .sort((left, right) => {
          const leftT = left.edge[0] === a ? left.t : 1 - left.t
          const rightT = right.edge[0] === a ? right.t : 1 - right.t
          return leftT - rightT
        })
      vertices.push(...cuts.map(cut => cut.id))
    }
    face.vertices = vertices
  }
}

function splitFace(mesh: ModelMesh, segment: KnifeSegment, cuts: Map<string, CutPoint>) {
  const start = cuts.get(pointKey(segment.start)), end = cuts.get(pointKey(segment.end))
  if (!start || !end || start.id === end.id) throw new Error('Knife path must cross a face at two distinct points')
  const face = mesh.faces.find(item => item.id === segment.faceId)
  if (!face) throw new Error('Unknown face; refresh the selection')
  const first = face.vertices.indexOf(start.id), second = face.vertices.indexOf(end.id)
  if (first < 0 || second < 0) throw new Error('Knife point must land on an existing mesh edge')
  const path = (from: number, to: number) => {
    const result: string[] = []
    let index = from
    for (;;) {
      result.push(face.vertices[index]!)
      if (index === to) break
      index = (index + 1) % face.vertices.length
    }
    return result
  }
  const firstPath = path(first, second), secondPath = path(second, first)
  if (firstPath.length < 3 || secondPath.length < 3) throw new Error('Knife cut would create a degenerate face')
  face.vertices = firstPath
  mesh.faces.push({ id: `f${mesh.nextId++}`, vertices: secondPath })
}

/**
 * Apply a screen-space Knife result. The editor resolves a stroke into per-face
 * edge intersections; this kernel then shares edge points and splits every face
 * in the path, including hidden faces when the caller supplies through segments.
 */
export function knifeCut(mesh: ModelMesh, options: KnifeOptions) {
  const segments = options.segments?.length
    ? options.segments
    : options.faceId && options.start && options.end
      ? [{ faceId: options.faceId, start: options.start, end: options.end }]
      : []
  if (!segments.length) throw new Error('Knife needs a drawn path')
  if (mesh.vertices.length + segments.length * 2 > 12000 || mesh.faces.length + segments.length > 12000) throw new Error('Knife would exceed the model geometry limit')

  const cuts = new Map<string, CutPoint>()
  for (const segment of segments) {
    if (!mesh.faces.some(face => face.id === segment.faceId)) throw new Error('Unknown face; refresh the selection')
    validatePoint(segment.start); validatePoint(segment.end)
    if (topologyEdgeKey(...segment.start.edge) === topologyEdgeKey(...segment.end.edge)) throw new Error('Knife path must enter and leave a face through different edges')
    for (const point of [segment.start, segment.end]) {
      const key = pointKey(point)
      if (!cuts.has(key)) {
        const start = mesh.vertices.find(vertex => vertex.id === point.edge[0])?.position
        const end = mesh.vertices.find(vertex => vertex.id === point.edge[1])?.position
        if (!start || !end) throw new Error('Knife point references a missing vertex')
        const id = `v${mesh.nextId++}`
        mesh.vertices.push({id,position:start.map((value,axis)=>value+(end[axis]!-value)*point.t) as [number,number,number]})
        cuts.set(key, { ...point, id, key })
      }
    }
  }
  const points = [...cuts.values()]
  splitEdges(mesh, points)
  for (const segment of segments) splitFace(mesh, segment, cuts)
  return { faceIds: segments.flatMap(segment => [segment.faceId]), cutVertices: points.map(point => point.id) }
}
