import type { AnimatableProperty } from '@/models/editor'

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

export function evaluateNumericProperty(channel: AnimatableProperty<number>, time: number): number {
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
