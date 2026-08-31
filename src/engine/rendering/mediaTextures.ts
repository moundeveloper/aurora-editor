import { Texture } from 'pixi.js'

/**
 * Textures for media served out of the vault.
 *
 * Blobs are addressed by content, so a URL identifies bytes that can never change — one decode per
 * URL is enough for the lifetime of the renderer, and the cache never needs invalidating. Entries are
 * promises so that several layers referencing the same clip in one frame share a single decode
 * rather than racing to start their own.
 */

interface VideoEntry {
  element: HTMLVideoElement
  texture: Texture
  /** The frame currently uploaded, so an unchanged time skips the seek entirely. */
  seekedTo: number
  playing: boolean
}

const SEEK_EPSILON = 1 / 240

export class MediaTextureCache {
  private readonly images = new Map<string, Promise<Texture | null>>()
  private readonly videos = new Map<string, Promise<VideoEntry | null>>()

  image(url: string): Promise<Texture | null> {
    const existing = this.images.get(url)
    if (existing) return existing
    const loading = (async () => {
      try {
        const element = new Image()
        element.decoding = 'async'
        element.crossOrigin = 'anonymous'
        element.src = url
        await element.decode()
        return Texture.from(element)
      } catch {
        return null
      }
    })()
    this.images.set(url, loading)
    return loading
  }

  private video(url: string): Promise<VideoEntry | null> {
    const existing = this.videos.get(url)
    if (existing) return existing
    const loading = (async () => {
      try {
        const element = document.createElement('video')
        element.src = url
        element.muted = true
        element.playsInline = true
        element.preload = 'auto'
        element.crossOrigin = 'anonymous'
        await new Promise<void>((resolve, reject) => {
          element.addEventListener('loadeddata', () => resolve(), { once: true })
          element.addEventListener('error', () => reject(new Error(`cannot decode ${url}`)), { once: true })
        })
        return { element, texture: Texture.from(element), seekedTo: Number.NaN, playing: false }
      } catch {
        return null
      }
    })()
    this.videos.set(url, loading)
    return loading
  }

  /**
   * The video's frame at a given time. The element stays paused and is seeked per frame, which is
   * what a scrubbing preview needs — playback sync is a separate concern from having the right
   * picture on screen at a given playhead position.
   */
  async videoFrame(url: string, time: number, playback = false): Promise<Texture | null> {
    const entry = await this.video(url)
    if (!entry) return null
    const duration = Number.isFinite(entry.element.duration) ? entry.element.duration : 0
    const target = Math.max(0, duration ? Math.min(time, Math.max(0, duration - SEEK_EPSILON)) : time)
    if (playback) {
      const drift = Math.abs(entry.element.currentTime - target)
      if (!entry.playing || drift > .12) await this.seek(entry, target)
      if (!entry.playing) {
        entry.playing = true
        void entry.element.play().catch(() => { entry.playing = false })
      }
      entry.seekedTo = entry.element.currentTime
      entry.texture.source.update()
      return entry.texture
    }

    if (entry.playing) {
      entry.element.pause()
      entry.playing = false
    }
    if (Math.abs(entry.seekedTo - target) < SEEK_EPSILON) return entry.texture
    await this.seek(entry, target)
    return entry.texture
  }

  private async seek(entry: VideoEntry, target: number) {
    entry.element.currentTime = target
    await new Promise<void>((resolve) => {
      // A seek that never resolves must not stall the frame; the previous picture is better than none.
      const timeout = setTimeout(finish, 250)
      function finish() {
        clearTimeout(timeout)
        entry!.element.removeEventListener('seeked', finish)
        resolve()
      }
      entry.element.addEventListener('seeked', finish, { once: true })
    })
    entry.seekedTo = target
    entry.texture.source.update()
  }

  dispose() {
    for (const pending of this.images.values()) void pending.then((texture) => texture?.destroy(true))
    for (const pending of this.videos.values()) {
      void pending.then((entry) => {
        if (!entry) return
        entry.texture.destroy(true)
        entry.element.removeAttribute('src')
        entry.element.load()
      })
    }
    this.images.clear()
    this.videos.clear()
  }
}
