import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { applyMatrix, boneTransforms, invert, multiply, translation, type RigPoint } from '@/engine/rig/skeleton'
import type { AuroraRig, AuroraRigBone } from '@/models/editor'

/**
 * Turning a cursor into a bone pose.
 *
 * Both viewports drag bones, in different spaces and through different renderers, but the arithmetic
 * is identical once the pointer has been reduced to a point in rig space: undo everything upstream
 * of the bone, then read off the value that puts its handle under the cursor.
 */

/** Pose rotation, in degrees, that swings the bone's tip onto `target`. */
export function poseRotationTowards(rig: AuroraRig, bone: AuroraRigBone, time: number, target: RigPoint) {
  const frame = boneTransforms(rig, time).get(bone.id)?.frame
  if (!frame) return evaluateNumericProperty(bone.rotation, time)
  // The offset is applied after the rotation, so it belongs to the frame the angle is measured in.
  const offset = translation(
    evaluateNumericProperty(bone.offsetX, time),
    evaluateNumericProperty(bone.offsetY, time),
  )
  const local = applyMatrix(invert(multiply(frame, offset)), target.x, target.y)
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return evaluateNumericProperty(bone.rotation, time)
  return (Math.atan2(local.y, local.x) * 180) / Math.PI
}

/** Pose offset, in rig units, that puts the bone's head under `target`. */
export function poseOffsetTowards(rig: AuroraRig, bone: AuroraRigBone, time: number, target: RigPoint): RigPoint {
  const frame = boneTransforms(rig, time).get(bone.id)?.frame
  if (!frame) return { x: evaluateNumericProperty(bone.offsetX, time), y: evaluateNumericProperty(bone.offsetY, time) }
  const local = applyMatrix(invert(frame), target.x, target.y)
  return Number.isFinite(local.x) && Number.isFinite(local.y)
    ? local
    : { x: evaluateNumericProperty(bone.offsetX, time), y: evaluateNumericProperty(bone.offsetY, time) }
}

/** Rest angle and length that aim the bone at `target`, for editing the skeleton rather than posing it. */
export function restAimTowards(head: RigPoint, target: RigPoint, fallbackAngle: number) {
  const dx = target.x - head.x
  const dy = target.y - head.y
  const length = Math.hypot(dx, dy)
  return {
    angle: length < 1e-4 ? fallbackAngle : (Math.atan2(dy, dx) * 180) / Math.PI,
    length,
  }
}
