import type { CachedFramePixels } from './contracts'

export type ScopeMode = 'waveform' | 'parade' | 'vectorscope'
export function scopeDensity(frame: CachedFramePixels, mode: ScopeMode, width = 384, height = 192) {
  const bins = new Uint32Array(width * height * 3)
  const plot = (x: number, y: number, channel: number) => {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)))
    const py = Math.max(0, Math.min(height - 1, Math.round(y)))
    bins[(py * width + px) * 3 + channel]!++
  }
  const stride = Math.max(1, Math.ceil(Math.sqrt(frame.width * frame.height / 100000)))
  for (let y = 0; y < frame.height; y += stride) for (let x = 0; x < frame.width; x += stride) {
    const offset = (y * frame.width + x) * 4
    if (!frame.data[offset + 3]) continue
    const r = frame.data[offset]! / 255, g = frame.data[offset + 1]! / 255, b = frame.data[offset + 2]! / 255
    const luma = .2126 * r + .7152 * g + .0722 * b
    const horizontal = x / Math.max(1, frame.width - 1)
    if (mode === 'waveform') plot(horizontal * (width - 1), (1 - luma) * (height - 1), 1)
    else if (mode === 'parade') [r, g, b].forEach((value, channel) => plot((channel + horizontal) / 3 * (width - 1), (1 - value) * (height - 1), channel))
    else {
      const cb = (b - luma) / 1.8556, cr = (r - luma) / 1.5748
      plot((.5 + cb) * (width - 1), (.5 - cr) * (height - 1), 1)
    }
  }
  return bins
}

const listeners = new Set<(frame: CachedFramePixels) => void>()
let lastRead = -Infinity
export function subscribeScope(listener: (frame: CachedFramePixels) => void) {
  listeners.add(listener)
  lastRead = -Infinity
  return () => { listeners.delete(listener) }
}
/** Read back only while the Scopes panel is mounted, at most ten times per second. */
export function publishScopeFrame(read: () => CachedFramePixels | null) {
  if (!listeners.size || performance.now() - lastRead < 100) return
  lastRead = performance.now()
  const frame = read()
  if (frame) for (const listener of listeners) listener(frame)
}
