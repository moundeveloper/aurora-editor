import type { EditorLayer, EditorNodeConnection, LayerEffect, LayerEffectKind } from '@/models/editor'
import { evaluateNodeGraph, NEUTRAL_EFFECTS, type GraphEffects, type GraphPass, type NodeBlendMode } from './evaluateGraph'
import { createNode, NODE_DEFINITIONS } from './nodeGraph'

export const LAYER_EFFECT_KINDS: LayerEffectKind[] = [
  'blur', 'glow', 'vignette', 'brightnessContrast', 'colorMatrix', 'hueSaturation', 'invert', 'rgbToBw',
  'translate', 'rotate', 'scale',
]

export const LAYER_EFFECT_OPTIONS = LAYER_EFFECT_KINDS.map((kind) => ({
  value: kind,
  label: NODE_DEFINITIONS[kind].label,
}))

const LEGACY_KINDS: Record<string, LayerEffectKind> = {
  Blur: 'blur',
  Glow: 'glow',
  Vignette: 'vignette',
  Invert: 'invert',
  Translate: 'translate',
  Rotate: 'rotate',
  Scale: 'scale',
  'Brightness / Contrast': 'brightnessContrast',
  'Color Matrix': 'colorMatrix',
  'Hue / Saturation': 'hueSaturation',
  'RGB to BW': 'rgbToBw',
}

/** Values displayed by the old read-only inspector, retained exactly during migration. */
const LEGACY_VALUES: Partial<Record<string, Record<string, number>>> = {
  Glow: { threshold: 62, radius: 28, intensity: 1.45 },
  Vignette: { amount: 34, softness: 72 },
  'Color Matrix': { temperature: -8, contrast: 1.12 },
  'Brightness / Contrast': { brightness: 4, contrast: 12 },
}

export const isLayerEffectKind = (value: unknown): value is LayerEffectKind =>
  typeof value === 'string' && LAYER_EFFECT_KINDS.includes(value as LayerEffectKind)

export function layerEffectLabel(kind: LayerEffectKind) {
  return NODE_DEFINITIONS[kind].label
}

export function layerEffectParameters(kind: LayerEffectKind) {
  return NODE_DEFINITIONS[kind].inputs.slice(1)
}

function normalizedParameterValue(value: unknown, fallback: number, min?: number, max?: number) {
  const finite = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, finite))
}

export function createLayerEffect(kind: LayerEffectKind, id: string = crypto.randomUUID(), values: Record<string, number> = {}): LayerEffect {
  return {
    id,
    kind,
    enabled: true,
    values: Object.fromEntries(layerEffectParameters(kind).map((parameter) => [
      parameter.key,
      normalizedParameterValue(values[parameter.key], parameter.value ?? 0, parameter.min, parameter.max),
    ])),
  }
}

/**
 * Accepts both the current record and pre-v14 string entries. Malformed and unsupported operators
 * are ignored; this notably drops the old `Gain` badge instead of pretending it affects pixels.
 */
export function normalizeLayerEffect(value: unknown, fallbackId: string): LayerEffect | null {
  if (typeof value === 'string') {
    const kind = LEGACY_KINDS[value]
    return kind ? createLayerEffect(kind, fallbackId, LEGACY_VALUES[value]) : null
  }
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<LayerEffect>
  if (!isLayerEffectKind(candidate.kind)) return null
  const normalized = createLayerEffect(candidate.kind, typeof candidate.id === 'string' && candidate.id ? candidate.id : fallbackId,
    candidate.values && typeof candidate.values === 'object' ? candidate.values : {})
  normalized.enabled = candidate.enabled !== false
  return normalized
}

export function normalizeLayerEffectStacks(layers: EditorLayer[]) {
  const walk = (items: EditorLayer[]) => items.forEach((layer) => {
    const raw = Array.isArray(layer.effects) ? layer.effects as unknown[] : []
    const seen = new Set<string>()
    layer.effects = raw
      .map((effect, index) => normalizeLayerEffect(effect, `${layer.id}-effect-${index}`))
      .filter((effect): effect is LayerEffect => Boolean(effect))
      .map((effect, index) => {
        if (!seen.has(effect.id)) {
          seen.add(effect.id)
          return effect
        }
        let id = `${layer.id}-effect-${index}`
        let suffix = 2
        while (seen.has(id)) id = `${layer.id}-effect-${index}-${suffix++}`
        seen.add(id)
        return { ...effect, id }
      })
    if (layer.children) walk(layer.children)
  })
  walk(layers)
}

function nodeForEffect(effect: LayerEffect) {
  const node = createNode(effect.kind, 0, 0, `layer-effect-node-${effect.id}`)
  layerEffectParameters(effect.kind).forEach((parameter, index) => {
    const value = effect.values[parameter.key]
    if (Number.isFinite(value) && node.inputs[index + 1]) node.inputs[index + 1]!.value = value
  })
  return node
}

/** Runs a layer stack through the exact same node evaluator used by authored graph operators. */
export function evaluateLayerEffectStack(
  layer: EditorLayer,
  initialEffects: GraphEffects = NEUTRAL_EFFECTS,
  blendMode: NodeBlendMode = 'normal',
): GraphPass[] {
  const enabled = (layer.effects ?? []).filter((effect) => effect.enabled)
  if (!enabled.length) return [{ nodeId: `layer-${layer.id}`, layerId: layer.id, effects: initialEffects, blendMode }]

  const source = createNode('image', 0, 0, `layer-effect-source-${layer.id}`)
  source.sourceId = layer.id
  const operators = enabled.map(nodeForEffect)
  const output = createNode('output', 0, 0, `layer-effect-output-${layer.id}`)
  const nodes = [source, ...operators, output]
  const connections: EditorNodeConnection[] = []
  let tail = source
  for (const operator of operators) {
    connections.push({
      id: `layer-effect-link-${tail.id}-${operator.id}`,
      fromNodeId: tail.id, fromPortId: tail.outputs[0]!.id,
      toNodeId: operator.id, toPortId: operator.inputs[0]!.id,
    })
    tail = operator
  }
  connections.push({
    id: `layer-effect-link-${tail.id}-${output.id}`,
    fromNodeId: tail.id, fromPortId: tail.outputs[0]!.id,
    toNodeId: output.id, toPortId: output.inputs[0]!.id,
  })
  return (evaluateNodeGraph(nodes, connections, output.id, initialEffects, blendMode) ?? [])
}
