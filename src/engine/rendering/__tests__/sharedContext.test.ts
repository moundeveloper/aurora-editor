import { describe, expect, it, vi } from 'vitest'
import { Container } from 'pixi.js'
import { HybridWebGLRenderBackend } from '../HybridWebGLRenderBackend'
import { NEUTRAL_EFFECTS } from '@/engine/nodes/evaluateGraph'
import type { RenderFrameRequest } from '../contracts'

describe('shared WebGL renderer handoff', () => {
  it('cleans outgoing Three state before a filtered Pixi overlay renders', async () => {
    const backend = new HybridWebGLRenderBackend({} as HTMLCanvasElement, '')
    let externalStateDirty = false
    const visibleBatches: boolean[] = []
    // Model state left behind by 3D post-processing that Pixi does not own/reset.
    Object.assign(backend, {
      initialized: true,
      threeRenderer: {
        resetState: () => { externalStateDirty = false },
        setRenderTarget() {}, setScissorTest() {}, setClearColor() {}, clear() {},
        info: { render: { calls: 1, triangles: 2 } },
      },
      pixiRenderer: {
        resetState() {},
        render: () => { visibleBatches.push(!externalStateDirty) },
      },
      lastStats: { width: 64, height: 64 },
      runtimeRegistry: { prepareAssets: vi.fn().mockResolvedValue(undefined) },
      resolveFrameTextures: vi.fn().mockResolvedValue(undefined),
      appendPixiLayer: (stage: Container) => {
        const container = new Container()
        stage.addChild(container)
        return { container, cached: false }
      },
      renderThreeLayer: () => { externalStateDirty = true },
    })
    const request = {
      project: { width: 64, height: 64, backgroundColor: '#000000' },
      layers: [{ id: 'background' }, { id: 'scene' }, { id: 'overlay' }],
      scenes3D: [{ id: 'scene' }], time: 0, width: 64, height: 64, quality: 'preview',
      compiledPlan: {
        width: 64, height: 64, time: 0, quality: 'preview',
        passes: ['background', 'scene', 'overlay'].map(id => ({
          id, layerId: id, sceneId: 'scene', effects: NEUTRAL_EFFECTS, blendMode: 'normal',
          backend: id === 'scene' ? 'three-webgl' : 'pixi-webgl',
        })),
      },
    } as unknown as RenderFrameRequest
    await backend.renderFrame(request)
    await backend.renderFrame(request)
    expect(visibleBatches).toEqual([true, true, true, true])
  })
})
