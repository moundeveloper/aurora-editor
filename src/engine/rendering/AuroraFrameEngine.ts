import { AuroraFrameGraphCompiler, type AuroraFrameGraph } from '@/engine/rendering/AuroraFrameGraph'
import { HybridWebGLRenderBackend, type HybridRendererStats } from '@/engine/rendering/HybridWebGLRenderBackend'
import type {
  RenderBackend, RenderFrameRequest, RendererInitializationOptions, RenderSurface,
} from '@/engine/rendering/contracts'
import { auroraFrameCache, frameCacheAddress, type FrameCacheAddress, type FrameCacheStore } from '@/engine/rendering/frameCache'

export interface AuroraFrameCacheEvent extends FrameCacheAddress {
  hit: boolean
}

export interface AuroraFrameEngineOptions {
  targetFrameMs?: number
  adaptiveQuality?: boolean
  backendFactory?: (canvas: HTMLCanvasElement, sourceUrl: string) => RenderBackend
  /** False disables persistent frame caching; a custom store keeps tests and embedded renderers isolated. */
  frameCache?: FrameCacheStore | false
  onFrameCached?: (event: AuroraFrameCacheEvent) => void
}

export interface AuroraEngineStats extends HybridRendererStats {
  cpuFrameMs: number
  averageFrameMs: number
  droppedRequests: number
  graphCacheHit: boolean
  graphPasses: number
  uniqueSources: number
  effectiveQuality: RenderFrameRequest['quality']
  frameCacheHit: boolean
}

interface PendingFrame {
  request: RenderFrameRequest
  waiters: Array<{
    resolve: (surface: RenderSurface) => void
    reject: (error: unknown) => void
  }>
}

const emptyBackendStats = (width: number, height: number): HybridRendererStats => ({
  backend: 'WebGL2', pixiPasses: 0, pixiBatches: 0, threePasses: 0, threeDrawCalls: 0, triangles: 0, width, height,
})

/**
 * Aurora's single authority for an interactive render surface. It applies latest-frame-wins
 * backpressure, compiles the node graph once per edit revision, and adapts preview resolution with
 * hysteresis. Export calls `renderImmediate`, which never adapts or drops work.
 */
export class AuroraFrameEngine {
  private readonly compiler = new AuroraFrameGraphCompiler()
  private readonly backend: RenderBackend
  private readonly targetFrameMs: number
  private readonly adaptiveQuality: boolean
  private readonly frameCache: FrameCacheStore | null
  private readonly onFrameCached?: (event: AuroraFrameCacheEvent) => void
  private pending: PendingFrame | null = null
  private running = false
  private draining: Promise<void> | null = null
  private disposed = false
  private averageFrameMs = 0
  private droppedRequests = 0
  private slowFrames = 0
  private fastFrames = 0
  private useDraft = false
  private graph: AuroraFrameGraph | null = null
  private stats: AuroraEngineStats

  constructor(canvas: HTMLCanvasElement, sourceUrl: string, options: AuroraFrameEngineOptions = {}) {
    this.targetFrameMs = options.targetFrameMs ?? 16.7
    this.adaptiveQuality = options.adaptiveQuality ?? true
    this.backend = options.backendFactory?.(canvas, sourceUrl) ?? new HybridWebGLRenderBackend(canvas, sourceUrl)
    this.frameCache = options.frameCache === false
      ? null
      : options.frameCache ?? (typeof indexedDB === 'undefined' ? null : auroraFrameCache)
    this.onFrameCached = options.onFrameCached
    this.stats = {
      ...emptyBackendStats(canvas.width, canvas.height), cpuFrameMs: 0, averageFrameMs: 0,
      droppedRequests: 0, graphCacheHit: false, graphPasses: 0, uniqueSources: 0,
      effectiveQuality: 'preview',
      frameCacheHit: false,
    }
  }

  initialize(options: RendererInitializationOptions) {
    return this.backend.initialize(options)
  }

  requestFrame(request: RenderFrameRequest): Promise<RenderSurface> {
    if (this.disposed) return Promise.reject(new Error('Aurora frame engine is disposed'))
    return new Promise((resolve, reject) => {
      if (this.pending) {
        this.droppedRequests += 1
        this.pending.request = request
        this.pending.waiters.push({ resolve, reject })
        return
      }
      this.pending = { request, waiters: [{ resolve, reject }] }
      if (!this.running) {
        this.draining = this.drain()
        void this.draining.finally(() => { this.draining = null })
      }
    })
  }

  async renderImmediate(request: RenderFrameRequest) {
    if (this.disposed) throw new Error('Aurora frame engine is disposed')
    const graph = this.compiler.compile(request)
    return this.renderCompiled(request, graph, false)
  }

  private async drain() {
    this.running = true
    while (this.pending && !this.disposed) {
      const frame = this.pending
      this.pending = null
      try {
        const graph = this.compiler.compile(frame.request)
        const surface = await this.renderCompiled(frame.request, graph, true)
        frame.waiters.forEach((waiter) => waiter.resolve(surface))
      } catch (error) {
        frame.waiters.forEach((waiter) => waiter.reject(error))
      }
    }
    this.running = false
  }

  private async renderCompiled(request: RenderFrameRequest, graph: AuroraFrameGraph, interactive: boolean) {
    const effectiveQuality = interactive && this.adaptiveQuality && this.useDraft && request.quality === 'preview'
      ? 'draft'
      : request.quality
    const started = performance.now()
    const address = frameCacheAddress(request, effectiveQuality)
    let frameCacheHit = false
    let surface: RenderSurface | null = null
    if (this.frameCache && this.backend.presentPixels) {
      try {
        const cached = await this.frameCache.get(address)
        if (cached) {
          surface = await this.backend.presentPixels(cached)
          frameCacheHit = true
        }
      } catch {
        // Cache corruption or storage denial must never blank the renderer.
      }
    }
    if (!surface) {
      surface = await this.backend.renderFrame({ ...request, quality: effectiveQuality, compiledPlan: graph.renderPlan })
      const pixels = this.frameCache && request.cacheWrite ? this.backend.readPixels?.() : null
      if (this.frameCache && pixels) {
        try {
          await this.frameCache.put({ ...address, ...pixels })
        } catch {
          // Quota pressure degrades to uncached rendering.
        }
      }
    }
    if (frameCacheHit || request.cacheWrite) this.onFrameCached?.({ ...address, hit: frameCacheHit })
    const elapsed = performance.now() - started
    this.averageFrameMs = this.averageFrameMs ? this.averageFrameMs * .88 + elapsed * .12 : elapsed
    if (interactive && this.adaptiveQuality && request.quality === 'preview') this.updateAdaptiveQuality()
    this.graph = graph
    const backendStats = 'getStats' in this.backend
      ? (this.backend as RenderBackend & { getStats(): HybridRendererStats }).getStats()
      : emptyBackendStats(surface.width, surface.height)
    this.stats = {
      ...backendStats,
      cpuFrameMs: elapsed,
      averageFrameMs: this.averageFrameMs,
      droppedRequests: this.droppedRequests,
      graphCacheHit: graph.cacheHit,
      graphPasses: graph.logicalPasses,
      uniqueSources: graph.uniqueSources,
      effectiveQuality,
      frameCacheHit,
    }
    return surface
  }

  private updateAdaptiveQuality() {
    if (this.averageFrameMs > this.targetFrameMs * 1.18) {
      this.slowFrames += 1
      this.fastFrames = 0
      if (this.slowFrames >= 3) this.useDraft = true
    } else if (this.averageFrameMs < this.targetFrameMs * .72) {
      this.fastFrames += 1
      this.slowFrames = 0
      if (this.fastFrames >= 24) this.useDraft = false
    } else {
      this.slowFrames = 0
      this.fastFrames = 0
    }
  }

  getStats() {
    return { ...this.stats }
  }

  getFrameGraph() {
    return this.graph
  }

  async dispose() {
    this.disposed = true
    this.pending?.waiters.forEach((waiter) => waiter.reject(new Error('Aurora frame engine was disposed')))
    this.pending = null
    await this.draining
    await this.backend.dispose()
  }
}
