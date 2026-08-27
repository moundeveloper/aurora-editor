import type { EditorNode, EditorNodeConnection } from '@/models/editor'
import { isSourceKind, socketById } from './nodeGraph'

export type NodeBlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'overlay' | 'difference' | 'lighten' | 'darken'

/** What a single source contributes once every node between it and the output has had its say. */
export interface GraphEffects {
  blur: number
  offsetX: number
  offsetY: number
  rotation: number
  scale: number
  opacity: number
  invert: number
  brightness: number
  contrast: number
  temperature: number
  hue: number
  saturation: number
  greyscale: number
  vignetteAmount: number
  vignetteSoftness: number
}

export interface GraphPass {
  nodeId: string
  layerId: string
  effects: GraphEffects
  blendMode: NodeBlendMode
}

export const NEUTRAL_EFFECTS: GraphEffects = {
  blur: 0, offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1,
  invert: 0, brightness: 0, contrast: 0, temperature: 0,
  hue: 0, saturation: 1, greyscale: 0, vignetteAmount: 0, vignetteSoftness: 72,
}

interface EvaluationContext {
  byId: Map<string, EditorNode>
  connections: EditorNodeConnection[]
}

const linkInto = (context: EvaluationContext, nodeId: string, socketId: string) =>
  context.connections.find((connection) => connection.toNodeId === nodeId && connection.toPortId === socketId)

/**
 * Resolves a value socket: a linked socket takes its number from upstream, an unlinked one from the
 * inline default shown on the node. This is what lets a Math node drive a blur radius.
 */
function resolveValue(context: EvaluationContext, node: EditorNode, socketId: string, visiting: Set<string>): number {
  const socket = socketById(node, socketId, 'input')
  const link = linkInto(context, node.id, socketId)
  if (!link) return socket?.value ?? 0
  const upstream = context.byId.get(link.fromNodeId)
  if (!upstream || visiting.has(upstream.id)) return socket?.value ?? 0
  return evaluateValueNode(context, upstream, new Set(visiting).add(upstream.id))
}

function evaluateValueNode(context: EvaluationContext, node: EditorNode, visiting: Set<string>): number {
  if (node.kind !== 'math') return 0
  const a = resolveValue(context, node, node.inputs[0]!.id, visiting)
  const b = resolveValue(context, node, node.inputs[1]!.id, visiting)
  switch (node.properties.operation) {
    case 'subtract': return a - b
    case 'multiply': return a * b
    case 'divide': return b === 0 ? 0 : a / b
    case 'minimum': return Math.min(a, b)
    case 'maximum': return Math.max(a, b)
    case 'absolute': return Math.abs(a)
    case 'sine': return Math.sin(a)
    default: return a + b
  }
}

function applyNode(context: EvaluationContext, node: EditorNode, effects: GraphEffects, visiting: Set<string>): GraphEffects {
  const value = (socketIndex: number) => resolveValue(context, node, node.inputs[socketIndex]!.id, visiting)
  switch (node.kind) {
    case 'translate':
      return { ...effects, offsetX: effects.offsetX + value(1), offsetY: effects.offsetY + value(2) }
    case 'rotate':
      return { ...effects, rotation: effects.rotation + value(1) }
    case 'scale':
      return { ...effects, scale: effects.scale * (value(1) / 100) }
    case 'blur':
      return { ...effects, blur: effects.blur + Math.max(0, value(1)) }
    case 'invert':
      return { ...effects, invert: Math.max(effects.invert, Math.max(0, Math.min(1, value(1)))) }
    case 'brightnessContrast':
      return { ...effects, brightness: effects.brightness + value(1), contrast: effects.contrast + value(2) }
    case 'colorMatrix':
      // The inspector shows contrast as a multiplier around 1; the pass carries it as a percentage.
      return { ...effects, temperature: effects.temperature + value(1), contrast: effects.contrast + (value(2) - 1) * 100 }
    case 'hueSaturation':
      return { ...effects, hue: effects.hue + value(1), saturation: effects.saturation * value(2) }
    case 'rgbToBw':
      return { ...effects, greyscale: Math.max(effects.greyscale, Math.max(0, Math.min(1, value(1)))) }
    case 'vignette':
      return { ...effects, vignetteAmount: Math.max(effects.vignetteAmount, value(1)), vignetteSoftness: value(2) }
    default:
      return effects
  }
}

/**
 * Walks upstream from the render root and returns the passes to draw, background first.
 *
 * The renderer draws straight to the frame buffer with no intermediate targets, so a Mix is
 * expressed as "draw A, then draw B on top with this blend mode and this factor as its alpha".
 * That matches Blender's result whenever A is what is already on the canvas, which is the case for
 * every chain that ends at the output.
 *
 * Returns `null` when the graph has no render root — the caller then falls back to the layer stack.
 * A root that reaches nothing returns an empty list: a deliberately empty frame, not a reason to
 * ignore the graph.
 */
export function evaluateNodeGraph(
  nodes: EditorNode[],
  connections: EditorNodeConnection[],
  rootNodeId?: string | null,
): GraphPass[] | null {
  const context: EvaluationContext = { byId: new Map(nodes.map((node) => [node.id, node])), connections }
  const root = (rootNodeId ? context.byId.get(rootNodeId) : undefined)
    ?? nodes.find((node) => node.kind === 'output')
  if (!root) return null

  const collect = (nodeId: string, effects: GraphEffects, blendMode: NodeBlendMode, visiting: Set<string>): GraphPass[] => {
    const node = context.byId.get(nodeId)
    if (!node || visiting.has(nodeId)) return []
    const branch = new Set(visiting).add(nodeId)

    if (isSourceKind(node.kind)) {
      return node.sourceId ? [{ nodeId: node.id, layerId: node.sourceId, effects, blendMode }] : []
    }

    const imageInputs = node.inputs.filter((socket) => socket.type === 'image')
    const follow = (socketId: string, nextEffects: GraphEffects, nextBlend: NodeBlendMode) => {
      const link = linkInto(context, node.id, socketId)
      return link ? collect(link.fromNodeId, nextEffects, nextBlend, branch) : []
    }

    // A muted node is a wire: its first image input passes through untouched.
    if (node.muted) return imageInputs[0] ? follow(imageInputs[0].id, effects, blendMode) : []

    // Glow is a bloom: the sharp image, plus a blurred and brightened copy added over the top.
    // With no intermediate render targets that second copy has to be its own pass.
    if (node.kind === 'glow') {
      const threshold = resolveValue(context, node, node.inputs[1]!.id, branch)
      const radius = Math.max(0, resolveValue(context, node, node.inputs[2]!.id, branch))
      const intensity = Math.max(0, resolveValue(context, node, node.inputs[3]!.id, branch))
      const sharp = follow(imageInputs[0]!.id, effects, blendMode)
      if (!intensity || !radius) return sharp
      const bloom = follow(imageInputs[0]!.id, {
        ...effects,
        blur: effects.blur + radius,
        brightness: effects.brightness + threshold,
        opacity: effects.opacity * Math.min(1, intensity),
      }, 'add')
      return [...sharp, ...bloom.map((pass) => ({ ...pass, nodeId: `${pass.nodeId}-glow` }))]
    }

    if (node.kind === 'mix') {
      const factor = Math.max(0, Math.min(1, resolveValue(context, node, node.inputs[0]!.id, branch)))
      const blend = (node.properties.blend ?? 'normal') as NodeBlendMode
      const background = follow(imageInputs[0]!.id, effects, blendMode)
      const foreground = follow(imageInputs[1]!.id, { ...effects, opacity: effects.opacity * factor }, blend)
      return [...background, ...foreground]
    }

    const next = applyNode(context, node, effects, branch)
    return imageInputs.flatMap((socket) => follow(socket.id, next, blendMode))
  }

  return collect(root.id, NEUTRAL_EFFECTS, 'normal', new Set())
}

/** Node ids that reach the render root, so the workspace can mark the ones that render nothing. */
export function contributingNodeIds(nodes: EditorNode[], connections: EditorNodeConnection[], rootNodeId?: string | null) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const root = (rootNodeId ? byId.get(rootNodeId) : undefined) ?? nodes.find((node) => node.kind === 'output')
  const reached = new Set<string>()
  if (!root) return reached
  const walk = (nodeId: string) => {
    if (reached.has(nodeId)) return
    reached.add(nodeId)
    connections
      .filter((connection) => connection.toNodeId === nodeId)
      .forEach((connection) => walk(connection.fromNodeId))
  }
  walk(root.id)
  return reached
}
