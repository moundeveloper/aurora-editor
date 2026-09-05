import type { TimelineMarker } from '@/models/editor'

export const DEFAULT_TIMELINE_MARKER_COLOR = '#8c9bff'

const isMarkerColor = (value: unknown): value is string => (
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
)

/** Repairs user-authored and legacy marker data without making project loading fail. */
export function normalizeTimelineMarkers(raw: unknown, duration: number): TimelineMarker[] {
  if (!Array.isArray(raw)) return []
  const maximum = Math.max(0, Number.isFinite(duration) ? duration : 0)
  const ids = new Set<string>()
  return raw.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return []
    const value = candidate as Partial<TimelineMarker>
    if (!Number.isFinite(value.time)) return []
    let id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `marker-${index + 1}`
    while (ids.has(id)) id = `${id}-${index + 1}`
    ids.add(id)
    return [{
      id,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 120) : `Marker ${index + 1}`,
      time: Math.max(0, Math.min(maximum, value.time as number)),
      color: isMarkerColor(value.color) ? value.color.toLowerCase() : DEFAULT_TIMELINE_MARKER_COLOR,
    }]
  }).sort((left, right) => left.time - right.time || left.name.localeCompare(right.name))
}

/** Returns a magnetic target only while it is inside the view-derived tolerance. */
export function snapTimeToTargets(time: number, targets: readonly number[], tolerance: number) {
  let nearest: number | null = null
  for (const target of targets) {
    if (!Number.isFinite(target)) continue
    if (nearest === null || Math.abs(target - time) < Math.abs(nearest - time)) nearest = target
  }
  return nearest !== null && Math.abs(nearest - time) <= Math.max(0, tolerance) ? nearest : time
}

/** Snaps either edge of a moving range, returning the corresponding start time. */
export function snapRangeStartToTargets(start: number, duration: number, targets: readonly number[], tolerance: number) {
  const snappedStart = snapTimeToTargets(start, targets, tolerance)
  const end = start + duration
  const snappedEnd = snapTimeToTargets(end, targets, tolerance)
  const candidates = [
    ...(snappedStart !== start ? [snappedStart] : []),
    ...(snappedEnd !== end ? [snappedEnd - duration] : []),
  ]
  return candidates.reduce((nearest, candidate) => (
    Math.abs(candidate - start) < Math.abs(nearest - start) ? candidate : nearest
  ), candidates[0] ?? start)
}

export function adjacentTimelineMarker(
  markers: readonly TimelineMarker[],
  time: number,
  direction: -1 | 1,
  tolerance = 0,
) {
  const ordered = [...markers].sort((left, right) => left.time - right.time)
  if (direction > 0) return ordered.find((marker) => marker.time > time + tolerance) ?? null
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const marker = ordered[index]!
    if (marker.time < time - tolerance) return marker
  }
  return null
}
