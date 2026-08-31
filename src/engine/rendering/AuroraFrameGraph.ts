import { evaluateNodeGraph, NEUTRAL_EFFECTS, type GraphEffects, type GraphPass } from '@/engine/nodes/evaluateGraph'
import type { EditorLayer } from '@/models/editor'
import type { RenderFrameRequest, RenderPass, RenderPlan } from '@/engine/rendering/contracts'

export type AuroraFramePassKind = 'source-2d' | 'source-3d' | 'effect' | 'composite' | 'present'

export interface AuroraFrameGraphPass {
  id: string
  kind: AuroraFramePassKind
  reads: string[]
  writes: string
  layerId?: string
}

export interface AuroraFrameGraph {
  renderPlan: RenderPlan
  passes: AuroraFrameGraphPass[]
  uniqueSources: number
  logicalPasses: number
  cacheHit: boolean
}

const isLayerLive = (layer: EditorLayer, time: number) =>
  !layer.isPlaceholder && layer.visible && layer.type !== 'audio'
  && time >= layer.start && time < layer.start + layer.duration

const makePass = (nodeId: string, layer: EditorLayer, effects: GraphEffects, blendMode: GraphPass['blendMode']): RenderPass => ({
  id: `pass-${nodeId}`,
  layerId: layer.id,
  backend: layer.type === '3d-scene' ? 'three-webgl' : 'pixi-webgl',
  ...(layer.sceneId ? { sceneId: layer.sceneId } : {}),
  effects,
  blendMode,
})

function effectKey(effects: GraphEffects) {
  return [
    effects.offsetX, effects.offsetY, effects.rotation, effects.scale, effects.opacity,
    effects.blur, effects.brightness, effects.contrast, effects.temperature, effects.hue,
    effects.saturation, effects.greyscale, effects.invert, effects.vignetteAmount,
    effects.vignetteSoftness, effects.mask?.layerId ?? '', effects.mask?.feather ?? 0,
    effects.mask?.inverted ? 1 : 0, effects.mask?.segmentFeather.join(',') ?? '',
  ].join('|')
}

/**
 * Compiles editor nodes once per structural revision. Time only filters the already-compiled source
 * list, keeping timeline playback out of the graph traversal and allocation path.
 */
export class AuroraFrameGraphCompiler {
  private revision = Number.NaN
  private root: string | null | undefined
  private graphPasses: GraphPass[] | null = null

  compile(request: RenderFrameRequest): AuroraFrameGraph {
    const revision = request.revision ?? -1
    const root = request.renderRootNodeId
    const cacheHit = revision === this.revision && root === this.root
    if (!cacheHit) {
      this.revision = revision
      this.root = root
      this.graphPasses = request.nodes?.length
        ? evaluateNodeGraph(request.nodes, request.nodeConnections ?? [], root)
        : null
    }

    const layerMap = new Map(request.layers.map((layer) => [layer.id, layer]))
    const renderPasses = this.graphPasses
      ? this.graphPasses.flatMap((pass) => {
        const layer = layerMap.get(pass.layerId)
        if (!layer || !isLayerLive(layer, request.time)) return []
        const mask = pass.effects.mask
        if (!mask) return [makePass(pass.nodeId, layer, pass.effects, pass.blendMode)]
        const maskLayer = layerMap.get(mask.layerId)
        if (maskLayer && isLayerLive(maskLayer, request.time)) return [makePass(pass.nodeId, layer, pass.effects, pass.blendMode)]
        return mask.inverted
          ? [makePass(pass.nodeId, layer, { ...pass.effects, mask: null }, pass.blendMode)]
          : []
      })
      : request.layers
        .filter((layer) => isLayerLive(layer, request.time))
        .reverse()
        .map((layer) => makePass(layer.id, layer, NEUTRAL_EFFECTS, 'normal'))

    const graphPasses: AuroraFrameGraphPass[] = []
    const sources = new Set<string>()
    const effects = new Set<string>()
    renderPasses.forEach((pass, index) => {
      const source = `source:${pass.layerId}`
      if (!sources.has(source)) {
        sources.add(source)
        graphPasses.push({
          id: source,
          kind: pass.backend === 'three-webgl' ? 'source-3d' : 'source-2d',
          reads: [],
          writes: source,
          layerId: pass.layerId,
        })
      }
      const signature = effectKey(pass.effects)
      const effected = `effect:${pass.layerId}:${signature}`
      if (!effects.has(effected)) {
        effects.add(effected)
        graphPasses.push({ id: effected, kind: 'effect', reads: [source], writes: effected, layerId: pass.layerId })
      }
      graphPasses.push({ id: `composite:${index}`, kind: 'composite', reads: [effected, 'frame:color'], writes: 'frame:color' })
    })
    graphPasses.push({ id: 'present', kind: 'present', reads: ['frame:color'], writes: 'surface' })

    return {
      renderPlan: {
        width: request.width,
        height: request.height,
        time: request.time,
        quality: request.quality,
        passes: renderPasses,
      },
      passes: graphPasses,
      uniqueSources: sources.size,
      logicalPasses: renderPasses.length,
      cacheHit,
    }
  }
}
