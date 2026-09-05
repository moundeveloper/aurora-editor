import { describe, expect, it } from 'vitest'
import { videoBitrate, videoExportSize, videoFrameCount } from '@/engine/rendering/videoExport'
import type { EditorProject } from '@/models/editor'

function project(width: number, height: number): EditorProject {
  return {
    id: 'p', name: 'Export Test', width, height, frameRate: 30, duration: 12,
    backgroundColor: '#000000', updatedAt: 0, version: 12,
  }
}

describe('video export sizing', () => {
  it('keeps both edges even, because encoders reject odd chroma dimensions', () => {
    // 1920x1080 scaled to 999 wide would land on 999x561, both odd.
    const size = videoExportSize(project(1920, 1080), 999)

    expect(size.width % 2).toBe(0)
    expect(size.height % 2).toBe(0)
    expect(size.width).toBe(998)
  })

  it('never scales a project up past its own resolution', () => {
    expect(videoExportSize(project(1280, 720), 4000)).toEqual({ width: 1280, height: 720 })
  })

  it('holds the aspect ratio within half a pixel while scaling down', () => {
    const source = project(1920, 1080)
    const size = videoExportSize(source, 640)

    expect(size).toEqual({ width: 640, height: 360 })
    expect(Math.abs(size.width / size.height - source.width / source.height)).toBeLessThan(.01)
  })

  it('keeps a vertical project vertical', () => {
    expect(videoExportSize(project(1080, 1920), 540)).toEqual({ width: 540, height: 960 })
  })

  it('refuses a degenerate frame instead of asking the encoder for one', () => {
    const size = videoExportSize(project(1920, 1080), 1)
    expect(size.width).toBeGreaterThanOrEqual(16)
    expect(size.height).toBeGreaterThanOrEqual(16)
  })
})

describe('video export frame counts', () => {
  it('covers the requested range at the requested rate', () => {
    expect(videoFrameCount(12, 30)).toBe(360)
    expect(videoFrameCount(2.5, 24)).toBe(60)
  })

  it('still writes a frame for a range too short to hold one', () => {
    expect(videoFrameCount(0, 30)).toBe(1)
    expect(videoFrameCount(.001, 30)).toBe(1)
  })
})

describe('video export bitrate', () => {
  it('scales with pixels and frame rate, which is what actually costs bits', () => {
    const half = videoBitrate(960, 540, 30, 'web')
    const full = videoBitrate(1920, 1080, 30, 'web')
    const doubled = videoBitrate(1920, 1080, 60, 'web')

    expect(full / half).toBeCloseTo(4, 1)
    expect(doubled / full).toBeCloseTo(2, 1)
  })

  it('lands a 1080p30 web export in a sane range for the codec', () => {
    const bits = videoBitrate(1920, 1080, 30, 'web')
    expect(bits).toBeGreaterThan(6_000_000)
    expect(bits).toBeLessThan(10_000_000)
  })

  it('orders the quality tiers and clamps both ends', () => {
    expect(videoBitrate(1920, 1080, 30, 'web')).toBeLessThan(videoBitrate(1920, 1080, 30, 'high'))
    expect(videoBitrate(1920, 1080, 30, 'high')).toBeLessThan(videoBitrate(1920, 1080, 30, 'master'))
    // A postage stamp still gets a floor, and 8K60 master does not ask for a gigabit.
    expect(videoBitrate(16, 16, 1, 'web')).toBe(500_000)
    expect(videoBitrate(7680, 4320, 60, 'master')).toBe(80_000_000)
  })
})
