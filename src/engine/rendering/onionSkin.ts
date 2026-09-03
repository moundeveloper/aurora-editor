import type { RenderFrameRequest } from '@/engine/rendering/contracts'

export type OnionSkinDirection = 'previous' | 'next'

export interface OnionSkinSettings {
  enabled: boolean
  previousFrames: number
  nextFrames: number
  /** Per-frame alpha, expressed from zero through one. */
  opacity: number
}

export interface OnionSkinSample {
  direction: OnionSkinDirection
  distance: number
  frame: number
  time: number
  opacity: number
}

export const MAX_ONION_SKIN_FRAMES = 4
export const DEFAULT_ONION_SKIN_SETTINGS: OnionSkinSettings = Object.freeze({
  enabled: false,
  previousFrames: 1,
  nextFrames: 1,
  opacity: .24,
})

const clampInteger = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, Math.round(Number.isFinite(value) ? value : minimum)))

/** Sanitises toolbar input before it reaches either renderer. */
export function normaliseOnionSkinSettings(settings: OnionSkinSettings): OnionSkinSettings {
  return {
    enabled: settings.enabled === true,
    previousFrames: clampInteger(settings.previousFrames, 0, MAX_ONION_SKIN_FRAMES),
    nextFrames: clampInteger(settings.nextFrames, 0, MAX_ONION_SKIN_FRAMES),
    opacity: Math.min(1, Math.max(.01, Number.isFinite(settings.opacity) ? settings.opacity : DEFAULT_ONION_SKIN_SETTINGS.opacity)),
  }
}

/**
 * Produces frame-aligned neighbours without ever changing the editor playhead. Distant ghosts fade
 * slightly so the nearest pose reads first, while range clipping prevents samples outside a project.
 */
export function onionSkinSamples(
  currentTime: number,
  frameRate: number,
  duration: number,
  settings: OnionSkinSettings,
): OnionSkinSample[] {
  const safe = normaliseOnionSkinSettings(settings)
  if (!safe.enabled || safe.previousFrames + safe.nextFrames === 0) return []
  const fps = Math.max(1, Number.isFinite(frameRate) ? frameRate : 1)
  const currentFrame = Math.max(0, Math.round((Number.isFinite(currentTime) ? currentTime : 0) * fps))
  const finalFrame = Math.max(0, Math.ceil(Math.max(0, Number.isFinite(duration) ? duration : 0) * fps) - 1)
  const samples: OnionSkinSample[] = []

  const append = (direction: OnionSkinDirection, count: number) => {
    // Farthest first lets the nearest, strongest silhouette remain legible where poses overlap.
    for (let distance = count; distance >= 1; distance -= 1) {
      const frame = currentFrame + (direction === 'previous' ? -distance : distance)
      if (frame < 0 || frame > finalFrame) continue
      const falloff = 1 - ((distance - 1) / Math.max(1, count)) * .35
      samples.push({ direction, distance, frame, time: frame / fps, opacity: safe.opacity * falloff })
    }
  }

  append('previous', safe.previousFrames)
  append('next', safe.nextFrames)
  return samples
}

/** Marks an auxiliary frame as transparent and explicitly ineligible for persistent cache writes. */
export function asOnionSkinRenderRequest<T extends RenderFrameRequest>(request: T): T & {
  cacheWrite: false
  transparentBackground: true
} {
  return { ...request, cacheWrite: false, transparentBackground: true }
}
