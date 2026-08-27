import { describe, expect, it } from 'vitest'
import { HybridWebGLRenderBackend } from '@/engine/rendering/HybridWebGLRenderBackend'
import type { RendererInitializationOptions } from '@/engine/rendering/contracts'

/**
 * Real setup needs a canvas and a WebGL2 context, so the resource creation is stubbed. What is under
 * test is the guard around it: switching workspaces mid-playback used to start a second setup while
 * the first was still running, building rival renderers on one canvas and blanking the viewport.
 */
class CountingBackend extends HybridWebGLRenderBackend {
  createCalls = 0

  constructor() {
    super({ addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement, '')
  }

  protected override async createResources(_options: RendererInitializationOptions) {
    this.createCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

class FailingBackend extends CountingBackend {
  protected override async createResources(_options: RendererInitializationOptions) {
    this.createCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    throw new Error('context unavailable')
  }
}

const options: RendererInitializationOptions = { width: 1280, height: 720, pixelRatio: 1 }

describe('hybrid backend initialization', () => {
  it('builds its resources once when several callers race the first setup', async () => {
    const backend = new CountingBackend()
    await Promise.all([backend.initialize(options), backend.initialize(options), backend.initialize(options)])
    expect(backend.createCalls).toBe(1)
  })

  it('does not rebuild after setup has completed', async () => {
    const backend = new CountingBackend()
    await backend.initialize(options)
    await backend.initialize(options)
    expect(backend.createCalls).toBe(1)
  })

  it('waits for in-flight setup before disposing so nothing is orphaned', async () => {
    const backend = new CountingBackend()
    const pending = backend.initialize(options)
    await backend.dispose()
    await pending
    expect(backend.createCalls).toBe(1)
  })

  it('allows a retry after a failed setup instead of caching the rejection', async () => {
    const backend = new FailingBackend()
    await expect(backend.initialize(options)).rejects.toThrow('context unavailable')
    await expect(backend.initialize(options)).rejects.toThrow('context unavailable')
    expect(backend.createCalls).toBe(2)
  })
})
