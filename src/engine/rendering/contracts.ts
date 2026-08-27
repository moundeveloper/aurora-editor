import type { Aurora3DScene, EditorLayer, EditorProject } from '@/models/editor'

export type RenderBackendId = 'pixi-webgl' | 'three-webgl' | 'canvas2d'
export type RenderQuality = 'draft' | 'preview' | 'full'

export interface RenderSurface {
  width: number
  height: number
  backend: RenderBackendId
  texture: unknown | null
  premultipliedAlpha: boolean
  colorSpace: 'srgb'
}

export interface RenderPass {
  id: string
  layerId: string
  backend: RenderBackendId
  sceneId?: string
}

export interface RenderPlan {
  width: number
  height: number
  time: number
  quality: RenderQuality
  passes: RenderPass[]
}

export interface RenderFrameRequest {
  project: EditorProject
  layers: EditorLayer[]
  scenes3D: Aurora3DScene[]
  time: number
  width: number
  height: number
  quality: RenderQuality
}

export interface RendererInitializationOptions {
  width: number
  height: number
  pixelRatio: number
}

export interface RenderBackend {
  initialize(options: RendererInitializationOptions): Promise<void>
  resize(width: number, height: number, pixelRatio: number): void
  renderFrame(request: RenderFrameRequest): Promise<RenderSurface>
  dispose(): Promise<void>
}

export const HYBRID_ALPHA_CONTRACT = Object.freeze({
  alpha: true,
  premultipliedAlpha: true,
  clearAlpha: 1,
  sceneClearAlpha: 0,
  colorSpace: 'srgb' as const,
})

export function resolveRenderSize(width: number, height: number, quality: RenderQuality) {
  const scale = quality === 'draft' ? .5 : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function createRenderPlan(request: RenderFrameRequest): RenderPlan {
  const activeLayers = request.layers
    .filter((layer) => !layer.isPlaceholder && layer.visible && layer.type !== 'audio' && request.time >= layer.start && request.time < layer.start + layer.duration)
    .reverse()
  return {
    width: request.width,
    height: request.height,
    time: request.time,
    quality: request.quality,
    passes: activeLayers.map((layer) => ({
      id: `pass-${layer.id}`,
      layerId: layer.id,
      backend: layer.type === '3d-scene' ? 'three-webgl' : 'pixi-webgl',
      ...(layer.sceneId ? { sceneId: layer.sceneId } : {}),
    })),
  }
}

