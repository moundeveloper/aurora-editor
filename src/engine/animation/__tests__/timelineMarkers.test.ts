import { describe, expect, it } from 'vitest'
import { adjacentTimelineMarker, normalizeTimelineMarkers, snapRangeStartToTargets, snapTimeToTargets } from '../timelineMarkers'

describe('timeline markers', () => {
  it('repairs, bounds, sorts, and de-duplicates persisted markers', () => {
    expect(normalizeTimelineMarkers([
      { id: 'beat', name: '  Beat  ', time: 8, color: '#A5B4FC' },
      { id: 'beat', name: '', time: -2, color: 'purple' },
      { id: 'bad', name: 'Bad', time: Number.NaN, color: '#ffffff' },
    ], 6)).toEqual([
      { id: 'beat-2', name: 'Marker 2', time: 0, color: '#8c9bff' },
      { id: 'beat', name: 'Beat', time: 6, color: '#a5b4fc' },
    ])
  })

  it('snaps only inside the supplied magnetic tolerance', () => {
    expect(snapTimeToTargets(4.96, [2, 5, 9], .05)).toBe(5)
    expect(snapTimeToTargets(4.9, [2, 5, 9], .05)).toBe(4.9)
  })

  it('snaps a moving clip by either its start or end edge', () => {
    expect(snapRangeStartToTargets(2.96, 2, [3, 8], .05)).toBe(3)
    expect(snapRangeStartToTargets(5.03, 3, [3, 8], .05)).toBe(5)
  })

  it('finds strictly adjacent markers and skips the marker under the playhead', () => {
    const markers = normalizeTimelineMarkers([
      { id: 'a', name: 'A', time: 1, color: '#ffffff' },
      { id: 'b', name: 'B', time: 3, color: '#ffffff' },
      { id: 'c', name: 'C', time: 6, color: '#ffffff' },
    ], 10)
    expect(adjacentTimelineMarker(markers, 3, -1, .01)?.id).toBe('a')
    expect(adjacentTimelineMarker(markers, 3, 1, .01)?.id).toBe('c')
    expect(adjacentTimelineMarker(markers, 0, -1)).toBeNull()
  })
})
