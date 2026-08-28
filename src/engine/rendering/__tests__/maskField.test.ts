import { describe, expect, it } from 'vitest'
import { createMaskGeometry, maskAlphaField } from '@/engine/rendering/maskField'
import type { EditorLayer } from '@/models/editor'

const channel = (value: number) => ({ value, animated: false, keyframes: [] })

const rectangleShape = (): EditorLayer => ({
  id: 'shape', name: 'Shape', type: 'shape', shapeKind: 'rectangle',
  shapeWidth: 400, shapeHeight: 260,
  start: 0, duration: 10, visible: true, locked: false, track: 0,
  transform: { x: channel(640), y: channel(360), scaleX: channel(100), scaleY: channel(100), rotation: channel(0) },
} as unknown as EditorLayer)

const neutralEdge = Array.from({ length: 32 }, () => 1)

function fieldFor(feather: number, edgeFeather = neutralEdge) {
  const geometry = createMaskGeometry(rectangleShape(), 0, 1280, 720, 1280, 720)!
  const field = maskAlphaField(geometry, { feather, edgeFeather, inverted: false }, 1280, 720, 1280)
  const at = (x: number, y: number) => field.alpha[Math.round(y * field.height) * field.width + Math.round(x * field.width)]!
  return { geometry, field, at }
}

describe('mask alpha field', () => {
  it('reaches full opacity at the centre and zero at the frame corners for every feather width', () => {
    for (const feather of [0, 24, 130, 400]) {
      const { at } = fieldFor(feather)
      expect(at(.5, .5), `centre at feather ${feather}`).toBe(255)
      expect(at(.02, .02), `corner at feather ${feather}`).toBe(0)
      expect(at(.98, .5), `right edge at feather ${feather}`).toBe(0)
    }
  })

  it('caps the ramp so a feather wider than the shape cannot wash the whole frame', () => {
    // The shape is 400x260, so half its short side is 130 — the ramp may not reach further than that.
    const wide = fieldFor(4000)
    // Sampled on the field grid, so it lands just under the exact 130.
    expect(wide.geometry.maxInside).toBeGreaterThan(126)
    expect(wide.geometry.maxInside).toBeLessThanOrEqual(130)
    expect(wide.at(.5, .5)).toBe(255)
    // The shape's left edge sits at 440px, and the ramp may reach 130px past it. 128px in is well clear.
    expect(wide.at(.1, .5)).toBe(0)
  })

  it('keeps a hard edge inside two output pixels while a feathered edge spreads', () => {
    const hardRun = (feather: number) => {
      const { field } = fieldFor(feather)
      const row = Math.round(field.height / 2)
      let partial = 0
      for (let x = 0; x < field.width; x += 1) {
        const value = field.alpha[row * field.width + x]!
        if (value > 0 && value < 255) partial += 1
      }
      return partial
    }
    // Two edges crossed per row, so a hard cut allows at most a couple of pixels each.
    expect(hardRun(0)).toBeLessThanOrEqual(4)
    expect(hardRun(130)).toBeGreaterThan(40)
  })

  it('paints a hard cut where the edge is painted hard and leaves the rest feathered', () => {
    const painted = neutralEdge.map((_, index) => (index < 8 ? 0 : 1))
    const { field } = fieldFor(130, painted)
    const values = new Set(field.alpha)
    expect(values.has(0)).toBe(true)
    expect(values.has(255)).toBe(true)
    // A fully feathered field and a fully hard field differ, so the mix must land between them.
    expect(field.alpha.some((value) => value > 0 && value < 255)).toBe(true)
  })
})
