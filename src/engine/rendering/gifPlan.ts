import type { EditorProject } from '@/models/editor'

/**
 * A GIF stores every frame as its own palette image, so a full-length composition at project frame
 * rate reaches hundreds of megabytes before the encoder ever sees it. This is the ceiling the export
 * panel quotes and the exporter enforces.
 */
export const MAX_GIF_FRAMES = 600

export function gifFrameCount(duration: number, frameRate: number) {
  const rate = Math.max(1, frameRate)
  return Math.max(1, Math.min(MAX_GIF_FRAMES, Math.round(Math.max(0, duration) * rate)))
}

/** Scales the frame down to the requested width; the project's aspect ratio is never altered. */
export function gifExportSize(project: Pick<EditorProject, 'width' | 'height'>, maxWidth: number) {
  const scale = Math.min(1, Math.max(16, maxWidth) / Math.max(1, project.width))
  return {
    width: Math.max(1, Math.round(project.width * scale)),
    height: Math.max(1, Math.round(project.height * scale)),
  }
}

/** Rough guide for the panel: palette indices plus LZW usually land near a third of the raw frame. */
export function estimateGifBytes(width: number, height: number, frames: number) {
  return Math.round(width * height * frames * .35)
}
