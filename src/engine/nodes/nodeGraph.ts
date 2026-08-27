import type {
  EditorLayer, EditorNode, EditorNodeConnection, EditorNodeKind, EditorNodeSocket, EditorNodeSocketType,
} from '@/models/editor'

/**
 * Node geometry, laid out the way Blender stacks a node: header, then output sockets, then the
 * node's own dropdowns, then the input sockets. Every row is the same height, so the DOM and the
 * connection curves derive socket anchors from the same arithmetic instead of guessing.
 */
export const NODE_WIDTH = 158
export const NODE_HEADER_HEIGHT = 22
export const NODE_ROW_HEIGHT = 21
export const NODE_BODY_PADDING = 5

export const SOCKET_COLORS: Record<EditorNodeSocketType, string> = {
  image: '#d9b45a',
  value: '#9a9a9a',
}

export interface SocketDefinition {
  key: string
  label: string
  type: EditorNodeSocketType
  value?: number
  min?: number
  max?: number
  step?: number
  suffix?: string
}

export interface PropertyDefinition {
  key: string
  label: string
  value: string
  options: { value: string; label: string }[]
}

export interface NodeKindDefinition {
  kind: EditorNodeKind
  label: string
  category: 'Input' | 'Distort' | 'Filter' | 'Color' | 'Composite' | 'Converter' | 'Output'
  color: string
  inputs: SocketDefinition[]
  outputs: SocketDefinition[]
  properties: PropertyDefinition[]
  /** Source nodes read a layer of one of these types instead of an input socket. */
  sourceLayerTypes?: EditorLayer['type'][]
  /** Stack grows an extra input whenever its last one is taken. */
  dynamicInputs?: boolean
}

const IMAGE_IN: SocketDefinition = { key: 'image', label: 'Image', type: 'image' }
const IMAGE_OUT: SocketDefinition = { key: 'image', label: 'Image', type: 'image' }

export const BLEND_MODES = [
  { value: 'normal', label: 'Over' },
  { value: 'add', label: 'Add' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'difference', label: 'Difference' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'darken', label: 'Darken' },
]

export const MATH_OPERATIONS = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'divide', label: 'Divide' },
  { value: 'minimum', label: 'Minimum' },
  { value: 'maximum', label: 'Maximum' },
  { value: 'absolute', label: 'Absolute' },
  { value: 'sine', label: 'Sine' },
]

export const NODE_DEFINITIONS: Record<EditorNodeKind, NodeKindDefinition> = {
  image: {
    kind: 'image', label: 'Image', category: 'Input', color: '#5d80b6',
    inputs: [], outputs: [IMAGE_OUT], properties: [],
    sourceLayerTypes: ['video', 'image', 'shape', 'adjustment', 'cluster'],
  },
  text: {
    kind: 'text', label: 'Text', category: 'Input', color: '#c59062',
    inputs: [], outputs: [IMAGE_OUT], properties: [], sourceLayerTypes: ['text'],
  },
  scene3d: {
    kind: 'scene3d', label: '3D Scene', category: 'Input', color: '#7888db',
    inputs: [], outputs: [IMAGE_OUT], properties: [], sourceLayerTypes: ['3d-scene'],
  },
  translate: {
    kind: 'translate', label: 'Translate', category: 'Distort', color: '#a17dba',
    inputs: [
      IMAGE_IN,
      { key: 'x', label: 'X', type: 'value', value: 0, step: 1, suffix: 'px' },
      { key: 'y', label: 'Y', type: 'value', value: 0, step: 1, suffix: 'px' },
    ],
    outputs: [IMAGE_OUT], properties: [],
  },
  rotate: {
    kind: 'rotate', label: 'Rotate', category: 'Distort', color: '#a17dba',
    inputs: [IMAGE_IN, { key: 'angle', label: 'Angle', type: 'value', value: 0, step: 1, suffix: '°' }],
    outputs: [IMAGE_OUT], properties: [],
  },
  scale: {
    kind: 'scale', label: 'Scale', category: 'Distort', color: '#a17dba',
    inputs: [IMAGE_IN, { key: 'scale', label: 'Scale', type: 'value', value: 100, min: 1, step: 1, suffix: '%' }],
    outputs: [IMAGE_OUT], properties: [],
  },
  blur: {
    kind: 'blur', label: 'Blur', category: 'Filter', color: '#8f88d8',
    inputs: [IMAGE_IN, { key: 'radius', label: 'Radius', type: 'value', value: 12, min: 0, max: 200, step: 1 }],
    outputs: [IMAGE_OUT], properties: [],
  },
  glow: {
    kind: 'glow', label: 'Glow', category: 'Filter', color: '#8f88d8',
    inputs: [
      IMAGE_IN,
      { key: 'threshold', label: 'Threshold', type: 'value', value: 62, min: 0, max: 100, step: 1, suffix: '%' },
      { key: 'radius', label: 'Radius', type: 'value', value: 28, min: 0, max: 200, step: 1 },
      { key: 'intensity', label: 'Intensity', type: 'value', value: 1.45, min: 0, max: 8, step: .05 },
    ],
    outputs: [IMAGE_OUT], properties: [],
  },
  vignette: {
    kind: 'vignette', label: 'Vignette', category: 'Filter', color: '#8f88d8',
    inputs: [
      IMAGE_IN,
      { key: 'amount', label: 'Amount', type: 'value', value: 34, min: 0, max: 100, step: 1, suffix: '%' },
      { key: 'softness', label: 'Softness', type: 'value', value: 72, min: 0, max: 100, step: 1, suffix: '%' },
    ],
    outputs: [IMAGE_OUT], properties: [],
  },
  invert: {
    kind: 'invert', label: 'Invert', category: 'Color', color: '#c07d9a',
    inputs: [IMAGE_IN, { key: 'fac', label: 'Fac', type: 'value', value: 1, min: 0, max: 1, step: .05 }],
    outputs: [IMAGE_OUT], properties: [],
  },
  colorMatrix: {
    kind: 'colorMatrix', label: 'Color Matrix', category: 'Color', color: '#c07d9a',
    inputs: [
      IMAGE_IN,
      { key: 'temperature', label: 'Temp', type: 'value', value: 0, min: -100, max: 100, step: 1 },
      { key: 'contrast', label: 'Contrast', type: 'value', value: 1, min: 0, max: 4, step: .01 },
    ],
    outputs: [IMAGE_OUT], properties: [],
  },
  hueSaturation: {
    kind: 'hueSaturation', label: 'Hue / Saturation', category: 'Color', color: '#c07d9a',
    inputs: [
      IMAGE_IN,
      { key: 'hue', label: 'Hue', type: 'value', value: 0, min: -180, max: 180, step: 1, suffix: '°' },
      { key: 'saturation', label: 'Sat', type: 'value', value: 1, min: 0, max: 4, step: .05 },
    ],
    outputs: [IMAGE_OUT], properties: [],
  },
  rgbToBw: {
    kind: 'rgbToBw', label: 'RGB to BW', category: 'Converter', color: '#7a8494',
    inputs: [IMAGE_IN, { key: 'fac', label: 'Fac', type: 'value', value: 1, min: 0, max: 1, step: .05 }],
    outputs: [IMAGE_OUT], properties: [],
  },
  brightnessContrast: {
    kind: 'brightnessContrast', label: 'Bright / Contrast', category: 'Color', color: '#c07d9a',
    inputs: [
      IMAGE_IN,
      { key: 'brightness', label: 'Bright', type: 'value', value: 0, min: -100, max: 100, step: 1 },
      { key: 'contrast', label: 'Contrast', type: 'value', value: 0, min: -100, max: 100, step: 1 },
    ],
    outputs: [IMAGE_OUT], properties: [],
  },
  mix: {
    kind: 'mix', label: 'Mix', category: 'Composite', color: '#609a86',
    inputs: [
      { key: 'fac', label: 'Fac', type: 'value', value: 1, min: 0, max: 1, step: .05 },
      { key: 'a', label: 'A', type: 'image' },
      { key: 'b', label: 'B', type: 'image' },
    ],
    outputs: [IMAGE_OUT],
    properties: [{ key: 'blend', label: 'Blend', value: 'normal', options: BLEND_MODES }],
  },
  stack: {
    kind: 'stack', label: 'Stack', category: 'Composite', color: '#609a86',
    inputs: [{ key: 'in', label: 'Input 1', type: 'image' }, { key: 'in', label: 'Input 2', type: 'image' }],
    outputs: [IMAGE_OUT], properties: [], dynamicInputs: true,
  },
  math: {
    kind: 'math', label: 'Math', category: 'Converter', color: '#7a8494',
    inputs: [
      { key: 'a', label: 'A', type: 'value', value: 0, step: .1 },
      { key: 'b', label: 'B', type: 'value', value: 0, step: .1 },
    ],
    outputs: [{ key: 'value', label: 'Value', type: 'value' }],
    properties: [{ key: 'operation', label: 'Operation', value: 'add', options: MATH_OPERATIONS }],
  },
  output: {
    kind: 'output', label: 'Composite', category: 'Output', color: '#b36d6d',
    inputs: [IMAGE_IN], outputs: [], properties: [],
  },
  viewer: {
    kind: 'viewer', label: 'Viewer', category: 'Output', color: '#b3946d',
    inputs: [IMAGE_IN], outputs: [], properties: [],
  },
}

export const NODE_KINDS = Object.keys(NODE_DEFINITIONS) as EditorNodeKind[]
export const NODE_CATEGORIES = ['Input', 'Distort', 'Filter', 'Color', 'Composite', 'Converter', 'Output'] as const

export const isSourceKind = (kind: EditorNodeKind) => Boolean(NODE_DEFINITIONS[kind].sourceLayerTypes?.length)

export function socketMeta(kind: EditorNodeKind, side: 'input' | 'output', index: number): SocketDefinition | undefined {
  const definition = NODE_DEFINITIONS[kind]
  return (side === 'input' ? definition.inputs : definition.outputs)[index]
    ?? (side === 'input' && definition.dynamicInputs ? definition.inputs[0] : undefined)
}

const makeSockets = (definitions: SocketDefinition[], prefix: string): EditorNodeSocket[] =>
  definitions.map((definition, index) => ({
    id: `${prefix}-${definition.key}-${index}`,
    label: definition.label,
    type: definition.type,
    ...(definition.value === undefined ? {} : { value: definition.value }),
  }))

export function createNode(kind: EditorNodeKind, x: number, y: number, id: string = crypto.randomUUID()): EditorNode {
  const definition = NODE_DEFINITIONS[kind]
  return {
    id,
    kind,
    title: definition.label,
    x: Math.round(x),
    y: Math.round(y),
    muted: false,
    properties: Object.fromEntries(definition.properties.map((property) => [property.key, property.value])),
    inputs: makeSockets(definition.inputs, `${id}-in`),
    outputs: makeSockets(definition.outputs, `${id}-out`),
  }
}

/** Rows run outputs, then dropdowns, then inputs — the order Blender draws them in. */
export function nodeRows(node: EditorNode) {
  // A source node's layer picker occupies the same band as a node's dropdowns.
  const properties = NODE_DEFINITIONS[node.kind].properties.length + (isSourceKind(node.kind) ? 1 : 0)
  return {
    outputs: node.outputs.length,
    properties,
    inputs: node.inputs.length,
    total: node.outputs.length + properties + node.inputs.length,
  }
}

export function nodeHeight(node: EditorNode) {
  return NODE_HEADER_HEIGHT + nodeRows(node).total * NODE_ROW_HEIGHT + NODE_BODY_PADDING * 2
}

export function socketOffsetY(node: EditorNode, socketId: string, side: 'input' | 'output') {
  const rows = nodeRows(node)
  const index = (side === 'input' ? node.inputs : node.outputs).findIndex((socket) => socket.id === socketId)
  if (index < 0) return null
  const row = side === 'output' ? index : rows.outputs + rows.properties + index
  return NODE_HEADER_HEIGHT + NODE_BODY_PADDING + row * NODE_ROW_HEIGHT + NODE_ROW_HEIGHT / 2
}

export function socketPosition(node: EditorNode, socketId: string, side: 'input' | 'output') {
  const offsetY = socketOffsetY(node, socketId, side)
  if (offsetY === null) return null
  return { x: node.x + (side === 'input' ? 0 : NODE_WIDTH), y: node.y + offsetY }
}

/** Horizontal S-curve between two graph-space points, with the handle scaled to the gap. */
export function connectionPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const handle = Math.max(28, Math.min(140, Math.abs(to.x - from.x) * .55))
  return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y} ${to.x - handle} ${to.y} ${to.x} ${to.y}`
}

/**
 * Stack keeps exactly one free input at the bottom, growing as links arrive and shrinking as they
 * go, so it can pile up any number of streams without asking for a count up front.
 */
export function syncDynamicInputs(node: EditorNode, connections: EditorNodeConnection[]) {
  if (!NODE_DEFINITIONS[node.kind].dynamicInputs) return false
  const used = new Set(connections.filter((connection) => connection.toNodeId === node.id).map((connection) => connection.toPortId))
  const connected = node.inputs.filter((socket) => used.has(socket.id))
  // Reuse a free socket as the spare when there is one, so socket ids stay stable across edits.
  const spare = node.inputs.find((socket) => !used.has(socket.id))
    ?? { id: `${node.id}-in-in-${crypto.randomUUID().slice(0, 8)}`, label: '', type: 'image' as const }
  const inputs = [...connected, spare].map((socket, index) => ({ ...socket, label: `Input ${index + 1}` }))
  const unchanged = inputs.length === node.inputs.length
    && inputs.every((socket, index) => socket.id === node.inputs[index]!.id && socket.label === node.inputs[index]!.label)
  if (unchanged) return false
  node.inputs = inputs
  return true
}

function upstreamNodeIds(nodeId: string, connections: EditorNodeConnection[], seen = new Set<string>()) {
  connections
    .filter((connection) => connection.toNodeId === nodeId)
    .forEach((connection) => {
      if (seen.has(connection.fromNodeId)) return
      seen.add(connection.fromNodeId)
      upstreamNodeIds(connection.fromNodeId, connections, seen)
    })
  return seen
}

export interface ConnectionRequest {
  fromNodeId: string
  fromPortId: string
  toNodeId: string
  toPortId: string
}

export function socketById(node: EditorNode, socketId: string, side: 'input' | 'output') {
  return (side === 'input' ? node.inputs : node.outputs).find((socket) => socket.id === socketId)
}

/**
 * A link is valid when the socket types match, it joins an output to an input on another node, is
 * not already there, and does not close a loop — a cycle would make evaluation order undefined.
 */
export function canConnect(nodes: EditorNode[], connections: EditorNodeConnection[], request: ConnectionRequest) {
  if (request.fromNodeId === request.toNodeId) return false
  const source = nodes.find((node) => node.id === request.fromNodeId)
  const target = nodes.find((node) => node.id === request.toNodeId)
  if (!source || !target) return false
  const from = socketById(source, request.fromPortId, 'output')
  const to = socketById(target, request.toPortId, 'input')
  if (!from || !to || from.type !== to.type) return false
  const duplicate = connections.some((connection) =>
    connection.fromNodeId === request.fromNodeId && connection.fromPortId === request.fromPortId
    && connection.toNodeId === request.toNodeId && connection.toPortId === request.toPortId)
  if (duplicate) return false
  return !upstreamNodeIds(request.fromNodeId, connections).has(request.toNodeId)
}

const kindForLayer = (layer: EditorLayer): EditorNodeKind =>
  layer.type === '3d-scene' ? 'scene3d' : layer.type === 'text' ? 'text' : 'image'

/**
 * Effects already carried on a layer become real nodes in the chain, so the starting graph shows
 * the composite the project actually describes rather than a bare list of sources.
 */
export const LAYER_EFFECT_NODES: Record<string, EditorNodeKind> = {
  'Glow': 'glow',
  'Vignette': 'vignette',
  'Color Matrix': 'colorMatrix',
  'Brightness / Contrast': 'brightnessContrast',
  'Hue / Saturation': 'hueSaturation',
  'Blur': 'blur',
}

/** Defaults matching the values the layer inspector shows for each effect. */
const LAYER_EFFECT_VALUES: Record<string, number[]> = {
  'Glow': [62, 28, 1.45],
  'Vignette': [34, 72],
  'Color Matrix': [-8, 1.12],
  'Brightness / Contrast': [4, 12],
}

function effectChainFor(layer: EditorLayer, x: number, y: number) {
  const nodes: EditorNode[] = []
  layer.effects.forEach((effect) => {
    const kind = LAYER_EFFECT_NODES[effect]
    if (!kind) return
    const node = createNode(kind, x + nodes.length * 190, y, `node-effect-${layer.id}-${nodes.length}`)
    LAYER_EFFECT_VALUES[effect]?.forEach((value, index) => {
      const socket = node.inputs[index + 1]
      if (socket) socket.value = value
    })
    nodes.push(node)
  })
  return nodes
}

/**
 * The starting graph mirrors the layer stack exactly — one bound source per visible layer, piled
 * bottom-first into a Stack — so turning the graph into the render path changes nothing on screen
 * until the user rewires it.
 */
export function createDemoNodeGraph(layers: EditorLayer[] = []): { nodes: EditorNode[]; connections: EditorNodeConnection[] } {
  const stackOrder = [...layers.filter((layer) => !layer.isPlaceholder && layer.type !== 'audio')].reverse()
  const nodes: EditorNode[] = []
  const connections: EditorNodeConnection[] = []
  const connect = (from: EditorNode, to: EditorNode, socketIndex: number) => {
    connections.push({
      id: `link-${from.id}-${to.id}-${socketIndex}`,
      fromNodeId: from.id,
      fromPortId: from.outputs[0]!.id,
      toNodeId: to.id,
      toPortId: to.inputs[socketIndex]!.id,
    })
  }

  // Each layer becomes a source followed by its own effect chain, exactly as the layer describes it.
  const branches = stackOrder.map((layer, index) => {
    const row = 40 + index * 132
    const source = createNode(kindForLayer(layer), 40, row, `node-source-${layer.id}`)
    source.sourceId = layer.id
    source.title = layer.name
    nodes.push(source)

    const chain = effectChainFor(layer, 240, row)
    nodes.push(...chain)
    let tail = source
    chain.forEach((effect) => {
      connect(tail, effect, 0)
      tail = effect
    })
    return tail
  })

  const chainColumn = 240 + Math.max(...[1, ...stackOrder.map((layer) => layer.effects.filter((effect) => LAYER_EFFECT_NODES[effect]).length)]) * 190

  // Mixes chain bottom-up, the way Blender combines more than two streams.
  let composite = branches[0] ?? null
  branches.slice(1).forEach((branch, index) => {
    const mix = createNode('mix', chainColumn + index * 180, 60 + index * 118, `node-mix-${index}`)
    nodes.push(mix)
    if (composite) connect(composite, mix, 1)
    connect(branch, mix, 2)
    composite = mix
  })

  const output = createNode('output', chainColumn + Math.max(1, branches.length - 1) * 180, 90, 'node-output')
  nodes.push(output)
  if (composite) connect(composite, output, 0)
  return { nodes, connections }
}
