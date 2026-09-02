import type { Aurora3DScene, AuroraRig, EditorLayer, EditorNode, EditorNodeConnection, EditorProject, MediaAsset } from '@/models/editor'
import { evaluateNodeGraph, NEUTRAL_EFFECTS, type GraphEffects, type NodeBlendMode } from '@/engine/nodes/evaluateGraph'

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
  effects: GraphEffects
  blendMode: NodeBlendMode
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
  /** Library entries, so a layer's assetId resolves to the media the vault is serving. */
  assets?: MediaAsset[]
  nodes?: EditorNode[]
  nodeConnections?: EditorNodeConnection[]
  /** Deformation skeletons a layer or 3D object may be attached to. */
  rigs?: AuroraRig[]
  /** A Viewer node takes over the frame when one is active; otherwise the Composite node is the root. */
  renderRootNodeId?: string | null
  /** Structural editor revision; time changes do not invalidate the compiled graph. */
  revision?: number
  /** Distinguishes the main composition from isolated cluster timelines in the persistent cache. */
  cacheScope?: string
  /** Stable after a save, but unique while edits are pending, so persisted frames survive reloads. */
  cacheVersion?: string | number
  /** Explicit background renders opt into the GPU readback and persistent write cost. */
  cacheWrite?: boolean
  time: number
  /** Sequential playback uses the media decoder clock; scrubbing and export request exact seeks. */
  playback?: boolean
  width: number
  height: number
  quality: RenderQuality
  /** Supplied by AuroraFrameEngine so the device never recompiles editor nodes. */
  compiledPlan?: RenderPlan
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
  /** Optional top-down RGBA readback used by the persistent frame cache. */
  readPixels?(): CachedFramePixels | null
  /** Optional fast path that presents a cached top-down RGBA frame without evaluating the scene. */
  presentPixels?(frame: CachedFramePixels): Promise<RenderSurface> | RenderSurface
  dispose(): Promise<void>
}

export interface CachedFramePixels {
  width: number
  height: number
  data: Uint8ClampedArray
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

const isLayerLive = (layer: EditorLayer, time: number) =>
  !layer.isPlaceholder && layer.visible && layer.type !== 'audio'
  && time >= layer.start && time < layer.start + layer.duration

const makePass = (id: string, layer: EditorLayer, effects: GraphEffects, blendMode: NodeBlendMode = 'normal'): RenderPass => ({
  id,
  layerId: layer.id,
  backend: layer.type === '3d-scene' ? 'three-webgl' : 'pixi-webgl',
  ...(layer.sceneId ? { sceneId: layer.sceneId } : {}),
  effects,
  blendMode,
})

/**
 * The node graph decides what reaches the viewport: passes come from walking back through Media
 * Output. A project without an output node — nothing has been authored yet — still renders its
 * layer stack, so the graph is an upgrade rather than a prerequisite.
 *
 * A layer outside its time range is skipped either way; the graph controls composition, not timing.
 */
export function createRenderPlan(request: RenderFrameRequest): RenderPlan {
  const layerMap = new Map(request.layers.map((layer) => [layer.id, layer]))
  const graphPasses = request.nodes?.length
    ? evaluateNodeGraph(request.nodes, request.nodeConnections ?? [], request.renderRootNodeId)
    : null

  const passes = graphPasses
    ? graphPasses.flatMap((pass) => {
      const layer = layerMap.get(pass.layerId)
      if (!layer || !isLayerLive(layer, request.time)) return []
      const mask = pass.effects.mask
      if (!mask) return [makePass(`pass-${pass.nodeId}`, layer, pass.effects, pass.blendMode)]
      /*
       * A mask shape is a clip on the timeline, so it only exists inside its own range. Outside it
       * there is no shape to keep anything, and a mask that keeps nothing shows nothing — the layer
       * drops out rather than appearing unmasked before its shape arrives. Inverted is the mirror of
       * that: with nothing to cut away, the whole layer comes through.
       */
      const maskLayer = layerMap.get(mask.layerId)
      if (maskLayer && isLayerLive(maskLayer, request.time)) {
        return [makePass(`pass-${pass.nodeId}`, layer, pass.effects, pass.blendMode)]
      }
      return mask.inverted
        ? [makePass(`pass-${pass.nodeId}`, layer, { ...pass.effects, mask: null }, pass.blendMode)]
        : []
    })
    : request.layers
      .filter((layer) => isLayerLive(layer, request.time))
      .reverse()
      .map((layer) => makePass(`pass-${layer.id}`, layer, NEUTRAL_EFFECTS))

  return {
    width: request.width,
    height: request.height,
    time: request.time,
    quality: request.quality,
    passes,
  }
}

