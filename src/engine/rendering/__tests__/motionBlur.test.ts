import { describe, expect, it } from 'vitest'
import { effectiveMotionBlurSamples, motionBlurSampleTimes } from '@/engine/rendering/motionBlur'
import type { Scene3DSettings } from '@/models/editor'

const settings: Scene3DSettings = {
  shadows: true, shadowMapSize: 1024, ambientOcclusion: true,
  ambientOcclusionIntensity: 1, ambientOcclusionRadius: .35,
  motionBlur: true, motionBlurShutter: 180, motionBlurSamples: 16,
  quality: 'preview', backgroundColor: null,
}

describe('motion blur sampling', () => {
  it('centres deterministic subframes across the shutter interval', () => {
    const samples = motionBlurSampleTimes(2, 25, 180, 4)
    expect(samples).toEqual([1.9925, 1.9975, 2.0025, 2.0075])
    expect(samples.reduce((sum, sample) => sum + sample, 0) / samples.length).toBeCloseTo(2)
  })

  it('holds the first authored state for exposure before frame zero', () => {
    const samples = motionBlurSampleTimes(0, 25, 360, 4)
    expect(samples.slice(0, 2)).toEqual([0, 0])
    expect(samples[2]).toBeCloseTo(.005)
    expect(samples[3]).toBeCloseTo(.015)
  })

  it('uses one exact sample for a closed shutter', () => {
    expect(motionBlurSampleTimes(3, 24, 0, 16)).toEqual([3])
  })

  it('caps preview work and disables sampling in draft quality', () => {
    expect(effectiveMotionBlurSamples(settings, 'preview')).toBe(8)
    expect(effectiveMotionBlurSamples(settings, 'full')).toBe(16)
    expect(effectiveMotionBlurSamples(settings, 'draft')).toBe(1)
  })
})
