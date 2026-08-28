import { describe, expect, it } from 'vitest'
import { estimateGifBytes, gifExportSize, gifFrameCount, MAX_GIF_FRAMES } from '@/engine/rendering/gifPlan'

describe('gif export plan', () => {
  it('counts one frame per step of the chosen rate and never fewer than one', () => {
    expect(gifFrameCount(4, 12)).toBe(48)
    expect(gifFrameCount(0, 12)).toBe(1)
    expect(gifFrameCount(-3, 12)).toBe(1)
  })

  it('caps long compositions rather than encoding until the tab dies', () => {
    expect(gifFrameCount(600, 30)).toBe(MAX_GIF_FRAMES)
  })

  it('scales the frame to the requested width and keeps the aspect ratio', () => {
    expect(gifExportSize({ width: 1920, height: 1080 }, 640)).toEqual({ width: 640, height: 360 })
    // A width beyond the project only ever renders at native size.
    expect(gifExportSize({ width: 800, height: 600 }, 4000)).toEqual({ width: 800, height: 600 })
  })

  it('estimates a size that grows with frames and pixels', () => {
    expect(estimateGifBytes(320, 180, 20)).toBeGreaterThan(estimateGifBytes(320, 180, 10))
    expect(estimateGifBytes(640, 360, 10)).toBeGreaterThan(estimateGifBytes(320, 180, 10))
  })
})
