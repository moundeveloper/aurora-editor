import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import type { Aurora3DPath, Aurora3DPathPoint, Transform3D } from '@/models/editor'

function vector(value: [number, number, number]) {
  return new THREE.Vector3(value[0], value[1], value[2])
}

export function pathTransformComponents(transform: Transform3D, time: number) {
  return {
    position: new THREE.Vector3(
      evaluateNumericProperty(transform.position.x, time),
      evaluateNumericProperty(transform.position.y, time),
      evaluateNumericProperty(transform.position.z, time),
    ),
    rotation: new THREE.Euler(
      THREE.MathUtils.degToRad(evaluateNumericProperty(transform.rotation.x, time)),
      THREE.MathUtils.degToRad(evaluateNumericProperty(transform.rotation.y, time)),
      THREE.MathUtils.degToRad(evaluateNumericProperty(transform.rotation.z, time)),
    ),
    scale: new THREE.Vector3(
      evaluateNumericProperty(transform.scale.x, time),
      evaluateNumericProperty(transform.scale.y, time),
      evaluateNumericProperty(transform.scale.z, time),
    ),
  }
}

export function pathTransformMatrix(transform: Transform3D, time: number) {
  const { position, rotation, scale } = pathTransformComponents(transform, time)
  return new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale)
}

function segmentFor(points: Aurora3DPathPoint[], index: number, closed: boolean) {
  const from = points[index]
  const to = points[(index + 1) % points.length]
  if (!from || !to || (!closed && index >= points.length - 1)) return null
  return new THREE.CubicBezierCurve3(vector(from.position), vector(from.handleOut), vector(to.handleIn), vector(to.position))
}

export function makeLocalPathCurve(path: Aurora3DPath) {
  const curve = new THREE.CurvePath<THREE.Vector3>()
  const segmentCount = path.closed ? path.points.length : Math.max(0, path.points.length - 1)
  for (let index = 0; index < segmentCount; index += 1) {
    const segment = segmentFor(path.points, index, path.closed)
    if (segment) curve.add(segment)
  }
  if (path.closed) curve.autoClose = true
  return curve
}

export function sampleLocalPath(path: Aurora3DPath, divisions = 96) {
  const curve = makeLocalPathCurve(path)
  if (!curve.curves.length) return path.points.map((point) => vector(point.position))
  return curve.getPoints(Math.max(divisions, curve.curves.length * 24))
}

export function evaluate3DPath(path: Aurora3DPath, progress: number, time: number) {
  const curve = makeLocalPathCurve(path)
  const matrix = pathTransformMatrix(path.transform, time)
  if (!curve.curves.length) {
    const fallback = path.points[0] ? vector(path.points[0].position).applyMatrix4(matrix) : new THREE.Vector3()
    return { position: fallback, tangent: new THREE.Vector3(0, 0, -1) }
  }
  const clamped = THREE.MathUtils.clamp(progress, 0, 1)
  const position = curve.getPointAt(clamped).applyMatrix4(matrix)
  const epsilon = .0001
  const before = curve.getPointAt(Math.max(0, clamped - epsilon)).applyMatrix4(matrix)
  const after = curve.getPointAt(Math.min(1, clamped + epsilon)).applyMatrix4(matrix)
  const tangent = after.sub(before).normalize()
  if (tangent.lengthSq() < .000001) tangent.set(0, 0, -1)
  return { position, tangent }
}
