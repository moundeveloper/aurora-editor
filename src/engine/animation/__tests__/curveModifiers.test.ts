import { describe, expect, it } from 'vitest'
import { evaluateNumericProperty } from '../evaluateProperty'
import type { AnimatableProperty, CurveModifier } from '@/models/editor'

const modifier = (kind: CurveModifier['kind'], patch: Partial<CurveModifier> = {}): CurveModifier => ({ id: kind, kind, enabled: true, amount: 10, frequency: 1, seed: 0, min: 0, max: 12, ...patch })
const channel = (): AnimatableProperty<number> => ({ id: 'x', value: 5, animated: true, keyframes: [
  { id: 'a', time: 1, value: 0, interpolation: 'linear' }, { id: 'b', time: 3, value: 20, interpolation: 'linear' },
] })

describe('curve modifiers', () => {
  it('cycles before and after keys while preserving the authored endpoints', () => {
    const property = { ...channel(), modifiers: [modifier('cycle')] }
    expect(evaluateNumericProperty(property, 3)).toBe(20)
    expect(evaluateNumericProperty(property, 4)).toBe(10)
    expect(evaluateNumericProperty(property, 0)).toBe(10)
  })
  it('applies ordered offsets and limits and supports bypass', () => {
    const property = { ...channel(), modifiers: [modifier('offset'), modifier('limit')] }
    expect(evaluateNumericProperty(property, 2)).toBe(12)
    property.modifiers.reverse()
    expect(evaluateNumericProperty(property, 2)).toBe(20)
    property.modifiers[1]!.enabled = false
    expect(evaluateNumericProperty(property, 2)).toBe(10)
  })
  it('keeps seeded noise deterministic and bounded without requiring keyframes', () => {
    const property = { ...channel(), animated: false, modifiers: [modifier('noise')] }
    const samples = [1.1, 2.2, 3.3].map(time => evaluateNumericProperty(property, time))
    expect([3.3, 2.2, 1.1].map(time => evaluateNumericProperty(property, time)).reverse()).toEqual(samples)
    expect(samples.every(value => value >= -5 && value <= 15)).toBe(true)
    property.modifiers[0]!.seed = 27
    expect(evaluateNumericProperty(property, 1.1)).not.toBe(samples[0])
  })
})
