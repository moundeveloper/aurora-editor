import { describe, expect, it } from 'vitest'
import {
  applyGestureKey, beginGesture, gestureDelta, gestureIsNumeric, gestureLabel,
  type GestureBasis, type GestureState,
} from '@/engine/scene3d/transformGesture'

/** A camera looking down -Z: screen right is world +X, screen up is world +Y. */
const BASIS: GestureBasis = { right: [1, 0, 0], up: [0, 1, 0], unitsPerPixel: .01 }

function withKeys(state: GestureState, ...keys: Array<string | [string, boolean]>) {
  return keys.reduce<GestureState>((current, key) => {
    const [name, shift] = Array.isArray(key) ? key : [key, false]
    return applyGestureKey(current, name, shift).state
  }, state)
}

describe('gesture keys', () => {
  it('constrains to an axis and clears on the same key again', () => {
    const free = beginGesture('translate')
    const constrained = applyGestureKey(free, 'x')

    expect(constrained.handled).toBe(true)
    expect(constrained.state.constraint).toEqual({ kind: 'axis', axis: 'x' })
    // A mistyped constraint has to be undoable without leaving the gesture.
    expect(applyGestureKey(constrained.state, 'x').state.constraint).toEqual({ kind: 'free' })
    expect(applyGestureKey(constrained.state, 'y').state.constraint).toEqual({ kind: 'axis', axis: 'y' })
  })

  it('pins the other two axes when shift is held', () => {
    const plane = applyGestureKey(beginGesture('translate'), 'z', true)

    expect(plane.state.constraint).toEqual({ kind: 'plane', normal: 'z' })
    expect(applyGestureKey(plane.state, 'z', true).state.constraint).toEqual({ kind: 'free' })
  })

  it('builds a numeric entry from digits, a sign, and one decimal point', () => {
    const typed = withKeys(beginGesture('translate'), '2', '.', '5')
    expect(typed.numeric).toBe('2.5')
    expect(gestureIsNumeric(typed)).toBe(true)

    // A second decimal point is not a number, so it is refused rather than appended.
    expect(withKeys(typed, '.').numeric).toBe('2.5')
    expect(applyGestureKey(typed, '.').handled).toBe(false)

    const negative = applyGestureKey(typed, '-').state
    expect(negative.numeric).toBe('-2.5')
    expect(applyGestureKey(negative, '-').state.numeric).toBe('2.5')
    expect(withKeys(negative, 'backspace').numeric).toBe('-2.')
  })

  it('does not treat a half-typed number as a value', () => {
    expect(gestureIsNumeric(withKeys(beginGesture('translate'), '-'))).toBe(false)
    expect(gestureIsNumeric(withKeys(beginGesture('translate'), '.'))).toBe(false)
    expect(gestureIsNumeric(beginGesture('translate'))).toBe(false)
  })

  it('reports confirm and cancel, and ignores keys it has no meaning for', () => {
    expect(applyGestureKey(beginGesture('translate'), 'Enter').outcome).toBe('confirm')
    expect(applyGestureKey(beginGesture('translate'), 'Escape').outcome).toBe('cancel')
    const other = applyGestureKey(beginGesture('translate'), 'q')
    expect(other.handled).toBe(false)
    expect(other.outcome).toBeUndefined()
  })
})

describe('translate gesture', () => {
  it('follows the pointer through the camera basis, so right is right', () => {
    const state = { ...beginGesture('translate'), screen: { x: 100, y: -50 } }
    const delta = gestureDelta(state, BASIS)

    expect(delta.translate[0]).toBeCloseTo(1)
    // Screen Y grows downward, so a negative screen delta lifts the object.
    expect(delta.translate[1]).toBeCloseTo(.5)
    expect(delta.translate[2]).toBeCloseTo(0)
  })

  it('drops the axes a constraint excludes', () => {
    const state = { ...beginGesture('translate'), screen: { x: 100, y: -50 }, constraint: { kind: 'axis', axis: 'x' } as const }
    expect(gestureDelta(state, BASIS).translate).toEqual([1, 0, 0])

    const plane = { ...state, constraint: { kind: 'plane', normal: 'x' } as const }
    const delta = gestureDelta(plane, BASIS)
    expect(delta.translate[0]).toBe(0)
    expect(delta.translate[1]).toBeCloseTo(.5)
  })

  it('uses a typed distance exactly, ignoring how far the pointer travelled', () => {
    const state = {
      ...beginGesture('translate'),
      screen: { x: 999, y: 999 },
      constraint: { kind: 'axis', axis: 'z' } as const,
      numeric: '-3.5',
    }
    expect(gestureDelta(state, BASIS).translate).toEqual([0, 0, -3.5])
  })

  it('holds still for a typed distance with no direction to apply it in', () => {
    const state = { ...beginGesture('translate'), screen: { x: 999, y: 0 }, numeric: '4' }
    // A distance without an axis is ambiguous; moving by a guess would be worse than not moving.
    expect(gestureDelta(state, BASIS).translate).toEqual([0, 0, 0])
  })

  it('quantises to a quarter unit while snapping', () => {
    const state = { ...beginGesture('translate', true), screen: { x: 63, y: 0 }, constraint: { kind: 'axis', axis: 'x' } as const }
    // 63px at .01 units per pixel is .63, which lands on .75 rather than anywhere between.
    expect(gestureDelta(state, BASIS).translate[0]).toBeCloseTo(.75)
  })

  it('respects a rotated camera basis instead of assuming world axes', () => {
    const sideOn: GestureBasis = { right: [0, 0, -1], up: [0, 1, 0], unitsPerPixel: .01 }
    const state = { ...beginGesture('translate'), screen: { x: 100, y: 0 } }

    const delta = gestureDelta(state, sideOn)
    expect(delta.translate[0]).toBeCloseTo(0)
    expect(delta.translate[2]).toBeCloseTo(-1)
  })
})

describe('rotate gesture', () => {
  it('turns about world up until an axis is chosen', () => {
    const state = { ...beginGesture('rotate'), screen: { x: 90, y: 0 } }
    expect(gestureDelta(state, BASIS).rotate).toEqual([0, 45, 0])
  })

  it('turns about the chosen axis, and takes a typed angle exactly', () => {
    const state = { ...beginGesture('rotate'), screen: { x: 90, y: 0 }, constraint: { kind: 'axis', axis: 'x' } as const }
    expect(gestureDelta(state, BASIS).rotate).toEqual([45, 0, 0])

    const typed = { ...state, numeric: '-90' }
    expect(gestureDelta(typed, BASIS).rotate).toEqual([-90, 0, 0])
  })

  it('snaps to fifteen degrees', () => {
    const state = { ...beginGesture('rotate', true), screen: { x: 40, y: 0 } }
    // 40px at half a degree each is 20°, which lands on 15°.
    expect(gestureDelta(state, BASIS).rotate[1]).toBe(15)
  })
})

describe('scale gesture', () => {
  it('scales uniformly from horizontal travel', () => {
    const state = { ...beginGesture('scale'), screen: { x: 50, y: 0 } }
    expect(gestureDelta(state, BASIS).scale).toEqual([1.5, 1.5, 1.5])
  })

  it('leaves excluded axes at one, so a constraint cannot squash them', () => {
    const state = { ...beginGesture('scale'), screen: { x: 50, y: 0 }, constraint: { kind: 'axis', axis: 'y' } as const }
    expect(gestureDelta(state, BASIS).scale).toEqual([1, 1.5, 1])
  })

  it('takes a typed factor, uniformly, with no axis needed', () => {
    const state = { ...beginGesture('scale'), screen: { x: 999, y: 0 }, numeric: '2' }
    expect(gestureDelta(state, BASIS).scale).toEqual([2, 2, 2])
  })

  it('refuses to collapse geometry to nothing', () => {
    const typed = { ...beginGesture('scale'), screen: { x: 0, y: 0 }, numeric: '0' }
    expect(gestureDelta(typed, BASIS).scale[0]).toBe(.001)

    // A hard drag left would otherwise pass through zero and invert the object.
    const dragged = { ...beginGesture('scale'), screen: { x: -100, y: 0 } }
    expect(gestureDelta(dragged, BASIS).scale[0]).toBe(.001)
  })
})

describe('gesture label', () => {
  it('names the mode, the constraint, and the pending value', () => {
    const move = { ...beginGesture('translate'), screen: { x: 100, y: 0 }, constraint: { kind: 'axis', axis: 'x' } as const }
    expect(gestureLabel(move, BASIS)).toContain('Move X')
    expect(gestureLabel(move, BASIS)).toContain('1.00')

    const plane = { ...beginGesture('translate'), constraint: { kind: 'plane', normal: 'y' } as const }
    expect(gestureLabel(plane, BASIS)).toContain('Move XZ')

    const rotate = { ...beginGesture('rotate'), screen: { x: 90, y: 0 } }
    expect(gestureLabel(rotate, BASIS)).toContain('45.0°')

    const typed = { ...beginGesture('scale'), numeric: '2.5', snap: true }
    expect(gestureLabel(typed, BASIS)).toContain('typed 2.5')
    expect(gestureLabel(typed, BASIS)).toContain('snap')
  })

  it('says the gesture is following the view when nothing is constrained', () => {
    expect(gestureLabel(beginGesture('translate'), BASIS)).toContain('view')
  })
})
