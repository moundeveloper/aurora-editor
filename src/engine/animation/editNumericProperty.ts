import type { AnimatableProperty, Keyframe } from '@/models/editor'
import { evaluateNumericProperty } from './evaluateProperty'

const toleranceAtFrameRate = (frameRate: number) => (0.5 / frameRate) + 0.0001

export interface NumericPropertyEditResult {
  changed: boolean
  keyframeId: string | null
}

export function setNumericPropertyAtTime(
  property: AnimatableProperty<number>,
  value: number,
  time: number,
  frameRate: number,
  options: { autoKey: boolean; selectedKeyframeId?: string | null },
): NumericPropertyEditResult {
  const evaluatedValue = evaluateNumericProperty(property, time)
  if (Math.abs(evaluatedValue - value) <= 0.000001) return { changed: false, keyframeId: null }
  property.value = value
  const tolerance = toleranceAtFrameRate(frameRate)
  const selected = property.keyframes.find((keyframe) => keyframe.id === options.selectedKeyframeId)
  const atPlayhead = property.keyframes.find((keyframe) => Math.abs(keyframe.time - time) <= tolerance)
  const target = selected ?? atPlayhead
  if (target) {
    target.value = value
    return { changed: true, keyframeId: target.id }
  }
  if (options.autoKey || property.animated) {
    const keyframe: Keyframe<number> = { id: crypto.randomUUID(), time, value, interpolation: 'bezier' }
    property.animated = true
    property.keyframes.push(keyframe)
    property.keyframes.sort((left, right) => left.time - right.time)
    return { changed: true, keyframeId: keyframe.id }
  }
  return { changed: true, keyframeId: null }
}

export function toggleNumericKeyframe(property: AnimatableProperty<number>, time: number, frameRate: number): string | null {
  const tolerance = toleranceAtFrameRate(frameRate)
  const existing = property.keyframes.find((keyframe) => Math.abs(keyframe.time - time) <= tolerance)
  if (existing) {
    property.keyframes = property.keyframes.filter((keyframe) => keyframe.id !== existing.id)
    property.animated = property.keyframes.length > 0
    return null
  }
  const keyframe: Keyframe<number> = {
    id: crypto.randomUUID(),
    time,
    value: evaluateNumericProperty(property, time),
    interpolation: 'bezier',
  }
  property.animated = true
  property.keyframes.push(keyframe)
  property.keyframes.sort((left, right) => left.time - right.time)
  return keyframe.id
}

export function ensureNumericKeyframe(property: AnimatableProperty<number>, time: number, frameRate: number): string {
  const tolerance = toleranceAtFrameRate(frameRate)
  const existing = property.keyframes.find((keyframe) => Math.abs(keyframe.time - time) <= tolerance)
  if (existing) return existing.id
  return toggleNumericKeyframe(property, time, frameRate)!
}
