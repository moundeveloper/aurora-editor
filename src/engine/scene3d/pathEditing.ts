import type { Aurora3DPath, Aurora3DPathPoint, AuroraPathPointMode } from '@/models/editor'

export type PathVector = [number, number, number]
export type PathHandleKey = 'position' | 'handleIn' | 'handleOut'

const add = (left: PathVector, right: PathVector): PathVector => [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
const subtract = (left: PathVector, right: PathVector): PathVector => [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
const scale = (value: PathVector, factor: number): PathVector => [value[0] * factor, value[1] * factor, value[2] * factor]
const lerp = (left: PathVector, right: PathVector, ratio: number): PathVector => add(left, scale(subtract(right, left), ratio))
const length = (value: PathVector) => Math.hypot(value[0], value[1], value[2])

const oppositeHandle = (handle: 'handleIn' | 'handleOut') => handle === 'handleIn' ? 'handleOut' : 'handleIn'

/** Moves an anchor and carries both Bézier handles with it, so the segment shape is preserved. */
export function movePathPoint(point: Aurora3DPathPoint, position: PathVector) {
  const delta = subtract(position, point.position)
  point.position = position
  point.handleIn = add(point.handleIn, delta)
  point.handleOut = add(point.handleOut, delta)
}

/** Moves one Bézier handle; a smooth point mirrors the opposite handle and keeps its own length. */
export function movePathHandle(point: Aurora3DPathPoint, handle: 'handleIn' | 'handleOut', position: PathVector) {
  point[handle] = position
  if (point.mode !== 'smooth') return
  const mirrored = oppositeHandle(handle)
  const outgoing = subtract(position, point.position)
  const outgoingLength = length(outgoing)
  const mirroredLength = length(subtract(point[mirrored], point.position))
  if (outgoingLength < 0.000001) {
    point[mirrored] = [...point.position]
    return
  }
  point[mirrored] = add(point.position, scale(outgoing, -(mirroredLength || outgoingLength) / outgoingLength))
}

/** Corner collapses the handles onto the anchor; smooth rebuilds a symmetric pair from the neighbours. */
export function setPathPointMode(path: Aurora3DPath, pointId: string, mode: AuroraPathPointMode) {
  const index = path.points.findIndex((item) => item.id === pointId)
  const point = path.points[index]
  if (!point) return
  point.mode = mode
  if (mode === 'corner') {
    point.handleIn = [...point.position]
    point.handleOut = [...point.position]
    return
  }
  const previous = path.points[index - 1] ?? (path.closed ? path.points[path.points.length - 1] : undefined)
  const next = path.points[index + 1] ?? (path.closed ? path.points[0] : undefined)
  const reference = subtract(next?.position ?? point.position, previous?.position ?? point.position)
  const referenceLength = length(reference)
  const direction: PathVector = referenceLength < 0.000001 ? [1, 0, 0] : scale(reference, 1 / referenceLength)
  const span = Math.max(0.35, referenceLength / 4)
  point.handleIn = add(point.position, scale(direction, -span))
  point.handleOut = add(point.position, scale(direction, span))
}

/** Splits the segment that starts at `segmentIndex` with de Casteljau, so the curve keeps its exact shape. */
export function insertPathPoint(path: Aurora3DPath, segmentIndex: number): Aurora3DPathPoint | null {
  const from = path.points[segmentIndex]
  const to = path.points[(segmentIndex + 1) % path.points.length]
  if (!from || !to || from === to) return null
  const first = lerp(from.position, from.handleOut, .5)
  const middle = lerp(from.handleOut, to.handleIn, .5)
  const last = lerp(to.handleIn, to.position, .5)
  const incoming = lerp(first, middle, .5)
  const outgoing = lerp(middle, last, .5)
  const point: Aurora3DPathPoint = {
    id: crypto.randomUUID(),
    position: lerp(incoming, outgoing, .5),
    handleIn: incoming,
    handleOut: outgoing,
    mode: 'smooth',
  }
  from.handleOut = first
  to.handleIn = last
  path.points.splice(segmentIndex + 1, 0, point)
  return point
}

/** Appends a point that continues the current direction of travel at the end of the path. */
export function appendPathPoint(path: Aurora3DPath): Aurora3DPathPoint | null {
  const last = path.points[path.points.length - 1]
  if (!last) return null
  const previous = path.points[path.points.length - 2]
  const heading = subtract(last.position, previous?.position ?? subtract(last.position, [1, 0, 0]))
  const headingLength = length(heading)
  const direction: PathVector = headingLength < 0.000001 ? [1, 0, 0] : scale(heading, 1 / headingLength)
  const span = Math.max(1.5, headingLength)
  const position = add(last.position, scale(direction, span))
  const point: Aurora3DPathPoint = {
    id: crypto.randomUUID(),
    position,
    handleIn: add(position, scale(direction, -span / 3)),
    handleOut: add(position, scale(direction, span / 3)),
    mode: 'smooth',
  }
  path.points.push(point)
  return point
}
