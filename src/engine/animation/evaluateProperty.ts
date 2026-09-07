import type { AnimatableProperty } from '@/models/editor'
import { numericScopes } from './propertyScope'
import { compileExpression } from './expressions'

function cubicBezier(progress: number, x1: number, y1: number, x2: number, y2: number) {
  const sample = (t: number, first: number, second: number) => {
    const inverse = 1 - t
    return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t
  }

  let low = 0
  let high = 1
  let parameter = progress
  for (let iteration = 0; iteration < 12; iteration += 1) {
    parameter = (low + high) / 2
    if (sample(parameter, x1, x2) < progress) low = parameter
    else high = parameter
  }
  return sample(parameter, y1, y2)
}

function evaluateKeyframes(channel: AnimatableProperty<number>, time: number): number {
  if (!channel.animated || channel.keyframes.length === 0) return channel.value
  const keys = [...channel.keyframes].sort((left, right) => left.time - right.time)
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (!first || !last) return channel.value
  if (time <= first.time) return first.value
  if (time >= last.time) return last.value

  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index]
    const right = keys[index + 1]
    if (!left || !right || time < left.time || time > right.time) continue
    if (left.interpolation === 'hold') return left.value
    let progress = (time - left.time) / (right.time - left.time)
    if (left.interpolation === 'bezier') {
      const outgoing = left.easing ?? { outX: .33, outY: 0 }
      const incoming = right.easing ?? { inX: .67, inY: 1 }
      progress = cubicBezier(progress, outgoing.outX, outgoing.outY, incoming.inX, incoming.inY)
    }
    return left.value + (right.value - left.value) * progress
  }

  return channel.value
}

/** Deterministic smooth value noise: independent of playback direction and export frame rate. */
function noiseAt(time: number, seed: number) {
  const cell = Math.floor(time)
  const hash = (n: number) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
    return (x - Math.floor(x)) * 2 - 1
  }
  const fraction = time - cell
  const blend = fraction * fraction * (3 - 2 * fraction)
  return hash(cell) * (1 - blend) + hash(cell + 1) * blend
}

export function evaluateNumericProperty(channel: AnimatableProperty<number>, time: number, visited?: Set<string>): number {
  if (!channel.driver?.enabled && !channel.modifiers?.length) return evaluateKeyframes(channel, time)
  const visiting = visited ?? new Set<string>()
  const base = (at: number) => {
    const value = evaluateKeyframes(channel, at)
    if (!channel.driver?.enabled || visiting.has(channel.id)) return value
    visiting.add(channel.id)
    try {
      const scope = numericScopes.get(channel)
      const id = channel.driver.sourceId
      const property = scope?.properties.get(id)
      const source = id.startsWith('audio:') ? scope?.audio?.(id.slice(6), at) ?? 0 : property ? evaluateNumericProperty(property, at, visiting) : 0
      const result = compileExpression(channel.driver.expression)({ time: at, value, source })
      return Number.isFinite(result) ? result : value
    } catch { return value }
    finally { visiting.delete(channel.id) }
  }
  if (!channel.modifiers?.length) return base(time)
  const modifiers = (channel.modifiers ?? []).filter(modifier => modifier.enabled)
  const evaluate = (index: number, at: number): number => {
    if (index < 0) return base(at)
    const modifier = modifiers[index]!
    if (modifier.kind === 'cycle' && channel.animated && channel.keyframes.length > 1) {
      const times = channel.keyframes.map(key => key.time)
      const start = Math.min(...times)
      const end = Math.max(...times)
      const span = end - start
      if (span > 0 && (at < start || at > end)) at = start + ((at - start) % span + span) % span
    }
    const value = evaluate(index - 1, at)
    if (modifier.kind === 'offset') return value + modifier.amount
    if (modifier.kind === 'noise') return value + noiseAt(at * modifier.frequency, modifier.seed) * modifier.amount
    if (modifier.kind === 'limit') return Math.max(Math.min(modifier.min, modifier.max), Math.min(Math.max(modifier.min, modifier.max), value))
    return value
  }
  const value = evaluate(modifiers.length - 1, time)
  return Number.isFinite(value) ? value : channel.value
}
