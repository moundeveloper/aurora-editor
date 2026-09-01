import { describe, expect, it } from 'vitest'
import { AuroraFrameEngine } from '@/engine/rendering/AuroraFrameEngine'
import { AuroraFrameGraphCompiler } from '@/engine/rendering/AuroraFrameGraph'
import { AuroraResourcePool } from '@/engine/rendering/AuroraResourcePool'
import { createDemoNodeGraph } from '@/engine/nodes/nodeGraph'
import type { EditorLayer, EditorProject } from '@/models/editor'
import type { RenderBackend, RenderFrameRequest, RendererInitializationOptions, RenderSurface } from '@/engine/rendering/contracts'

const project: EditorProject = {
  id: 'engine-test', name: 'Engine Test', width: 1920, height: 1080, frameRate: 60,
  duration: 10, backgroundColor: '#000000', updatedAt: 0, version: 12,
}

const property = (id: string, value: number) => ({ id, value, animated: false, keyframes: [] })
const layer: EditorLayer = {
  id: 'hero', name: 'Hero', type: 'shape', start: 0, duration: 10, shapeKind: 'ellipse',
  shapeWidth: 300, shapeHeight: 300, color: '#fff', visible: true, locked: false, muted: false,
  expanded: false, effects: ['Glow'],
  transform: {
    x: property('x', 960), y: property('y', 540), scaleX: property('sx', 100),
    scaleY: property('sy', 100), rotation: property('r', 0), opacity: property('o', 100),
  },
}

function request(time = 0): RenderFrameRequest {
  const graph = createDemoNodeGraph([layer])
  return {
    project, layers: [layer], scenes3D: [], assets: [], nodes: graph.nodes,
    nodeConnections: graph.connections, rigs: [], revision: 1, time,
    width: 1280, height: 720, quality: 'preview',
  }
}

describe('Aurora frame graph compiler', () => {
  it('deduplicates a source used by both sides of a glow branch', () => {
    const compiler = new AuroraFrameGraphCompiler()
    const compiled = compiler.compile(request())

    expect(compiled.logicalPasses).toBe(2)
    expect(compiled.uniqueSources).toBe(1)
    expect(compiled.passes.filter((pass) => pass.kind === 'source-2d')).toHaveLength(1)
  })

  it('reuses graph traversal across timeline frames until the editor revision changes', () => {
    const compiler = new AuroraFrameGraphCompiler()
    expect(compiler.compile(request(0)).cacheHit).toBe(false)
    expect(compiler.compile(request(1)).cacheHit).toBe(true)
    expect(compiler.compile({ ...request(2), revision: 2 }).cacheHit).toBe(false)
  })
})

class DeferredBackend implements RenderBackend {
  renderedTimes: number[] = []
  releaseFirst: (() => void) | null = null

  initialize(_options: RendererInitializationOptions) { return Promise.resolve() }

  resize(_width: number, _height: number, _pixelRatio: number) {}

  async renderFrame(frame: RenderFrameRequest): Promise<RenderSurface> {
    this.renderedTimes.push(frame.time)
    if (this.renderedTimes.length === 1) await new Promise<void>((resolve) => { this.releaseFirst = resolve })
    return { width: frame.width, height: frame.height, backend: 'pixi-webgl', texture: null, premultipliedAlpha: true, colorSpace: 'srgb' }
  }

  dispose() { return Promise.resolve() }
}

describe('Aurora frame scheduling', () => {
  it('drops stale queued work and resolves every caller from the newest frame', async () => {
    const backend = new DeferredBackend()
    const engine = new AuroraFrameEngine({ width: 1280, height: 720 } as HTMLCanvasElement, '', {
      adaptiveQuality: false,
      backendFactory: () => backend,
    })

    const first = engine.requestFrame(request(0))
    await Promise.resolve()
    const stale = engine.requestFrame(request(1))
    const newest = engine.requestFrame(request(2))
    backend.releaseFirst!()
    await Promise.all([first, stale, newest])

    expect(backend.renderedTimes).toEqual([0, 2])
    expect(engine.getStats().droppedRequests).toBe(1)
    await engine.dispose()
  })
})

describe('Aurora transient resource pooling', () => {
  it('reuses compatible allocations and evicts resources that stay idle', () => {
    const destroyed: string[] = []
    const pool = new AuroraResourcePool((key) => ({ key, id: crypto.randomUUID() }), (resource) => destroyed.push(resource.id), 1)
    pool.beginFrame()
    const first = pool.acquire('1280x720:rgba8')
    pool.release(first)
    const reused = pool.acquire('1280x720:rgba8')
    expect(reused).toBe(first)
    pool.release(reused)
    pool.endFrame()
    pool.beginFrame()
    pool.endFrame()
    pool.beginFrame()
    pool.endFrame()

    expect(pool.stats()).toMatchObject({ created: 1, reused: 1, resident: 0, inUse: 0 })
    expect(destroyed).toEqual([first.id])
  })
})
