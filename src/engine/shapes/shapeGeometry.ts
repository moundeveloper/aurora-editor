import type { EditorLayer } from '@/models/editor'

export type ShapePoint = [number, number]

export interface ShapeOutline {
  points: ShapePoint[]
  closed: boolean
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

/** Flattened in stable clockwise/path order so rendering and edge painting address identical regions. */
export function shapeOutline(layer: EditorLayer, curveSteps = 16): ShapeOutline {
  if (layer.shapeKind === 'path') {
    const path = layer.shapePath
    if (!path?.points.length) return { points: [], closed: false }
    const flattened: ShapePoint[] = []
    const segmentCount = path.closed ? path.points.length : Math.max(0, path.points.length - 1)
    for (let index = 0; index < segmentCount; index += 1) {
      const start = path.points[index]!
      const end = path.points[(index + 1) % path.points.length]!
      for (let step = 0; step < curveSteps; step += 1) {
        flattened.push(cubicShapePoint(start.position, start.handleOut, end.handleIn, end.position, step / curveSteps))
      }
    }
    if (!path.closed && path.points.at(-1)) flattened.push([...path.points.at(-1)!.position])
    return { points: flattened, closed: path.closed && path.points.length >= 3 }
  }

  const shapeWidth = layer.shapeWidth ?? 280
  const shapeHeight = layer.shapeHeight ?? 180
  if (layer.shapeKind === 'ellipse') {
    return {
      closed: true,
      points: Array.from({ length: 64 }, (_, index) => {
        const angle = -Math.PI / 2 + index / 64 * Math.PI * 2
        return [Math.cos(angle) * shapeWidth / 2, Math.sin(angle) * shapeHeight / 2]
      }),
    }
  }
  return {
    closed: true,
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
