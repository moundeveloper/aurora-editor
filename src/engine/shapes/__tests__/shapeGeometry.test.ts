import { describe, expect, it } from 'vitest'
import { shapeOutline } from '@/engine/shapes/shapeGeometry'
import { numericProperty } from '@/engine/scene3d/sceneFactory'
import type { EditorLayer } from '@/models/editor'

function shapeLayer(): EditorLayer {
  return {
    id: 'shape', name: 'Shape', type: 'shape', shapeKind: 'rectangle', shapeWidth: 320, shapeHeight: 180,
    start: 0, duration: 10, color: '#fff', visible: true, locked: false, muted: false, expanded: false, effects: [],
    transform: {
      x: numericProperty('x', 0), y: numericProperty('y', 0), scaleX: numericProperty('sx', 100),
      scaleY: numericProperty('sy', 100), rotation: numericProperty('r', 0), opacity: numericProperty('o', 100),
    },
  }
}

describe('shape outlines', () => {
  it('returns the authored rectangle proportions in stable perimeter order', () => {
    const outline = shapeOutline(shapeLayer())
    expect(outline.closed).toBe(true)
    expect(outline.points).toHaveLength(32)
    expect(Math.min(...outline.points.map(([x]) => x))).toBe(-160)
    expect(Math.max(...outline.points.map(([, y]) => y))).toBe(90)
  })

  it('flattens the actual bezier handles instead of substituting a generic box', () => {
    const layer = shapeLayer()
    layer.shapeKind = 'path'
    layer.shapePath = {
      closed: true,
      points: [
        { id: 'a', position: [-100, 0], handleIn: [-100, 0], handleOut: [-100, -120] },
        { id: 'b', position: [100, 0], handleIn: [100, -120], handleOut: [140, 80] },
        { id: 'c', position: [0, 100], handleIn: [80, 120], handleOut: [-80, 120] },
      ],
    }
    const outline = shapeOutline(layer, 8)
    expect(outline.closed).toBe(true)
    expect(outline.points).toHaveLength(24)
    expect(Math.min(...outline.points.map(([, y]) => y))).toBeLessThan(-70)
  })

  it('keeps an open path visible to the editor but marks it invalid as a mask', () => {
    const layer = shapeLayer()
    layer.shapeKind = 'path'
    layer.shapePath = {
      closed: false,
      points: [
        { id: 'a', position: [0, 0], handleIn: [0, 0], handleOut: [20, 0] },
        { id: 'b', position: [100, 50], handleIn: [80, 50], handleOut: [100, 50] },
      ],
    }
    const outline = shapeOutline(layer, 4)
    expect(outline.closed).toBe(false)
    expect(outline.points.at(-1)).toEqual([100, 50])
  })
})
