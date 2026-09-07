import { describe, expect, it } from 'vitest'
import { enableTimeRemap, layerSampleTime, sourceTime } from '../timeRemap'
import type { EditorLayer } from '@/models/editor'

describe('layer time remapping', () => {
  it('starts as identity and preserves the media trim offset', () => {
    const layer = { id: 'clip', start: 3, duration: 10, sourceOffset: 2 } as EditorLayer
    enableTimeRemap(layer)
    expect(layerSampleTime(layer, 5)).toBe(5)
    expect(sourceTime(layer, 5)).toBe(4)
  })
  it('supports freeze and reverse without changing the timeline lifetime', () => {
    const layer = { id: 'clip', start: 3, duration: 10 } as EditorLayer
    enableTimeRemap(layer)
    layer.timeRemap!.keyframes[0]!.value = 10
    layer.timeRemap!.keyframes[1]!.value = 0
    expect(sourceTime(layer, 5)).toBe(8)
    layer.timeRemap!.keyframes[1]!.value = 10
    expect(sourceTime(layer, 12)).toBe(10)
    expect(layer.duration).toBe(10)
  })
})
