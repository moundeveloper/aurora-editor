import { HybridWebGLRenderBackend } from '@/engine/rendering/HybridWebGLRenderBackend'
import { matroskaCodecId, writeWebM, type WebMFrame } from '@/engine/rendering/webmWriter'
import type { RenderFrameRequest } from '@/engine/rendering/contracts'
import type { EditorProject } from '@/models/editor'

/** Everything the composition renderer needs except the per-frame timing the exporter drives itself. */
export type VideoExportComposition = Omit<RenderFrameRequest, 'time' | 'width' | 'height' | 'quality'>

export type VideoQuality = 'web' | 'high' | 'master'

export interface VideoExportOptions {
  composition: VideoExportComposition
  /** Longest horizontal edge; the frame keeps the project's aspect ratio. */
  maxWidth: number
  frameRate: number
  quality: VideoQuality
  codec?: 'vp9' | 'vp8' | 'av1'
  /** Optional project-time range. End is exclusive and both values are clamped to the composition. */
  startTime?: number
  endTime?: number
  onProgress?: (frame: number, total: number) => void
  signal?: AbortSignal
}

const CODEC_STRINGS = {
  vp9: 'vp09.00.10.08',
  vp8: 'vp8',
  av1: 'av01.0.04M.08',
} as const

/** Bits per second per megapixel per second, chosen so a 1080p30 web export lands near 8 Mbps. */
const QUALITY_BITRATE = { web: 1.3e5, high: 2.6e5, master: 5.2e5 } as const

/**
 * Encoders reject odd dimensions for chroma-subsampled formats, so both edges are rounded down to an
 * even number. The aspect ratio shifts by at most half a pixel.
 */
export function videoExportSize(project: EditorProject, maxWidth: number) {
  const longest = Math.max(16, Math.min(3840, Math.round(maxWidth)))
  const scale = Math.min(1, longest / project.width)
  const even = (value: number) => Math.max(16, Math.floor(value / 2) * 2)
  return { width: even(project.width * scale), height: even(project.height * scale) }
}

export function videoFrameCount(duration: number, frameRate: number) {
  return Math.max(1, Math.round(duration * Math.max(1, frameRate)))
}

export function videoBitrate(width: number, height: number, frameRate: number, quality: VideoQuality) {
  const megapixelsPerSecond = (width * height * frameRate) / 1_000_000
  return Math.round(Math.max(500_000, Math.min(80_000_000, megapixelsPerSecond * QUALITY_BITRATE[quality])))
}

export function videoExportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

/**
 * Renders the composition frame by frame and encodes a WebM video.
 *
 * Like the GIF exporter, this owns its own renderer rather than borrowing the viewport's, so the
 * export is unaffected by whatever the user does meanwhile. Frame timestamps come from the frame
 * index rather than the clock, which is what keeps the file's duration equal to the range exported
 * however long the rendering itself takes.
 */
export async function exportProjectVideo(options: VideoExportOptions): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Video export needs a browser document.')
  if (!videoExportSupported()) {
    throw new Error('This browser has no WebCodecs video encoder. Chrome, Edge, and Safari 17 or newer can export video.')
  }
  const { project } = options.composition
  const size = videoExportSize(project, options.maxWidth)
  const frameRate = Math.max(1, Math.min(120, Math.round(options.frameRate)))
  const startTime = Math.max(0, Math.min(project.duration, options.startTime ?? 0))
  const endTime = Math.max(startTime, Math.min(project.duration, options.endTime ?? project.duration))
  const total = videoFrameCount(endTime - startTime, frameRate)
  const codec = CODEC_STRINGS[options.codec ?? 'vp9']

  const support = await VideoEncoder.isConfigSupported({
    codec, width: size.width, height: size.height, framerate: frameRate,
    bitrate: videoBitrate(size.width, size.height, frameRate, options.quality),
  })
  if (!support.supported) throw new Error(`This browser cannot encode ${codec} at ${size.width}x${size.height}.`)

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const backend = new HybridWebGLRenderBackend(canvas, '/demo/aurora-ridge.png')
  const encoded: WebMFrame[] = []
  let failure: Error | null = null

  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      encoded.push({ data, timestamp: chunk.timestamp, keyFrame: chunk.type === 'key' })
    },
    error: (error) => { failure = error instanceof Error ? error : new Error(String(error)) },
  })

  try {
    encoder.configure({
      codec,
      width: size.width,
      height: size.height,
      framerate: frameRate,
      bitrate: videoBitrate(size.width, size.height, frameRate, options.quality),
      latencyMode: 'quality',
    })
    await backend.initialize({ ...size, pixelRatio: 1 })

    // A key frame every two seconds keeps clusters small enough to seek near without a Cues index.
    const keyFrameInterval = Math.max(1, frameRate * 2)
    for (let frame = 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError')
      if (failure) throw failure
      await backend.renderFrame({
        ...options.composition,
        time: Math.min(endTime, startTime + frame / frameRate),
        width: size.width,
        height: size.height,
        quality: 'full',
      })
      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1_000_000) / frameRate),
        duration: Math.round(1_000_000 / frameRate),
      })
      try {
        encoder.encode(videoFrame, { keyFrame: frame % keyFrameInterval === 0 })
      } finally {
        videoFrame.close()
      }
      options.onProgress?.(frame + 1, total)
      // Yield between frames, so progress paints and a cancel can still be observed. This also lets
      // the encoder drain instead of queueing every frame of a long export at once.
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    }
    await encoder.flush()
    if (failure) throw failure
  } finally {
    if (encoder.state !== 'closed') encoder.close()
    await backend.dispose()
    canvas.width = 0
    canvas.height = 0
  }

  const bytes = writeWebM({ ...size, codecId: matroskaCodecId(codec), frameRate }, encoded)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buffer], { type: 'video/webm' })
}
