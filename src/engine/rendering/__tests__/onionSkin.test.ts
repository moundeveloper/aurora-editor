import { describe, expect, it } from 'vitest'
import { asOnionSkinRenderRequest, MAX_ONION_SKIN_FRAMES, normaliseOnionSkinSettings, onionSkinSamples } from '@/engine/rendering/onionSkin'
import type { RenderFrameRequest } from '@/engine/rendering/contracts'

describe('onion skin sampling', () => {
  it('samples frame-aligned neighbours without including the playhead frame', () => {
    const samples = onionSkinSamples(1, 24, 3, { enabled: true, previousFrames: 2, nextFrames: 2, opacity: .3 })

    expect(samples.map(({ direction, frame }) => `${direction}:${frame}`)).toEqual([
      'previous:22', 'previous:23', 'next:26', 'next:25',
    ])
    expect(samples.every((sample) => sample.frame !== 24 && sample.time === sample.frame / 24)).toBe(true)
    expect(samples[1]!.opacity).toBeGreaterThan(samples[0]!.opacity)
  })

  it('clips samples to the project range', () => {
    expect(onionSkinSamples(0, 10, 1, { enabled: true, previousFrames: 3, nextFrames: 1, opacity: .2 })
      .map((sample) => sample.frame)).toEqual([1])
    expect(onionSkinSamples(.9, 10, 1, { enabled: true, previousFrames: 1, nextFrames: 3, opacity: .2 })
      .map((sample) => sample.frame)).toEqual([8])
  })

  it('normalises hostile toolbar values and disables empty requests', () => {
    expect(normaliseOnionSkinSettings({ enabled: true, previousFrames: 99, nextFrames: -2, opacity: 7 }))
      .toEqual({ enabled: true, previousFrames: MAX_ONION_SKIN_FRAMES, nextFrames: 0, opacity: 1 })
    expect(onionSkinSamples(1, 24, 3, { enabled: false, previousFrames: 2, nextFrames: 2, opacity: .3 })).toEqual([])
  })

  it('makes auxiliary render requests transparent and cache-write ineligible', () => {
    const request = { cacheWrite: true, transparentBackground: false } as RenderFrameRequest

    const transient = asOnionSkinRenderRequest(request)

    expect(transient).toMatchObject({ cacheWrite: false, transparentBackground: true })
    expect(request).toMatchObject({ cacheWrite: true, transparentBackground: false })
  })
})
