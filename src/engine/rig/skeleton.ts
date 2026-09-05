import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import type { AuroraRig, AuroraRigBone } from '@/models/editor'

/** Affine 2D transform laid out like a canvas matrix: `[a, b, c, d, tx, ty]`. */
export type Matrix2D = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0]

export interface RigPoint { x: number; y: number }

/** `multiply(a, b)` applies b first, then a — the usual parent-then-child reading order. */
export function multiply(a: Matrix2D, b: Matrix2D): Matrix2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

export function invert(m: Matrix2D): Matrix2D {
  const determinant = m[0] * m[3] - m[1] * m[2]
  // A collapsed matrix has no inverse; falling back to identity keeps a degenerate bone harmless.
  if (Math.abs(determinant) < 1e-12) return IDENTITY
  const a = m[3] / determinant
  const b = -m[1] / determinant
  const c = -m[2] / determinant
  const d = m[0] / determinant
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export function applyMatrix(m: Matrix2D, x: number, y: number): RigPoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

export const translation = (x: number, y: number): Matrix2D => [1, 0, 0, 1, x, y]

export function rotation(degrees: number): Matrix2D {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [cos, sin, -sin, cos, 0, 0]
}

export const scaling = (x: number, y: number): Matrix2D => [x, 0, 0, y, 0, 0]

/** Where the bone rests in rig space, independent of its parent. */
export function boneRestMatrix(bone: AuroraRigBone): Matrix2D {
  return multiply(translation(bone.x, bone.y), rotation(bone.angle))
}

export function boneTip(bone: AuroraRigBone): RigPoint {
  return applyMatrix(boneRestMatrix(bone), bone.length, 0)
}

/**
 * Walks up the parent chain, stopping on a cycle or a missing parent.
 *
 * Bones are reparented by id from the UI, so a chain that loops back on itself is one mis-click
 * away. Treating the looping bone as a root keeps the rig posable instead of hanging the frame.
 */
function orderedBones(rig: AuroraRig) {
  const byId = new Map(rig.bones.map((bone) => [bone.id, bone]))
  const depth = new Map<string, number>()
  const depthOf = (bone: AuroraRigBone, seen: Set<string>): number => {
    const cached = depth.get(bone.id)
    if (cached !== undefined) return cached
    const parent = bone.parentId ? byId.get(bone.parentId) : undefined
    const result = !parent || seen.has(parent.id) ? 0 : depthOf(parent, new Set(seen).add(bone.id)) + 1
    depth.set(bone.id, result)
    return result
  }
  return [...rig.bones]
    .map((bone) => ({ bone, depth: depthOf(bone, new Set([bone.id])) }))
    .sort((left, right) => left.depth - right.depth)
    .map((entry) => entry.bone)
}

export interface BoneTransform {
  /** Where the bone sits before its own pose is applied — its parent's pose times its rest offset. */
  frame: Matrix2D
  /** The bone's posed placement in rig space. */
  world: Matrix2D
}

/**
 * Posed placement of every bone, keyed by id.
 *
 * `frame` is exposed because dragging a bone in the viewport has to undo everything upstream of it
 * before it can turn a cursor position into that bone's own rotation or offset.
 */
export function boneTransforms(rig: AuroraRig, time: number): Map<string, BoneTransform> {
  const byId = new Map(rig.bones.map((bone) => [bone.id, bone]))
  const result = new Map<string, BoneTransform>()
  orderedBones(rig).forEach((bone) => {
    const rest = boneRestMatrix(bone)
    const parent = bone.parentId ? byId.get(bone.parentId) : undefined
    const parentWorld = parent ? result.get(parent.id)?.world ?? IDENTITY : IDENTITY
    const parentRest = parent ? boneRestMatrix(parent) : IDENTITY
    const frame = multiply(parentWorld, multiply(invert(parentRest), rest))
    const delta = multiply(
      translation(evaluateNumericProperty(bone.offsetX, time), evaluateNumericProperty(bone.offsetY, time)),
      multiply(
        rotation(evaluateNumericProperty(bone.rotation, time)),
        scaling(Math.max(.01, evaluateNumericProperty(bone.stretch, time)), 1),
      ),
    )
    result.set(bone.id, { frame, world: multiply(frame, delta) })
  })
  return result
}

/**
 * One skinning matrix per bone, in the rig's own bone order.
 *
 * A bone's pose is authored in its rest frame, so the matrix that reaches the mesh is
 * `world · rest⁻¹`: at rest that is the identity and the image is left exactly as it was drawn.
 */
export function bonePoseMatrices(rig: AuroraRig, time: number): Matrix2D[] {
  const transforms = boneTransforms(rig, time)
  return rig.bones.map((bone) => multiply(transforms.get(bone.id)?.world ?? IDENTITY, invert(boneRestMatrix(bone))))
}

/** Squared distance from a point to the bone's rest segment, so falloff measures real reach. */
function distanceToBone(bone: AuroraRigBone, x: number, y: number) {
  const rest = boneRestMatrix(bone)
  const head = applyMatrix(rest, 0, 0)
  const tip = applyMatrix(rest, bone.length, 0)
  const dx = tip.x - head.x
  const dy = tip.y - head.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - head.x) * dx + (y - head.y) * dy) / lengthSq))
  return Math.hypot(x - (head.x + dx * t), y - (head.y + dy * t))
}

/**
 * Normalised weight of every bone at every point, row-major by point.
 *
 * Falloff is a smooth square rather than a linear ramp, so a bone's influence dies out gently and
 * neighbouring bones blend instead of creasing. A point no bone reaches keeps a zero row and is
 * left where it was drawn.
 */
export function skinWeights(rig: AuroraRig, points: readonly RigPoint[]): Float32Array {
  const weights = new Float32Array(points.length * rig.bones.length)
  points.forEach((point, index) => {
    const row = index * rig.bones.length
    let total = 0
    rig.bones.forEach((bone, boneIndex) => {
      const falloff = Math.max(0, bone.falloff)
      if (falloff <= 0) return
      const distance = distanceToBone(bone, point.x, point.y)
      if (distance >= falloff) return
      const weight = (1 - distance / falloff) ** 2
      weights[row + boneIndex] = weight
      total += weight
    })
    if (total <= 0) return
    for (let boneIndex = 0; boneIndex < rig.bones.length; boneIndex += 1) weights[row + boneIndex]! /= total
  })
  return weights
}

/**
 * Linear blend skinning: every point moves by the weighted average of the bones that reach it.
 * Returns interleaved x/y so both renderers can upload the result without another pass.
 */
export function deformPoints(points: readonly RigPoint[], weights: Float32Array, matrices: readonly Matrix2D[]): Float32Array {
  const result = new Float32Array(points.length * 2)
  points.forEach((point, index) => {
    const row = index * matrices.length
    let x = 0
    let y = 0
    let total = 0
    matrices.forEach((matrix, boneIndex) => {
      const weight = weights[row + boneIndex] ?? 0
      if (weight <= 0) return
      const moved = applyMatrix(matrix, point.x, point.y)
      x += moved.x * weight
      y += moved.y * weight
      total += weight
    })
    // Whatever weight is left over holds the point at rest, so an unreached corner never collapses.
    result[index * 2] = x + point.x * (1 - total)
    result[index * 2 + 1] = y + point.y * (1 - total)
  })
  return result
}

/** Changes whenever the rest pose does, so cached weights are rebuilt only when the skeleton moves. */
export function rigRestSignature(rig: AuroraRig | undefined) {
  if (!rig) return 'none'
  return `${rig.columns}x${rig.rows}|${rig.bones
    .map((bone) => `${bone.id}:${bone.x},${bone.y},${bone.angle},${bone.length},${bone.falloff},${bone.parentId ?? ''}`)
    .join('|')}`
}

/** Changes whenever the posed skeleton does, so a still frame is never re-deformed. */
export function rigPoseSignature(rig: AuroraRig | undefined, time: number) {
  if (!rig) return 'none'
  return rig.bones
    .map((bone) => [bone.rotation, bone.offsetX, bone.offsetY, bone.stretch]
      .map((property) => evaluateNumericProperty(property, time).toFixed(4))
      .join(','))
    .join('|')
}

/** True when the rig has something that can actually bend the surface it is attached to. */
export function rigIsActive(rig: AuroraRig | undefined): rig is AuroraRig {
  return Boolean(rig?.bones.length)
}
