import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { shapeOutline, shapeSegmentCount, type ShapePoint } from '@/engine/shapes/shapeGeometry'
import type { EditorLayer } from '@/models/editor'

export type MaskPoint = ShapePoint

export interface MaskEffectInput {
  /** Feather width in project pixels, one entry per mask segment. Zero means a hard cut. */
  segmentFeather: number[]
  inverted: boolean
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** Smoothstep, so a feathered edge eases in and out instead of ramping linearly into a visible crease. */
const smoothstep = (value: number) => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/**
 * The distance field is the expensive half of a mask and only changes when the shape or its transform
 * does, so it is sampled coarsely and cached. The alpha raster is far cheaper, repaints on every
 * feather edit, and runs close to render resolution — otherwise a hard edge reaches the compositor as
 * a wide bilinear ramp and reads as a soft one.
 */
export const MASK_FIELD_RESOLUTION = 512
export const MASK_RASTER_RESOLUTION = 1024

/**
 * How much of a segment, at each end, eases between its own feather and its neighbour's.
 *
 * Without this the feather is piecewise constant per segment, and the pixels nearest a vertex flip
 * between two widths across the bisector that splits them — a straight seam radiating out of every
 * corner. Blending toward `min(own, neighbour)` also gives the behaviour a hard corner needs: a hard
 * segment stays hard along its whole length, and the feather emerges gradually along the soft side.
 */
const VERTEX_BLEND = .25

export function transformPerimeter(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number) {
  const scaleX = evaluateNumericProperty(layer.transform.scaleX, time) / 100
  const scaleY = evaluateNumericProperty(layer.transform.scaleY, time) / 100
  const rotation = evaluateNumericProperty(layer.transform.rotation, time) * Math.PI / 180
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const positionX = evaluateNumericProperty(layer.transform.x, time)
  const positionY = evaluateNumericProperty(layer.transform.y, time)
  const outline = shapeOutline(layer, 12)
  if (!outline.closed) return null
  return {
    segmentIndex: outline.segmentIndex,
    segmentCount: outline.segmentCount,
    points: outline.points.map(([localX, localY]) => {
      const x = localX * scaleX
      const y = localY * scaleY
      return [
        (positionX + x * cosine - y * sine) * width / projectWidth,
        (positionY + x * sine + y * cosine) * height / projectHeight,
      ] as MaskPoint
    }),
  }
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

export function distanceToSegment(x: number, y: number, start: MaskPoint, end: MaskPoint) {
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]
  const lengthSquared = deltaX ** 2 + deltaY ** 2
  const amount = lengthSquared ? clamp01(((x - start[0]) * deltaX + (y - start[1]) * deltaY) / lengthSquared) : 0
  return Math.hypot(x - (start[0] + deltaX * amount), y - (start[1] + deltaY * amount))
}

/**
 * Every field pixel walks the whole perimeter, so the flattened segments are packed into one buffer
 * of plain numbers first — an array of tuples costs more in indirection than the arithmetic it feeds.
 * Each entry also carries which mask segment it belongs to and where along that segment it sits, so
 * a pixel's nearest point resolves straight to a feather value.
 */
const STRIDE = 7

function packPerimeter(points: MaskPoint[], segmentIndex: number[], segmentCount: number) {
  const stepsPerSegment = new Array<number>(Math.max(1, segmentCount)).fill(0)
  segmentIndex.forEach((segment) => { stepsPerSegment[segment] = (stepsPerSegment[segment] ?? 0) + 1 })
  const stepWithinSegment = new Array<number>(points.length).fill(0)
  const seen = new Array<number>(Math.max(1, segmentCount)).fill(0)
  points.forEach((_, index) => {
    const segment = segmentIndex[index] ?? 0
    stepWithinSegment[index] = seen[segment]!
    seen[segment] = seen[segment]! + 1
  })

  const packed = new Float64Array(points.length * STRIDE)
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    const deltaX = end[0] - start[0]
    const deltaY = end[1] - start[1]
    const lengthSquared = deltaX ** 2 + deltaY ** 2
    const segment = segmentIndex[index] ?? 0
    const steps = stepsPerSegment[segment] || 1
    packed[index * STRIDE] = start[0]
    packed[index * STRIDE + 1] = start[1]
    packed[index * STRIDE + 2] = deltaX
    packed[index * STRIDE + 3] = deltaY
    packed[index * STRIDE + 4] = lengthSquared ? 1 / lengthSquared : 0
    packed[index * STRIDE + 5] = segment
    // Where this flattened step starts and how much of the parent segment it spans.
    packed[index * STRIDE + 6] = stepWithinSegment[index]! / steps
  }
  return { packed, stepsPerSegment }
}

export interface MaskGeometryField {
  width: number
  height: number
  /** Field pixels per render pixel, so the raster pass can map back into render space. */
  scale: number
  /** Render-space distance to the perimeter, positive inside the shape and negative outside. */
  signedDistance: Float32Array
  /** Which mask segment owns the nearest boundary point. */
  nearestSegment: Uint16Array
  /** Where along that segment the nearest boundary point sits, in [0, 1]. */
  nearestParam: Float32Array
  /**
   * The runner-up segment, and how much of a say it gets.
   *
   * Ownership by nearest segment alone is discontinuous along the medial axis — the set of points
   * equidistant from two segments that are not neighbours, such as a rectangle's corner diagonals or
   * the spine of a concave shape. Crossing it swaps the feather width outright, which shows as a
   * straight seam. Weighting the two candidates by how close their distances are makes the swap a
   * crossfade: away from the axis the nearest segment holds full weight and behaviour is unchanged,
   * and on the axis itself both reach 0.5, so either ordering yields the same width.
   */
  secondSegment: Uint16Array
  secondParam: Float32Array
  secondWeight: Float32Array
  segmentCount: number
  /** Shape bounds in render pixels, before any feather is added. */
  bounds: { left: number; top: number; right: number; bottom: number }
}

export function createMaskGeometry(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number): MaskGeometryField | null {
  if (layer.type !== 'shape') return null
  const perimeter = transformPerimeter(layer, time, width, height, projectWidth, projectHeight)
  if (!perimeter || perimeter.points.length < 3) return null
  const polygon = perimeter.points
  const fieldScale = Math.min(1, MASK_FIELD_RESOLUTION / Math.max(width, height))
  const fieldWidth = Math.max(1, Math.round(width * fieldScale))
  const fieldHeight = Math.max(1, Math.round(height * fieldScale))
  const size = fieldWidth * fieldHeight
  const signedDistance = new Float32Array(size)
  const nearestSegment = new Uint16Array(size)
  const nearestParam = new Float32Array(size)
  const secondSegment = new Uint16Array(size)
  const secondParam = new Float32Array(size)
  const secondWeight = new Float32Array(size)
  const { packed, stepsPerSegment } = packPerimeter(polygon, perimeter.segmentIndex, perimeter.segmentCount)
  const stepCount = polygon.length
  const segmentTotal = Math.max(1, perimeter.segmentCount)
  const perSegmentSquared = new Float64Array(segmentTotal)
  const perSegmentParam = new Float64Array(segmentTotal)

  const xs = polygon.map((point) => point[0])
  const ys = polygon.map((point) => point[1])
  const bounds = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }

  for (let fieldY = 0; fieldY < fieldHeight; fieldY += 1) {
    const y = (fieldY + .5) / fieldScale
    for (let fieldX = 0; fieldX < fieldWidth; fieldX += 1) {
      const x = (fieldX + .5) / fieldScale
      // Closest approach per segment, so the runner-up is the true second-nearest segment rather
      // than whichever step happened to be displaced by the winner.
      perSegmentSquared.fill(Infinity)
      for (let step = 0; step < stepCount; step += 1) {
        const base = step * STRIDE
        const startX = packed[base]!
        const startY = packed[base + 1]!
        const deltaX = packed[base + 2]!
        const deltaY = packed[base + 3]!
        const amount = clamp01(((x - startX) * deltaX + (y - startY) * deltaY) * packed[base + 4]!)
        const offsetX = x - (startX + deltaX * amount)
        const offsetY = y - (startY + deltaY * amount)
        const squared = offsetX * offsetX + offsetY * offsetY
        const segment = packed[base + 5]!
        if (squared < perSegmentSquared[segment]!) {
          perSegmentSquared[segment] = squared
          perSegmentParam[segment] = clamp01(packed[base + 6]! + amount / (stepsPerSegment[segment] || 1))
        }
      }
      let bestSegment = 0
      let bestSquared = Infinity
      let runnerSegment = -1
      let runnerSquared = Infinity
      for (let segment = 0; segment < segmentTotal; segment += 1) {
        const squared = perSegmentSquared[segment]!
        if (squared < bestSquared) {
          runnerSquared = bestSquared
          runnerSegment = bestSegment
          bestSquared = squared
          bestSegment = segment
        } else if (squared < runnerSquared) {
          runnerSquared = squared
          runnerSegment = segment
        }
      }

      const index = fieldY * fieldWidth + fieldX
      const distance = Math.sqrt(bestSquared)
      signedDistance[index] = pointInsidePolygon(x, y, polygon) ? distance : -distance
      nearestSegment[index] = bestSegment
      nearestParam[index] = perSegmentParam[bestSegment]!

      if (runnerSegment >= 0 && runnerSegment !== bestSegment && Number.isFinite(runnerSquared)) {
        secondSegment[index] = runnerSegment
        secondParam[index] = perSegmentParam[runnerSegment]!
        /*
         * Full weight to the nearest segment until the runner-up is genuinely competitive, reaching an
         * even split only where the two are equidistant. The window scales with depth so it stays
         * narrow against an edge — a pixel a couple of pixels inside a hard segment must not pick up
         * any of its neighbour's width — and widens where no single segment clearly speaks for a pixel.
         */
        secondWeight[index] = smoothstep(1 - (Math.sqrt(runnerSquared) - distance) / (distance * 1.5 + 1)) * .5
      } else {
        secondSegment[index] = bestSegment
        secondParam[index] = nearestParam[index]!
        secondWeight[index] = 0
      }
    }
  }
  return {
    width: fieldWidth,
    height: fieldHeight,
    scale: fieldScale,
    signedDistance,
    nearestSegment,
    nearestParam,
    secondSegment,
    secondParam,
    secondWeight,
    segmentCount: Math.max(1, perimeter.segmentCount),
    bounds,
  }
}

/**
 * The feather width governing a point, given which segment owns its nearest boundary point and where
 * along that segment it sits. Constant across the middle of a segment, easing toward the smaller of
 * the two feathers at each end — see {@link VERTEX_BLEND}.
 */
export function featherAt(segmentFeather: number[], segmentCount: number, segment: number, param: number) {
  const own = Math.max(0, segmentFeather[segment] ?? 0)
  if (param < VERTEX_BLEND) {
    const previous = Math.max(0, segmentFeather[(segment - 1 + segmentCount) % segmentCount] ?? 0)
    const start = Math.min(own, previous)
    return start + (own - start) * smoothstep(param / VERTEX_BLEND)
  }
  if (param > 1 - VERTEX_BLEND) {
    const next = Math.max(0, segmentFeather[(segment + 1) % segmentCount] ?? 0)
    const end = Math.min(own, next)
    return end + (own - end) * smoothstep((1 - param) / VERTEX_BLEND)
  }
  return own
}

/**
 * The feather width in force at one field sample: the owning segment's, crossfaded toward the
 * runner-up wherever no single segment clearly speaks for the pixel.
 */
export function resolveFeather(geometry: MaskGeometryField, feathers: number[], fieldIndex: number) {
  const primary = featherAt(feathers, geometry.segmentCount, geometry.nearestSegment[fieldIndex]!, geometry.nearestParam[fieldIndex]!)
  const weight = geometry.secondWeight[fieldIndex]!
  if (weight <= 0) return primary
  const runner = featherAt(feathers, geometry.segmentCount, geometry.secondSegment[fieldIndex]!, geometry.secondParam[fieldIndex]!)
  return primary + (runner - primary) * weight
}

/** Separable three-tap average, run in place over a scalar field. Edges clamp. */
function smoothScalarField(values: Float32Array, width: number, height: number) {
  const scratch = new Float32Array(values.length)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const left = values[row + Math.max(0, x - 1)]!
      const right = values[row + Math.min(width - 1, x + 1)]!
      scratch[row + x] = (left + values[row + x]! + right) / 3
    }
  }
  for (let y = 0; y < height; y += 1) {
    const above = Math.max(0, y - 1) * width
    const below = Math.min(height - 1, y + 1) * width
    const row = y * width
    for (let x = 0; x < width; x += 1) values[row + x] = (scratch[above + x]! + scratch[row + x]! + scratch[below + x]!) / 3
  }
}

export interface MaskAlphaField {
  width: number
  height: number
  alpha: Uint8ClampedArray
  /** Feather width used at each pixel, in render pixels. Zero marks a hard cut. */
  feather: Float32Array
}

/**
 * Pure, so the alpha can be asserted directly in tests; the canvas wrapper only uploads what this
 * returns, and a GPU port would evaluate the same rules per fragment against the same data model.
 */
export function maskAlphaField(geometry: MaskGeometryField, effect: MaskEffectInput, width: number, height: number, projectWidth: number): MaskAlphaField {
  const rasterScale = Math.min(1, MASK_RASTER_RESOLUTION / Math.max(width, height))
  const rasterWidth = Math.max(1, Math.round(width * rasterScale))
  const rasterHeight = Math.max(1, Math.round(height * rasterScale))
  const alpha = new Uint8ClampedArray(rasterWidth * rasterHeight)
  const featherUsed = new Float32Array(rasterWidth * rasterHeight)
  const toRender = width / projectWidth
  const feathers = Array.from({ length: geometry.segmentCount }, (_, index) => Math.max(0, effect.segmentFeather[index] ?? 0) * toRender)
  // One raster pixel of ramp, so a hard cut is antialiased rather than a staircase, and no wider.
  const hardRamp = 1 / rasterScale

  /*
   * Only the shape plus the widest feather can be anything but fully outside, so the rest of the
   * frame is filled in bulk instead of evaluated. An inverted mask flips which value that is.
   */
  /*
   * Resolve the width once per field sample, then interpolate it like any other scalar. Reading it
   * nearest instead quantises the crossfade to the field grid, and because the crossfade turns over
   * within a few pixels of the medial axis that shows up as steps in the fade.
   */
  const fieldFeather = new Float32Array(geometry.width * geometry.height)
  for (let index = 0; index < fieldFeather.length; index += 1) fieldFeather[index] = resolveFeather(geometry, feathers, index)
  /*
   * A one-cell smoothing of the width field, and only the width field — the mask itself is never
   * blurred, so a hard segment still resolves to width zero along its whole length and stays a cut.
   * This bounds how fast the width may change to roughly one field cell, which is what stops the
   * crossfade from stepping where two very different widths meet.
   */
  smoothScalarField(fieldFeather, geometry.width, geometry.height)

  const margin = Math.max(...feathers, 0) + hardRamp * 2
  const outsideAlpha = effect.inverted ? 255 : 0
  if (outsideAlpha) alpha.fill(255)
  const firstX = Math.max(0, Math.floor((geometry.bounds.left - margin) * rasterScale))
  const lastX = Math.min(rasterWidth - 1, Math.ceil((geometry.bounds.right + margin) * rasterScale))
  const firstY = Math.max(0, Math.floor((geometry.bounds.top - margin) * rasterScale))
  const lastY = Math.min(rasterHeight - 1, Math.ceil((geometry.bounds.bottom + margin) * rasterScale))

  for (let rasterY = firstY; rasterY <= lastY; rasterY += 1) {
    const fieldY = ((rasterY + .5) / rasterScale) * geometry.scale - .5
    const topRow = Math.max(0, Math.min(geometry.height - 1, Math.floor(fieldY)))
    const bottomRow = Math.min(geometry.height - 1, topRow + 1)
    const weightY = clamp01(fieldY - topRow)
    const nearestRow = (weightY < .5 ? topRow : bottomRow) * geometry.width
    for (let rasterX = firstX; rasterX <= lastX; rasterX += 1) {
      const fieldX = ((rasterX + .5) / rasterScale) * geometry.scale - .5
      const leftColumn = Math.max(0, Math.min(geometry.width - 1, Math.floor(fieldX)))
      const rightColumn = Math.min(geometry.width - 1, leftColumn + 1)
      const weightX = clamp01(fieldX - leftColumn)
      const top = geometry.signedDistance[topRow * geometry.width + leftColumn]! * (1 - weightX)
        + geometry.signedDistance[topRow * geometry.width + rightColumn]! * weightX
      const bottom = geometry.signedDistance[bottomRow * geometry.width + leftColumn]! * (1 - weightX)
        + geometry.signedDistance[bottomRow * geometry.width + rightColumn]! * weightX
      const signed = top * (1 - weightY) + bottom * weightY

      // Segment ownership is picked nearest, never blended: averaging it across a corner is exactly
      // what would let a feathered segment soften the hard one beside it.
      const featherTop = fieldFeather[topRow * geometry.width + leftColumn]! * (1 - weightX)
        + fieldFeather[topRow * geometry.width + rightColumn]! * weightX
      const featherBottom = fieldFeather[bottomRow * geometry.width + leftColumn]! * (1 - weightX)
        + fieldFeather[bottomRow * geometry.width + rightColumn]! * weightX
      const feather = featherTop * (1 - weightY) + featherBottom * weightY

      /*
       * A hard segment collapses to a single antialiased pixel centred on the edge. A feathered one
       * runs from the edge inward over its own width, so the fade never reaches outside the shape and
       * a wide feather can not bleed across whatever the mask is applied to.
       */
      const width = Math.max(feather, hardRamp)
      let value = smoothstep((signed + hardRamp * .5) / width)
      if (effect.inverted) value = 1 - value
      const rasterIndex = rasterY * rasterWidth + rasterX
      alpha[rasterIndex] = Math.round(value * 255)
      featherUsed[rasterIndex] = feather
    }
  }
  return { width: rasterWidth, height: rasterHeight, alpha, feather: featherUsed }
}

export function maskGeometryKey(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number) {
  return [
    width, height, projectWidth, projectHeight,
    layer.shapeKind, layer.shapeWidth, layer.shapeHeight, shapeSegmentCount(layer), JSON.stringify(layer.shapePath ?? null),
    evaluateNumericProperty(layer.transform.x, time), evaluateNumericProperty(layer.transform.y, time),
    evaluateNumericProperty(layer.transform.scaleX, time), evaluateNumericProperty(layer.transform.scaleY, time),
    evaluateNumericProperty(layer.transform.rotation, time),
  ].join('|')
}
