import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { HybridWebGLRenderBackend } from '@/engine/rendering/HybridWebGLRenderBackend'
import type { RenderFrameRequest } from '@/engine/rendering/contracts'
import { gifExportSize, gifFrameCount } from '@/engine/rendering/gifPlan'

export { estimateGifBytes, gifExportSize, gifFrameCount, MAX_GIF_FRAMES } from '@/engine/rendering/gifPlan'

/** Everything the composition renderer needs except the per-frame timing the exporter drives itself. */
export type GifExportComposition = Omit<RenderFrameRequest, 'time' | 'width' | 'height' | 'quality'>

export interface GifExportOptions {
  composition: GifExportComposition
  /** Longest horizontal edge; the frame keeps the project's aspect ratio. */
  maxWidth: number
  frameRate: number
  /** Palette size per frame, 2–256. */
  colors: number
  loop: boolean
  onProgress?: (frame: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Renders the composition frame by frame on its own detached canvas and encodes an animated GIF.
 *
 * The exporter owns a second renderer rather than borrowing the viewport's: the preview draws at a
 * fitted preview size and would have to be resized, stalled and restored around every frame. A
 * throwaway backend also guarantees the export is unaffected by whatever the user does meanwhile.
 */
export async function exportProjectGif(options: GifExportOptions): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('GIF export needs a browser document.')
  const { project } = options.composition
  const size = gifExportSize(project, options.maxWidth)
  const total = gifFrameCount(project.duration, options.frameRate)
  const colors = Math.max(2, Math.min(256, Math.round(options.colors)))
  const delay = 1000 / Math.max(1, options.frameRate)

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const backend = new HybridWebGLRenderBackend(canvas, '/demo/aurora-ridge.png')
  const encoder = GIFEncoder()

  try {
    await backend.initialize({ ...size, pixelRatio: 1 })
    for (let frame = 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('GIF export cancelled', 'AbortError')
      await backend.renderFrame({
        ...options.composition,
        time: frame / Math.max(1, options.frameRate),
        width: size.width,
        height: size.height,
        quality: 'full',
      })
      const pixels = backend.readPixels()
      if (!pixels) throw new Error('The renderer produced no pixels; the WebGL context may have been lost.')
      const palette = quantize(pixels.data, colors, { format: 'rgb565' })
      const indexed = applyPalette(pixels.data, palette, 'rgb565')
      // A per-frame palette costs a local colour table but survives scenes whose colours drift.
      encoder.writeFrame(indexed, pixels.width, pixels.height, { palette, delay, repeat: options.loop ? 0 : -1 })
      options.onProgress?.(frame + 1, total)
      // Yield between frames, so progress paints and a cancel can still be observed.
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    }
  } finally {
    await backend.dispose()
  }

  encoder.finish()
  const bytes = encoder.bytes()
  return new Blob([bytes], { type: 'image/gif' })
}
