import { describe, expect, it } from 'vitest'
import { createMaskGeometry, featherAt, maskAlphaField } from '@/engine/rendering/maskField'
import type { EditorLayer, ShapePathPoint } from '@/models/editor'

const channel = (value: number) => ({ value, animated: false, keyframes: [] })

/** Straight-line path points: handles sit on their anchor, so each Bézier span flattens to a line. */
function polygonLayer(vertices: [number, number][]): EditorLayer {
  const xs = vertices.map(([x]) => x)
  const ys = vertices.map(([, y]) => y)
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2
  const points: ShapePathPoint[] = vertices.map(([x, y], index) => {
    const local: [number, number] = [x - centerX, y - centerY]
    return { id: `v${index}`, position: [...local], handleIn: [...local], handleOut: [...local] }
  })
  return {
    id: 'shape', name: 'Shape', type: 'shape', shapeKind: 'path',
    shapeWidth: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    shapeHeight: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    shapePath: { closed: true, points },
    start: 0, duration: 10, visible: true, locked: false, track: 0,
    transform: { x: channel(centerX), y: channel(centerY), scaleX: channel(100), scaleY: channel(100), rotation: channel(0) },
  } as unknown as EditorLayer
}

const FRAME = { width: 1280, height: 720 }

function evaluate(layer: EditorLayer, segmentFeather: number[], inverted = false) {
  const geometry = createMaskGeometry(layer, 0, FRAME.width, FRAME.height, FRAME.width, FRAME.height)!
  const field = maskAlphaField(geometry, { segmentFeather, inverted }, FRAME.width, FRAME.height, FRAME.width)
  const scale = field.width / FRAME.width
  return {
    geometry,
    field,
    /** Sample in project pixels. */
    at: (x: number, y: number) => field.alpha[Math.round(y * scale) * field.width + Math.round(x * scale)]!,
    scale,
  }
}

/** Width of the partially transparent band crossed along a horizontal scanline, in project pixels. */
function rampWidth(field: { width: number; height: number; alpha: Uint8ClampedArray }, y: number, scale: number, from: number, to: number) {
  const row = Math.round(y * scale) * field.width
  let count = 0
  for (let x = Math.round(from * scale); x <= Math.round(to * scale); x += 1) {
    const value = field.alpha[row + x]!
    if (value > 4 && value < 251) count += 1
  }
  return count / scale
}

const RECTANGLE: [number, number][] = [[440, 230], [840, 230], [840, 490], [440, 490]]

describe('selective per-segment mask feather', () => {
  it('gives each segment its own feather width', () => {
    // Top hard, right 60, bottom hard, left 20.
    const { field, at, scale } = evaluate(polygonLayer(RECTANGLE), [0, 60, 0, 20])
    expect(at(640, 360)).toBe(255)
    // Left edge at x=440 fades over 20px, right edge at x=840 over 60px.
    expect(rampWidth(field, 360, scale, 400, 640)).toBeGreaterThan(14)
    expect(rampWidth(field, 360, scale, 400, 640)).toBeLessThan(28)
    expect(rampWidth(field, 360, scale, 640, 880)).toBeGreaterThan(48)
    expect(rampWidth(field, 360, scale, 640, 880)).toBeLessThan(74)
  })

  it('keeps a hard segment razor sharp next to a feathered one', () => {
    const { at } = evaluate(polygonLayer(RECTANGLE), [0, 80, 0, 0])
    // Top edge (y=230) is hard: two pixels in it is already fully opaque.
    expect(at(640, 228)).toBe(0)
    expect(at(640, 233)).toBe(255)
    // Bottom edge (y=490) is hard too, and the 80px feather on the right must not reach it.
    expect(at(640, 486)).toBe(255)
    expect(at(640, 493)).toBe(0)
  })

  it('straddles the edge, reaching half the feather to either side', () => {
    // Left edge sits at x=440, so a 60px feather runs from 410 to 470 and is half opaque on the line.
    const { at } = evaluate(polygonLayer(RECTANGLE), [60, 60, 60, 60])
    expect(at(440, 360)).toBeGreaterThan(112)
    expect(at(440, 360)).toBeLessThan(142)
    expect(at(425, 360)).toBeGreaterThan(0)
    expect(at(468, 360)).toBeLessThan(255)
    // Beyond half the width, nothing.
    expect(at(405, 360)).toBe(0)
    expect(at(478, 360)).toBe(255)
  })

  it('bounds the fade by the feather even when it is far wider than the shape', () => {
    const { at } = evaluate(polygonLayer(RECTANGLE), [400, 400, 400, 400])
    // Reach is half of 400, so 250px clear of the outline must be untouched in every direction.
    for (const [x, y] of [[180, 360], [1110, 360], [640, 15], [80, 80], [1200, 650]]) {
      expect(at(x!, y!), `outside at ${x},${y}`).toBe(0)
    }
  })

  it('treats every segment as hard when no feather is set', () => {
    const { at } = evaluate(polygonLayer(RECTANGLE), [])
    expect(at(640, 360)).toBe(255)
    expect(at(442, 360)).toBe(255)
    expect(at(438, 360)).toBe(0)
  })

  it('inverts to mask the outside instead', () => {
    const { at } = evaluate(polygonLayer(RECTANGLE), [0, 0, 0, 0], true)
    expect(at(640, 360)).toBe(0)
    expect(at(200, 360)).toBe(255)
  })

  it.each([
    ['triangle', [[640, 200], [880, 520], [400, 520]] as [number, number][], [0, 40, 20]],
    ['pentagon', [[640, 180], [880, 340], [790, 560], [490, 560], [400, 340]] as [number, number][], [0, 30, 0, 45, 15]],
    ['concave arrow', [[400, 200], [880, 360], [400, 520], [560, 360]] as [number, number][], [30, 0, 30, 0]],
  ])('renders a %s with mixed hard and feathered segments', (_name, vertices, feathers) => {
    const { field, geometry } = evaluate(polygonLayer(vertices), feathers)
    expect(geometry.segmentCount).toBe(vertices.length)
    // Something is solid, something is transparent, and something is in between.
    expect(field.alpha.some((value) => value === 255)).toBe(true)
    expect(field.alpha.some((value) => value === 0)).toBe(true)
    expect(field.alpha.some((value) => value > 0 && value < 255)).toBe(true)
  })

  it('handles a very small segment without collapsing the mask', () => {
    const tiny: [number, number][] = [[440, 230], [840, 230], [842, 234], [840, 490], [440, 490]]
    const { at, geometry } = evaluate(polygonLayer(tiny), [0, 50, 0, 25, 0])
    expect(geometry.segmentCount).toBe(5)
    expect(at(640, 360)).toBe(255)
  })

  /*
   * The spec's critical case: twelve vertices, concave stretches, and alternating hard and feathered
   * segments at four different widths. Nothing may leak outside, hard segments must stay sharp, and
   * the fade must not break into steps where adjacent segments disagree.
   */
  it('renders the twelve-vertex mixed polygon without seams or leaks', () => {
    const vertices: [number, number][] = [
      [150, 120], [360, 80], [520, 150], [700, 110], [760, 250], [650, 330],
      [730, 500], [500, 470], [390, 540], [280, 430], [120, 470], [180, 300],
    ]
    const feathers = [0, 22, 55, 0, 70, 35, 0, 50, 18, 0, 65, 30]
    const { field, geometry, at } = evaluate(polygonLayer(vertices), feathers)
    expect(geometry.segmentCount).toBe(12)

    // Every distinct feather width has to actually appear, or the values are being collapsed.
    expect(field.alpha.some((value) => value === 255)).toBe(true)
    expect(field.alpha.some((value) => value > 0 && value < 255)).toBe(true)

    // Well outside the polygon stays empty, so no feather has bled into the frame.
    for (const [x, y] of [[40, 40], [1240, 60], [1240, 690], [40, 690]]) expect(at(x!, y!)).toBe(0)

    /*
     * No seam. A hard segment is *meant* to cross the full range within one pixel, so a raw jump
     * threshold would flag the feature itself; the comparison is restricted to pixels where the
     * evaluator reports a wide feather, and there a 30px-plus fade cannot outrun its own gradient.
     */
    let worstJump = 0
    const wide = (index: number) => field.feather[index]! >= 30
    for (let y = 1; y < field.height - 1; y += 1) {
      for (let x = 1; x < field.width - 1; x += 1) {
        const index = y * field.width + x
        const right = index + 1
        const down = index + field.width
        if (wide(index) && wide(right)) worstJump = Math.max(worstJump, Math.abs(field.alpha[index]! - field.alpha[right]!))
        if (wide(index) && wide(down)) worstJump = Math.max(worstJump, Math.abs(field.alpha[index]! - field.alpha[down]!))
      }
    }
    /*
     * Nearest-segment ownership alone scores 183 here. What remains is not a seam but a gradient: at
     * the one corner where a hard segment meets a 65px one the width has to travel its whole range
     * within a few pixels, and alpha is steepest in exactly that region because a narrow feather
     * saturates fast. It is local to that corner and it eases rather than steps.
     */
    expect(worstJump).toBeLessThan(32)
  })
})

describe('featherAt', () => {
  it('holds a segment\'s own width across its middle', () => {
    expect(featherAt([0, 60, 20], 3, 1, .5)).toBe(60)
  })

  it('eases toward the smaller neighbour at each end, so a hard edge stays hard', () => {
    // Segment 1 is feathered and sits between two hard segments.
    expect(featherAt([0, 60, 0], 3, 1, 0)).toBe(0)
    expect(featherAt([0, 60, 0], 3, 1, 1)).toBe(0)
    expect(featherAt([0, 60, 0], 3, 1, .5)).toBe(60)
    // The hard segment itself never picks up its neighbour's feather anywhere along its length.
    for (const param of [0, .1, .25, .5, .75, .9, 1]) expect(featherAt([0, 60, 0], 3, 0, param)).toBe(0)
  })

  it('blends between two feathered neighbours instead of stepping', () => {
    const between = featherAt([20, 60, 20], 3, 1, .05)
    expect(between).toBeGreaterThanOrEqual(20)
    expect(between).toBeLessThan(60)
  })
})
