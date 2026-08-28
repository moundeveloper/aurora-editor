import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import type { AnimatableProperty, AuroraInfluence, AuroraInfluenceType } from '@/models/editor'

/** Hard ceiling so an animated array or subdivision level cannot lock the viewport up. */
const MAX_VERTICES = 240_000

export interface InfluenceParameterDefinition {
  key: string
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  suffix?: string
}

export interface InfluenceDefinition {
  type: AuroraInfluenceType
  label: string
  description: string
  parameters: InfluenceParameterDefinition[]
}

export const INFLUENCE_DEFINITIONS: Record<AuroraInfluenceType, InfluenceDefinition> = {
  array: {
    type: 'array',
    label: 'Array',
    description: 'Repeats the geometry along a relative offset.',
    parameters: [
      { key: 'count', label: 'Count', value: 3, min: 1, max: 32, step: 1 },
      { key: 'offsetX', label: 'Offset X', value: 2.4, step: .1 },
      { key: 'offsetY', label: 'Offset Y', value: 0, step: .1 },
      { key: 'offsetZ', label: 'Offset Z', value: 0, step: .1 },
      { key: 'rotationStep', label: 'Rotation step', value: 0, step: 1, suffix: '°' },
      { key: 'scaleStep', label: 'Scale step', value: 1, min: .01, step: .05 },
    ],
  },
  'radial-array': {
    type: 'radial-array',
    label: 'Radial array',
    description: 'Copies the geometry around a centre point, rotated in equal steps.',
    parameters: [
      { key: 'count', label: 'Count', value: 6, min: 1, max: 64, step: 1 },
      { key: 'centerX', label: 'Centre X', value: 0, step: .1 },
      { key: 'centerY', label: 'Centre Y', value: 0, step: .1 },
      { key: 'centerZ', label: 'Centre Z', value: 2.5, step: .1 },
      { key: 'axis', label: 'Axis (0=X 1=Y 2=Z)', value: 1, min: 0, max: 2, step: 1 },
      { key: 'angle', label: 'Sweep', value: 360, step: 5, suffix: '°' },
      { key: 'orient', label: 'Rotate copies', value: 1, min: 0, max: 1, step: 1 },
    ],
  },
  mirror: {
    type: 'mirror',
    label: 'Mirror',
    description: 'Mirrors the geometry across the object origin.',
    parameters: [
      { key: 'axisX', label: 'Mirror X', value: 1, min: 0, max: 1, step: 1 },
      { key: 'axisY', label: 'Mirror Y', value: 0, min: 0, max: 1, step: 1 },
      { key: 'axisZ', label: 'Mirror Z', value: 0, min: 0, max: 1, step: 1 },
    ],
  },
  subdivide: {
    type: 'subdivide',
    label: 'Subdivide',
    description: 'Splits every triangle into four, for smoother deformation.',
    parameters: [{ key: 'level', label: 'Level', value: 1, min: 0, max: 3, step: 1 }],
  },
  displace: {
    type: 'displace',
    label: 'Displace',
    description: 'Pushes vertices along their normals with value noise.',
    parameters: [
      { key: 'amount', label: 'Amount', value: .18, step: .01 },
      { key: 'scale', label: 'Noise scale', value: 2.2, min: .01, step: .1 },
      { key: 'seed', label: 'Seed', value: 0, step: 1 },
    ],
  },
  twist: {
    type: 'twist',
    label: 'Twist',
    description: 'Rotates vertices around Y in proportion to their height.',
    parameters: [
      { key: 'angle', label: 'Angle', value: 45, step: 1, suffix: '°' },
      { key: 'height', label: 'Height', value: 2, min: .01, step: .1 },
    ],
  },
}

export const INFLUENCE_TYPES = Object.keys(INFLUENCE_DEFINITIONS) as AuroraInfluenceType[]

export function createInfluence(type: AuroraInfluenceType, index: number): AuroraInfluence {
  const definition = INFLUENCE_DEFINITIONS[type]
  const id = crypto.randomUUID()
  const parameters: Record<string, AnimatableProperty<number>> = {}
  definition.parameters.forEach((parameter) => {
    parameters[parameter.key] = { id: `${id}-${parameter.key}`, value: parameter.value, animated: false, keyframes: [] }
  })
  return { id, type, name: index > 1 ? `${definition.label} ${index}` : definition.label, enabled: true, parameters }
}

export function influenceParameters(influence: AuroraInfluence) {
  return INFLUENCE_DEFINITIONS[influence.type].parameters
    .map((definition) => ({ definition, property: influence.parameters[definition.key] }))
    .filter((entry): entry is { definition: InfluenceParameterDefinition; property: AnimatableProperty<number> } => Boolean(entry.property))
}

function parameterValue(influence: AuroraInfluence, key: string, time: number) {
  const property = influence.parameters[key]
  const fallback = INFLUENCE_DEFINITIONS[influence.type].parameters.find((item) => item.key === key)?.value ?? 0
  return property ? evaluateNumericProperty(property, time) : fallback
}

/** Rebuilding geometry is expensive, so the runtime only does it when this signature changes. */
export function influenceSignature(influences: AuroraInfluence[] | undefined, time: number) {
  if (!influences?.length) return 'none'
  return influences
    .map((influence) => {
      if (!influence.enabled) return `${influence.id}:off`
      const values = influenceParameters(influence)
        .map((entry) => evaluateNumericProperty(entry.property, time).toFixed(4))
        .join(',')
      return `${influence.id}:${influence.type}:${values}`
    })
    .join('|')
}

const fade = (value: number) => value * value * (3 - 2 * value)

function hash(x: number, y: number, z: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 43.3) * 43758.5453123
  return value - Math.floor(value)
}

function valueNoise(x: number, y: number, z: number, seed: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const w = fade(z - zi)
  let result = 0
  for (let dx = 0; dx <= 1; dx += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dz = 0; dz <= 1; dz += 1) {
        const weight = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w)
        result += weight * hash(xi + dx, yi + dy, zi + dz, seed)
      }
    }
  }
  return result * 2 - 1
}

const vertexCount = (geometry: THREE.BufferGeometry) => geometry.getAttribute('position')?.count ?? 0

function applyArray(geometry: THREE.BufferGeometry, influence: AuroraInfluence, time: number) {
  const count = Math.max(1, Math.round(parameterValue(influence, 'count', time)))
  if (count <= 1) return geometry
  const offset = new THREE.Vector3(
    parameterValue(influence, 'offsetX', time),
    parameterValue(influence, 'offsetY', time),
    parameterValue(influence, 'offsetZ', time),
  )
  const rotationStep = THREE.MathUtils.degToRad(parameterValue(influence, 'rotationStep', time))
  const scaleStep = parameterValue(influence, 'scaleStep', time)
  const copies: THREE.BufferGeometry[] = []
  for (let index = 0; index < count; index += 1) {
    if (vertexCount(geometry) * (index + 1) > MAX_VERTICES) break
    const copy = geometry.clone()
    const scale = Math.pow(scaleStep, index)
    copy.applyMatrix4(new THREE.Matrix4().compose(
      offset.clone().multiplyScalar(index),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationStep * index, 0)),
      new THREE.Vector3(scale, scale, scale),
    ))
    copies.push(copy)
  }
  const merged = copies.length > 1 ? mergeGeometries(copies) : copies[0]!
  copies.forEach((copy) => { if (copy !== merged) copy.dispose() })
  return merged ?? geometry
}

/**
 * Repeats the geometry around an authored centre rather than the object origin, which is what a
 * radial layout needs: the pivot is almost never the thing being copied.
 */
function applyRadialArray(geometry: THREE.BufferGeometry, influence: AuroraInfluence, time: number) {
  const count = Math.max(1, Math.round(parameterValue(influence, 'count', time)))
  if (count <= 1) return geometry
  const center = new THREE.Vector3(
    parameterValue(influence, 'centerX', time),
    parameterValue(influence, 'centerY', time),
    parameterValue(influence, 'centerZ', time),
  )
  const axisIndex = Math.max(0, Math.min(2, Math.round(parameterValue(influence, 'axis', time))))
  const axis = new THREE.Vector3(Number(axisIndex === 0), Number(axisIndex === 1), Number(axisIndex === 2))
  const sweep = THREE.MathUtils.degToRad(parameterValue(influence, 'angle', time))
  // A full turn lands the last copy on top of the first, so it spans `count` steps rather than `count - 1`.
  const fullTurn = Math.abs(Math.abs(sweep) - Math.PI * 2) < 1e-6
  const step = sweep / (fullTurn ? count : Math.max(1, count - 1))
  const orient = parameterValue(influence, 'orient', time) >= .5
  const copies: THREE.BufferGeometry[] = []
  for (let index = 0; index < count; index += 1) {
    if (vertexCount(geometry) * (index + 1) > MAX_VERTICES) break
    const copy = geometry.clone()
    const matrix = new THREE.Matrix4()
      .makeTranslation(center.x, center.y, center.z)
      .multiply(new THREE.Matrix4().makeRotationAxis(axis, step * index))
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
    // Without orientation the copy only travels to its rotated slot; its own axes stay where they were.
    if (!orient) {
      const slot = new THREE.Vector3().applyMatrix4(matrix)
      matrix.makeTranslation(slot.x, slot.y, slot.z)
    }
    copy.applyMatrix4(matrix)
    copies.push(copy)
  }
  const merged = copies.length > 1 ? mergeGeometries(copies) : copies[0]!
  copies.forEach((copy) => { if (copy !== merged) copy.dispose() })
  return merged ?? geometry
}

function applyMirror(geometry: THREE.BufferGeometry, influence: AuroraInfluence, time: number) {
  const axes: Array<[number, number, number]> = []
  if (parameterValue(influence, 'axisX', time) >= .5) axes.push([-1, 1, 1])
  if (parameterValue(influence, 'axisY', time) >= .5) axes.push([1, -1, 1])
  if (parameterValue(influence, 'axisZ', time) >= .5) axes.push([1, 1, -1])
  if (!axes.length) return geometry

  let result = geometry
  axes.forEach((axis) => {
    if (vertexCount(result) * 2 > MAX_VERTICES) return
    const mirrored = result.clone().toNonIndexed()
    mirrored.applyMatrix4(new THREE.Matrix4().makeScale(...axis))
    // A negative scale flips the winding order, so swap two corners of every triangle back.
    const position = mirrored.getAttribute('position') as THREE.BufferAttribute
    const uv = mirrored.getAttribute('uv') as THREE.BufferAttribute | undefined
    for (let index = 0; index < position.count; index += 3) {
      swapVertices(position, index, index + 2)
      if (uv) swapVertices(uv, index, index + 2)
    }
    mirrored.computeVertexNormals()
    const source = result.clone().toNonIndexed()
    const merged = mergeGeometries([source, mirrored])
    source.dispose()
    mirrored.dispose()
    if (result !== geometry) result.dispose()
    result = merged ?? result
  })
  return result
}

function swapVertices(attribute: THREE.BufferAttribute, left: number, right: number) {
  for (let component = 0; component < attribute.itemSize; component += 1) {
    const temporary = attribute.array[left * attribute.itemSize + component]!
    attribute.array[left * attribute.itemSize + component] = attribute.array[right * attribute.itemSize + component]!
    attribute.array[right * attribute.itemSize + component] = temporary
  }
}

function subdivideOnce(geometry: THREE.BufferGeometry) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position') as THREE.BufferAttribute
  const uv = source.getAttribute('uv') as THREE.BufferAttribute | undefined
  const positions: number[] = []
  const uvs: number[] = []
  const midpoint = (attribute: THREE.BufferAttribute, left: number, right: number, size: number) =>
    Array.from({ length: size }, (_, component) =>
      (attribute.array[left * size + component]! + attribute.array[right * size + component]!) / 2)

  for (let face = 0; face < position.count; face += 3) {
    const corners = [face, face + 1, face + 2]
    const mids = [
      { position: midpoint(position, corners[0]!, corners[1]!, 3), uv: uv && midpoint(uv, corners[0]!, corners[1]!, 2) },
      { position: midpoint(position, corners[1]!, corners[2]!, 3), uv: uv && midpoint(uv, corners[1]!, corners[2]!, 2) },
      { position: midpoint(position, corners[2]!, corners[0]!, 3), uv: uv && midpoint(uv, corners[2]!, corners[0]!, 2) },
    ]
    const corner = (index: number) => ({
      position: [position.getX(index), position.getY(index), position.getZ(index)],
      uv: uv ? [uv.getX(index), uv.getY(index)] : undefined,
    })
    const triangles = [
      [corner(corners[0]!), mids[0]!, mids[2]!],
      [mids[0]!, corner(corners[1]!), mids[1]!],
      [mids[2]!, mids[1]!, corner(corners[2]!)],
      [mids[0]!, mids[1]!, mids[2]!],
    ]
    triangles.forEach((triangle) => triangle.forEach((vertex) => {
      positions.push(vertex.position[0]!, vertex.position[1]!, vertex.position[2]!)
      if (uv && vertex.uv) uvs.push(vertex.uv[0]!, vertex.uv[1]!)
    }))
  }

  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (uv && uvs.length) result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  result.computeVertexNormals()
  if (source !== geometry) source.dispose()
  return result
}

function applySubdivide(geometry: THREE.BufferGeometry, influence: AuroraInfluence, time: number) {
  const level = Math.max(0, Math.min(3, Math.round(parameterValue(influence, 'level', time))))
  let result = geometry
  for (let pass = 0; pass < level; pass += 1) {
    if (vertexCount(result) * 4 > MAX_VERTICES) break
    const next = subdivideOnce(result)
    if (result !== geometry) result.dispose()
    result = next
  }
  return result
}

function applyDisplace(geometry: THREE.BufferGeometry, influence: AuroraInfluence, time: number) {
  const amount = parameterValue(influence, 'amount', time)
  if (Math.abs(amount) < 0.000001) return geometry
  const scale = Math.max(.01, parameterValue(influence, 'scale', time))
  const seed = parameterValue(influence, 'seed', time)
  const result = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = result.getAttribute('position') as THREE.BufferAttribute
  if (!result.getAttribute('normal')) result.computeVertexNormals()
  const normal = result.getAttribute('normal') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const displacement = amount * valueNoise(x * scale, y * scale, z * scale, seed)
    position.setXYZ(
      index,
      x + normal.getX(index) * displacement,
      y + normal.getY(index) * displacement,
      z + normal.getZ(index) * displacement,
    )
  }
  position.needsUpdate = true
  result.computeVertexNormals()
  return result
}

function applyTwist(geometry: THREE.BufferGeometry, influence: AuroraInfluence, time: number) {
  const angle = THREE.MathUtils.degToRad(parameterValue(influence, 'angle', time))
  if (Math.abs(angle) < 0.000001) return geometry
  const height = Math.max(.01, parameterValue(influence, 'height', time))
  const result = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = result.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const rotation = angle * (y / height)
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    position.setXYZ(index, x * cos - z * sin, y, x * sin + z * cos)
  }
  position.needsUpdate = true
  result.computeVertexNormals()
  return result
}

const APPLIERS: Record<AuroraInfluenceType, (geometry: THREE.BufferGeometry, influence: AuroraInfluence, time: number) => THREE.BufferGeometry> = {
  array: applyArray,
  'radial-array': applyRadialArray,
  mirror: applyMirror,
  subdivide: applySubdivide,
  displace: applyDisplace,
  twist: applyTwist,
}

/**
 * Evaluates the stack in order on top of the untouched primitive geometry. The source is never
 * mutated; the caller owns the returned geometry unless it is the source itself.
 */
export function applyInfluences(source: THREE.BufferGeometry, influences: AuroraInfluence[] | undefined, time: number) {
  const active = influences?.filter((influence) => influence.enabled) ?? []
  if (!active.length) return source
  let result = source
  active.forEach((influence) => {
    const next = APPLIERS[influence.type]?.(result, influence, time) ?? result
    if (next !== result && result !== source) result.dispose()
    result = next
  })
  return result
}
