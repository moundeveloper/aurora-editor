import { describe, expect, it } from 'vitest'
import { compileExpression } from '../expressions'
import { evaluateNumericProperty } from '../evaluateProperty'
import { bindNumericScope } from '../propertyScope'
import type { AnimatableProperty } from '@/models/editor'
const property = (id: string, value: number): AnimatableProperty<number> => ({ id, value, animated: false, keyframes: [] })

describe('property drivers', () => {
  it('evaluates math precedence, time and whitelisted functions without JavaScript access', () => {
    expect(compileExpression('2 + 3 * 4')({})).toBe(14)
    expect(compileExpression('clamp(sin(time*pi), 0, 1)')({ time: .5 })).toBeCloseTo(1)
    expect(() => compileExpression('window.alert(1)')).toThrow()
    expect(() => compileExpression('value.constructor')).toThrow()
  })
  it('links properties in a snapshot scope and falls back safely on malformed expressions', () => {
    const source = property('source', 7), target = property('target', 3)
    target.driver = { enabled: true, sourceId: 'source', expression: 'source * 2 + value' }
    bindNumericScope([source, target])
    expect(evaluateNumericProperty(target, 0)).toBe(17)
    source.value = 9
    expect(evaluateNumericProperty(target, 0)).toBe(21)
    target.driver.expression = '1 / 0'
    expect(evaluateNumericProperty(target, 0)).toBe(3)
  })
  it('bounds circular links and samples audio sources at evaluation time', () => {
    const a = property('a', 1), b = property('b', 2)
    a.driver = { enabled: true, sourceId: 'b', expression: 'source' }
    b.driver = { enabled: true, sourceId: 'a', expression: 'source' }
    bindNumericScope([a, b], (_id, time) => time * .1)
    expect(Number.isFinite(evaluateNumericProperty(a, 1))).toBe(true)
    a.driver.sourceId = 'audio:music'; a.driver.expression = 'source * 100'
    expect(evaluateNumericProperty(a, 2)).toBe(20)
  })
})
