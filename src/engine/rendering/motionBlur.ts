import type { RenderQuality } from '@/engine/rendering/contracts'
import type { Scene3DSettings } from '@/models/editor'

export const MIN_MOTION_BLUR_SAMPLES = 2
export const MAX_MOTION_BLUR_SAMPLES = 16
export const PREVIEW_MOTION_BLUR_SAMPLE_CAP = 8

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

/**
 * Places samples at the centre of equal exposure slices, matching an open camera shutter without
 * sampling either endpoint twice on adjacent frames. Clamping deliberately keeps duplicate edge
 * samples: before frame zero, the scene is held on its first authored state for that exposure time.
 */
export function motionBlurSampleTimes(
  time: number,
  frameRate: number,
  shutterAngle: number,
  sampleCount: number,
  minimumTime = 0,
  maximumTime = Number.POSITIVE_INFINITY,
) {
  const safeTime = Number.isFinite(time) ? time : minimumTime
  const boundedTime = clamp(safeTime, minimumTime, maximumTime)
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30
  const shutter = clamp(Number.isFinite(shutterAngle) ? shutterAngle : 0, 0, 360)
  const samples = Math.round(clamp(
    Number.isFinite(sampleCount) ? sampleCount : MIN_MOTION_BLUR_SAMPLES,
    MIN_MOTION_BLUR_SAMPLES,
    MAX_MOTION_BLUR_SAMPLES,
  ))
  if (shutter === 0) return [boundedTime]

  const exposure = shutter / 360 / safeFrameRate
  const start = safeTime - exposure / 2
  return Array.from({ length: samples }, (_, index) => (
    clamp(start + exposure * ((index + .5) / samples), minimumTime, maximumTime)
  ))
}

export function effectiveMotionBlurSamples(settings: Scene3DSettings, quality: RenderQuality) {
  if (!settings.motionBlur || quality === 'draft' || settings.motionBlurShutter <= 0) return 1
  const authored = Math.round(clamp(settings.motionBlurSamples, MIN_MOTION_BLUR_SAMPLES, MAX_MOTION_BLUR_SAMPLES))
  return quality === 'preview' ? Math.min(authored, PREVIEW_MOTION_BLUR_SAMPLE_CAP) : authored
}
