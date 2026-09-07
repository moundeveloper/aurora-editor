import type { EditorLayer, ShapePathPoint } from '@/models/editor'
import { evaluatedShapePoint } from './shapeAnimation'

export type ShapePoint = [number, number]

export interface ShapeOutline {
  points: ShapePoint[]
  closed: boolean
  /**
   * Which mask segment each flattened point belongs to. Feather is a per-segment property, so the
   * renderer needs to map a point on the flattened outline back to the segment that authored it.
   * A path segment is one Bézier span, a rectangle has four sides, an ellipse four quadrants.
   */
  segmentIndex: number[]
  segmentCount: number
}

export function cubicShapePoint(start: ShapePoint, controlA: ShapePoint, controlB: ShapePoint, end: ShapePoint, amount: number): ShapePoint {
  const inverse = 1 - amount
  const a = inverse ** 3
  const b = 3 * inverse ** 2 * amount
  const c = 3 * inverse * amount ** 2
  const d = amount ** 3
  return [
    start[0] * a + controlA[0] * b + controlB[0] * c + end[0] * d,
    start[1] * a + controlA[1] * b + controlB[1] * c + end[1] * d,
  ]
}

/** How far a control point strays from the chord — zero when the span is really a straight line. */
function chordDeviation(point: ShapePoint, start: ShapePoint, end: ShapePoint) {
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]
  const length = Math.hypot(deltaX, deltaY)
  if (!length) return Math.hypot(point[0] - start[0], point[1] - start[1])
  return Math.abs((point[0] - start[0]) * deltaY - (point[1] - start[1]) * deltaX) / length
}

/**
 * Steps needed to flatten one span without the result reading as straight runs joined by corners.
 * Driven by curvature rather than a fixed count: a span whose handles sit on its anchors is a line
 * and needs one step, while a tight curve earns as many as the quality hint allows. Cost then tracks
 * how curved a shape actually is instead of how many points someone drew.
 */
function spanSteps(start: ShapePathPoint, end: ShapePathPoint, maximum: number) {
  const deviation = Math.max(
    chordDeviation(start.handleOut, start.position, end.position),
    chordDeviation(end.handleIn, start.position, end.position),
  )
  return Math.max(1, Math.min(maximum, Math.ceil(Math.sqrt(deviation) * 2.5)))
}

/** Flattened in stable clockwise/path order so rendering and edge painting address identical regions. */
export function shapeOutline(layer: EditorLayer, curveSteps = 16, time = 0): ShapeOutline {
  if (layer.shapeKind === 'path') {
    const path = layer.shapePath ? {...layer.shapePath,points:layer.shapePath.points.map(point=>evaluatedShapePoint(point,time))} : undefined
    if (!path?.points.length) return { points: [], closed: false, segmentIndex: [], segmentCount: 0 }
    const flattened: ShapePoint[] = []
    const segmentIndex: number[] = []
    const segmentCount = path.closed ? path.points.length : Math.max(0, path.points.length - 1)
    for (let index = 0; index < segmentCount; index += 1) {
      const start = path.points[index]!
      const end = path.points[(index + 1) % path.points.length]!
      const steps = spanSteps(start, end, curveSteps)
      for (let step = 0; step < steps; step += 1) {
        flattened.push(cubicShapePoint(start.position, start.handleOut, end.handleIn, end.position, step / steps))
        segmentIndex.push(index)
      }
    }
    if (!path.closed && path.points.at(-1)) {
      flattened.push([...path.points.at(-1)!.position])
      segmentIndex.push(Math.max(0, segmentCount - 1))
    }
    return { points: flattened, closed: path.closed && path.points.length >= 3, segmentIndex, segmentCount }
  }

  const shapeWidth = layer.shapeWidth ?? 280
  const shapeHeight = layer.shapeHeight ?? 180
  if (layer.shapeKind === 'ellipse') {
    // Four quadrants, so an ellipse offers the same per-segment feather control as a rectangle's sides.
    return {
      closed: true,
      segmentCount: 4,
      segmentIndex: Array.from({ length: 64 }, (_, index) => Math.floor(index / 16)),
      points: Array.from({ length: 64 }, (_, index) => {
        const angle = -Math.PI / 2 + index / 64 * Math.PI * 2
        return [Math.cos(angle) * shapeWidth / 2, Math.sin(angle) * shapeHeight / 2]
      }),
    }
  }
  return {
    closed: true,
    segmentCount: 4,
    segmentIndex: Array.from({ length: 32 }, (_, index) => Math.floor(index / 8)),
    points: Array.from({ length: 32 }, (_, index) => {
      const side = Math.floor(index / 8)
      const amount = (index % 8) / 8
      if (side === 0) return [-shapeWidth / 2 + shapeWidth * amount, -shapeHeight / 2]
      if (side === 1) return [shapeWidth / 2, -shapeHeight / 2 + shapeHeight * amount]
      if (side === 2) return [shapeWidth / 2 - shapeWidth * amount, shapeHeight / 2]
      return [-shapeWidth / 2, shapeHeight / 2 - shapeHeight * amount]
    }),
  }
}

/** How many independently featherable segments a shape exposes. */
export function shapeSegmentCount(layer: EditorLayer) {
  if (layer.shapeKind === 'path') {
    const points = layer.shapePath?.points.length ?? 0
    if (!points) return 0
    return layer.shapePath?.closed ? points : Math.max(0, points - 1)
  }
  return 4
}
