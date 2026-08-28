import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { shapeOutline, type ShapePoint } from '@/engine/shapes/shapeGeometry'
import type { EditorLayer } from '@/models/editor'

export type MaskPoint = ShapePoint

export interface MaskEffectInput {
  feather: number
  edgeFeather: number[]
  inverted: boolean
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/**
 * The distance field is the expensive half of a mask and only changes when the shape or its transform
 * does, so it is sampled coarsely. The alpha raster is far cheaper and repaints on every feather edit,
 * so it runs at close to render resolution — otherwise a hard edge reaches the compositor as a wide
 * bilinear ramp and reads as a soft one.
 */
export const MASK_FIELD_RESOLUTION = 512
export const MASK_RASTER_RESOLUTION = 1024

export function transformPerimeter(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number): MaskPoint[] {
  const scaleX = evaluateNumericProperty(layer.transform.scaleX, time) / 100
  const scaleY = evaluateNumericProperty(layer.transform.scaleY, time) / 100
  const rotation = evaluateNumericProperty(layer.transform.rotation, time) * Math.PI / 180
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const positionX = evaluateNumericProperty(layer.transform.x, time)
  const positionY = evaluateNumericProperty(layer.transform.y, time)
  const outline = shapeOutline(layer, 12)
  if (!outline.closed) return []
  return outline.points.map(([localX, localY]) => {
    const x = localX * scaleX
    const y = localY * scaleY
    return [
      (positionX + x * cosine - y * sine) * width / projectWidth,
      (positionY + x * sine + y * cosine) * height / projectHeight,
    ] as MaskPoint
  })
}

export function pointInsidePolygon(x: number, y: number, polygon: MaskPoint[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]!
    const previousPoint = polygon[previous]!
    if ((currentPoint[1] > y) !== (previousPoint[1] > y)
      && x < (previousPoint[0] - currentPoint[0]) * (y - currentPoint[1]) / (previousPoint[1] - currentPoint[1]) + currentPoint[0]) inside = !inside
  }
  return inside
}

/**
 * Every field pixel walks the whole perimeter, so the segments are flattened into one packed buffer
 * first — an array of tuples costs more in indirection than the arithmetic it feeds.
 */
function packPerimeter(polygon: MaskPoint[]) {
  const packed = new Float64Array(polygon.length * 5)
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    const deltaX = end[0] - start[0]
    const deltaY = end[1] - start[1]
    const lengthSquared = deltaX ** 2 + deltaY ** 2
    packed[index * 5] = start[0]
    packed[index * 5 + 1] = start[1]
    packed[index * 5 + 2] = deltaX
    packed[index * 5 + 3] = deltaY
    packed[index * 5 + 4] = lengthSquared ? 1 / lengthSquared : 0
  }
  return packed
}

export interface MaskGeometryField {
  width: number
  height: number
  /** Field pixels per render pixel, so the raster pass can map back into render space. */
  scale: number
  /** Render-space distance to the perimeter, positive inside the shape and negative outside. */
  signedDistance: Float32Array
  edgePosition: Float32Array
  /** Deepest point inside the shape, in render pixels — the ceiling on how far a feather may reach. */
  maxInside: number
}

export function createMaskGeometry(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number): MaskGeometryField | null {
  if (layer.type !== 'shape') return null
  const polygon = transformPerimeter(layer, time, width, height, projectWidth, projectHeight)
  if (polygon.length < 3) return null
  const fieldScale = Math.min(1, MASK_FIELD_RESOLUTION / Math.max(width, height))
  const fieldWidth = Math.max(1, Math.round(width * fieldScale))
  const fieldHeight = Math.max(1, Math.round(height * fieldScale))
  const size = fieldWidth * fieldHeight
  const signedDistance = new Float32Array(size)
  const edgePosition = new Float32Array(size)
  const segments = packPerimeter(polygon)
  const segmentCount = polygon.length
  let maxInside = 0
  for (let fieldY = 0; fieldY < fieldHeight; fieldY += 1) {
    const y = (fieldY + .5) / fieldScale
    for (let fieldX = 0; fieldX < fieldWidth; fieldX += 1) {
      const x = (fieldX + .5) / fieldScale
      let bestSquared = Infinity
      let bestSegment = 0
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const base = segment * 5
        const startX = segments[base]!
        const startY = segments[base + 1]!
        const deltaX = segments[base + 2]!
        const deltaY = segments[base + 3]!
        const amount = clamp01(((x - startX) * deltaX + (y - startY) * deltaY) * segments[base + 4]!)
        const offsetX = x - (startX + deltaX * amount)
        const offsetY = y - (startY + deltaY * amount)
        const squared = offsetX * offsetX + offsetY * offsetY
        if (squared < bestSquared) {
          bestSquared = squared
          bestSegment = segment
        }
      }
      const index = fieldY * fieldWidth + fieldX
      const distance = Math.sqrt(bestSquared)
      const isInside = pointInsidePolygon(x, y, polygon)
      signedDistance[index] = isInside ? distance : -distance
      edgePosition[index] = bestSegment / segmentCount
      if (isInside && distance > maxInside) maxInside = distance
    }
  }
  return { width: fieldWidth, height: fieldHeight, scale: fieldScale, signedDistance, edgePosition, maxInside }
}

export interface MaskAlphaField {
  width: number
  height: number
  alpha: Uint8ClampedArray
}

/** Pure so the alpha can be asserted in tests; the canvas wrapper only uploads what this returns. */
export function maskAlphaField(geometry: MaskGeometryField, effect: MaskEffectInput, width: number, height: number, projectWidth: number): MaskAlphaField {
  const rasterScale = Math.min(1, MASK_RASTER_RESOLUTION / Math.max(width, height))
  const rasterWidth = Math.max(1, Math.round(width * rasterScale))
  const rasterHeight = Math.max(1, Math.round(height * rasterScale))
  const alpha = new Uint8ClampedArray(rasterWidth * rasterHeight)
  // One raster pixel of ramp: enough to stop the staircase, tight enough to still read as a cut.
  const hardRamp = 1 / rasterScale
  const featherLimit = Math.max(hardRamp, geometry.maxInside * 2)
  const feather = Math.min(effect.feather * width / projectWidth, featherLimit)
  const sampleCount = effect.edgeFeather.length
  for (let rasterY = 0; rasterY < rasterHeight; rasterY += 1) {
    const fieldY = ((rasterY + .5) / rasterScale) * geometry.scale - .5
    const topRow = Math.max(0, Math.min(geometry.height - 1, Math.floor(fieldY)))
    const bottomRow = Math.min(geometry.height - 1, topRow + 1)
    const weightY = clamp01(fieldY - topRow)
    const nearestRow = (weightY < .5 ? topRow : bottomRow) * geometry.width
    for (let rasterX = 0; rasterX < rasterWidth; rasterX += 1) {
      const fieldX = ((rasterX + .5) / rasterScale) * geometry.scale - .5
      const leftColumn = Math.max(0, Math.min(geometry.width - 1, Math.floor(fieldX)))
      const rightColumn = Math.min(geometry.width - 1, leftColumn + 1)
      const weightX = clamp01(fieldX - leftColumn)
      const top = geometry.signedDistance[topRow * geometry.width + leftColumn]! * (1 - weightX)
        + geometry.signedDistance[topRow * geometry.width + rightColumn]! * weightX
      const bottom = geometry.signedDistance[bottomRow * geometry.width + leftColumn]! * (1 - weightX)
        + geometry.signedDistance[bottomRow * geometry.width + rightColumn]! * weightX
      const signed = top * (1 - weightY) + bottom * weightY
      // Edge position wraps at 0/1, so it is picked nearest — blending it would smear sample 31 into 0.
      const nearestColumn = weightX < .5 ? leftColumn : rightColumn
      const sample = Math.floor(geometry.edgePosition[nearestRow + nearestColumn]! * sampleCount) % sampleCount
      const edgeStrength = clamp01(effect.edgeFeather[sample] ?? 1)
      const hardAlpha = clamp01(.5 + signed / hardRamp)
      const softAlpha = feather > 0 ? clamp01(.5 + signed / feather) : hardAlpha
      let value = hardAlpha + (softAlpha - hardAlpha) * edgeStrength
      if (effect.inverted) value = 1 - value
      alpha[rasterY * rasterWidth + rasterX] = Math.round(value * 255)
    }
  }
  return { width: rasterWidth, height: rasterHeight, alpha }
}

export function maskGeometryKey(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number) {
  return [
    width, height, projectWidth, projectHeight,
    layer.shapeKind, layer.shapeWidth, layer.shapeHeight, JSON.stringify(layer.shapePath ?? null),
    evaluateNumericProperty(layer.transform.x, time), evaluateNumericProperty(layer.transform.y, time),
    evaluateNumericProperty(layer.transform.scaleX, time), evaluateNumericProperty(layer.transform.scaleY, time),
    evaluateNumericProperty(layer.transform.rotation, time),
  ].join('|')
}
