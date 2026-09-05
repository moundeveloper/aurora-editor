import { deformPoints, rigPoseSignature, rigRestSignature, skinWeights, type Matrix2D, type RigPoint } from '@/engine/rig/skeleton'
import type { AuroraRig } from '@/models/editor'

/** Grid resolution bounds: one cell deforms nothing useful, and a dense grid costs real frame time. */
export const MIN_RIG_CELLS = 1
export const MAX_RIG_CELLS = 64

export interface RigMesh {
  columns: number
  rows: number
  /** Rest positions in rig space, row-major from the top-left corner. */
  points: RigPoint[]
  /** Image-space UVs, v growing downward, matching the point order. */
  uvs: Float32Array
  indices: Uint32Array
}

/**
 * A quad subdivided into a grid, spanning the rig's own square from -1 to 1 with Y pointing up.
 *
 * Both renderers share this layout so a rig authored against a timeline image lands on a 3D plane
 * unchanged, and neither has to depend on how a particular library happens to order a plane.
 */
export function createRigMesh(columns: number, rows: number): RigMesh {
  const columnCount = Math.max(MIN_RIG_CELLS, Math.min(MAX_RIG_CELLS, Math.round(columns)))
  const rowCount = Math.max(MIN_RIG_CELLS, Math.min(MAX_RIG_CELLS, Math.round(rows)))
  const points: RigPoint[] = []
  const uvs = new Float32Array((columnCount + 1) * (rowCount + 1) * 2)
  let uvIndex = 0
  for (let row = 0; row <= rowCount; row += 1) {
    for (let column = 0; column <= columnCount; column += 1) {
      const u = column / columnCount
      const v = row / rowCount
      points.push({ x: u * 2 - 1, y: 1 - v * 2 })
      uvs[uvIndex] = u
      uvs[uvIndex + 1] = v
      uvIndex += 2
    }
  }
  const indices = new Uint32Array(columnCount * rowCount * 6)
  let index = 0
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const topLeft = row * (columnCount + 1) + column
      const topRight = topLeft + 1
      const bottomLeft = topLeft + columnCount + 1
      const bottomRight = bottomLeft + 1
      indices.set([topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight], index)
      index += 6
    }
  }
  return { columns: columnCount, rows: rowCount, points, uvs, indices }
}

interface CacheEntry { restKey: string; mesh: RigMesh; weights: Float32Array }

/**
 * Mesh and skin weights per rig, rebuilt only when the rest pose changes.
 *
 * Weights depend on where the bones rest, never on how they are posed, so posing a rig every frame
 * costs one blend pass and no re-weighting. The cache is module-level because both the preview and
 * the exporter deform the same rigs.
 */
const cache = new Map<string, CacheEntry>()

export function rigDeformSource(rig: AuroraRig) {
  const restKey = rigRestSignature(rig)
  const cached = cache.get(rig.id)
  if (cached?.restKey === restKey) return cached
  const mesh = createRigMesh(rig.columns, rig.rows)
  const entry: CacheEntry = { restKey, mesh, weights: skinWeights(rig, mesh.points) }
  cache.set(rig.id, entry)
  return entry
}

export function clearRigCache() {
  cache.clear()
}

export interface DeformedRig {
  mesh: RigMesh
  /** Interleaved x/y in rig space, one pair per mesh point. */
  positions: Float32Array
  /** Changes only when the posed result does, so callers can skip an upload. */
  signature: string
}

/** Poses the rig at `time` and returns the deformed grid, ready to upload as vertices. */
export function deformRig(rig: AuroraRig, matrices: readonly Matrix2D[], time: number): DeformedRig {
  const { mesh, weights } = rigDeformSource(rig)
  return {
    mesh,
    positions: deformPoints(mesh.points, weights, matrices),
    signature: `${rigRestSignature(rig)}#${rigPoseSignature(rig, time)}`,
  }
}
