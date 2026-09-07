import { describe, expect, it } from 'vitest'
import {
  canConnect, connectionPath, createDemoNodeGraph, createNode, NODE_KINDS, NODE_WIDTH,
  nodeHeight, socketPosition, syncDynamicInputs,
} from '@/engine/nodes/nodeGraph'
import { contributingNodeIds, evaluateNodeGraph } from '@/engine/nodes/evaluateGraph'
import { createRenderPlan } from '@/engine/rendering/contracts'
import { CURRENT_PROJECT_VERSION, deserializeEditorState } from '@/engine/project/serialization'
import { createDemo3DScene, numericProperty } from '@/engine/scene3d/sceneFactory'
import { createLayerEffect } from '@/engine/nodes/layerEffects'
import type { EditorLayer, EditorNode, EditorNodeConnection, EditorProject, SerializedEditorState } from '@/models/editor'

const project: EditorProject = {
  id: 'graph-project', name: 'Graph', width: 1920, height: 1080, frameRate: 30,
  duration: 18, backgroundColor: '#000000', updatedAt: 0, version: CURRENT_PROJECT_VERSION,
}

function layer(id: string, type: EditorLayer['type']): EditorLayer {
  return {
    id, name: id, type, start: 0, duration: 18, color: '#fff',
    visible: true, locked: false, muted: false, expanded: false, effects: [],
    transform: {
      x: numericProperty(`${id}-x`, 960), y: numericProperty(`${id}-y`, 540),
      scaleX: numericProperty(`${id}-sx`, 100), scaleY: numericProperty(`${id}-sy`, 100),
      rotation: numericProperty(`${id}-r`, 0), opacity: numericProperty(`${id}-o`, 100),
    },
  }
}

const layers: EditorLayer[] = [layer('layer-title', 'text'), layer('layer-video', 'video')]

const fallbackState = (): SerializedEditorState => {
  const graph = createDemoNodeGraph(layers)
  return { project, layers, scenes3D: [createDemo3DScene()], assets: [], nodes: graph.nodes, nodeConnections: graph.connections }
}

const planRequest = (nodes: EditorNode[], connections: EditorNodeConnection[], renderRootNodeId?: string | null) => ({
  project, layers, scenes3D: [createDemo3DScene()], nodes, nodeConnections: connections, renderRootNodeId,
  time: 4, width: 1280, height: 720, quality: 'preview' as const,
})

const link = (from: EditorNode, to: EditorNode, toSocketIndex: number, id = `${from.id}->${to.id}`): EditorNodeConnection => ({
  id, fromNodeId: from.id, fromPortId: from.outputs[0]!.id, toNodeId: to.id, toPortId: to.inputs[toSocketIndex]!.id,
})

describe('node graph', () => {
  it('anchors sockets on the node edges below the header', () => {
    const node = createNode('mix', 100, 50)
    const fac = socketPosition(node, node.inputs[0]!.id, 'input')!
    const out = socketPosition(node, node.outputs[0]!.id, 'output')!
    expect(fac.x).toBe(100)
    expect(out.x).toBe(100 + NODE_WIDTH)
    expect(out.y).toBeLessThan(fac.y)
    expect(fac.y).toBeLessThan(50 + nodeHeight(node))
    expect(socketPosition(node, 'missing', 'input')).toBeNull()
    expect(connectionPath(fac, out)).toMatch(/^M 100 [\d.]+ C /)
  })

  it('only links sockets of the same type', () => {
    const math = createNode('math', 0, 0, 'math')
    const blur = createNode('blur', 0, 0, 'blur')
    const image = createNode('image', 0, 0, 'image')
    const nodes = [math, blur, image]
    // Math outputs a value: it can drive the blur radius but not the blur image input.
    expect(canConnect(nodes, [], { fromNodeId: math.id, fromPortId: math.outputs[0]!.id, toNodeId: blur.id, toPortId: blur.inputs[1]!.id })).toBe(true)
    expect(canConnect(nodes, [], { fromNodeId: math.id, fromPortId: math.outputs[0]!.id, toNodeId: blur.id, toPortId: blur.inputs[0]!.id })).toBe(false)
    expect(canConnect(nodes, [], { fromNodeId: image.id, fromPortId: image.outputs[0]!.id, toNodeId: blur.id, toPortId: blur.inputs[1]!.id })).toBe(false)
    expect(canConnect(nodes, [], { fromNodeId: image.id, fromPortId: image.outputs[0]!.id, toNodeId: blur.id, toPortId: blur.inputs[0]!.id })).toBe(true)
  })

  it('starts from a graph that mirrors the layer stack, bottom layer first', () => {
    const { nodes, connections } = createDemoNodeGraph(layers)
    expect(evaluateNodeGraph(nodes, connections)!.map((pass) => pass.layerId)).toEqual(['layer-video', 'layer-title'])
    const graphPlan = createRenderPlan(planRequest(nodes, connections))
    const stackPlan = createRenderPlan({ ...planRequest(nodes, connections), nodes: [] })
    expect(graphPlan.passes.map((pass) => pass.layerId)).toEqual(stackPlan.passes.map((pass) => pass.layerId))
  })

  it('renders the background branch at frame zero before later layers begin', () => {
    const timedLayers = [
      { ...layer('layer-title', 'text'), start: 2.2, duration: 8.6 },
      layer('layer-video', 'video'),
    ]
    const { nodes, connections } = createDemoNodeGraph(timedLayers)
    const plan = createRenderPlan({
      ...planRequest(nodes, connections),
      layers: timedLayers,
      time: 0,
    })
    expect(plan.passes.map((pass) => pass.layerId)).toEqual(['layer-video'])
  })

  it('evaluates an ordered layer stack independently of authored graph nodes', () => {
    const graded = layer('layer-grade', 'adjustment')
    graded.effects = [
      createLayerEffect('colorMatrix', 'grade-color', { temperature: -8, contrast: 1.12 }),
      createLayerEffect('vignette', 'grade-vignette', { amount: 34, softness: 72 }),
    ]
    const titled = layer('layer-titled', 'text')
    titled.effects = [createLayerEffect('glow', 'title-glow', { threshold: 62, radius: 28, intensity: 1.45 })]
    const { nodes, connections } = createDemoNodeGraph([titled, graded])

    expect(nodes.some((node) => node.id.startsWith('node-effect-'))).toBe(false)
    const passes = createRenderPlan({ ...planRequest(nodes, connections), layers: [titled, graded] }).passes
    const grade = passes.find((pass) => pass.layerId === 'layer-grade')!
    expect(grade.effects.temperature).toBe(-8)
    expect(grade.effects.vignetteAmount).toBe(34)
    // Glow contributes the sharp pass plus an additive bloom copy.
    const titlePasses = passes.filter((pass) => pass.layerId === 'layer-titled')
    expect(titlePasses).toHaveLength(2)
    expect(titlePasses[1]!.blendMode).toBe('add')
    expect(titlePasses[1]!.effects.blur).toBe(28)
  })

  it('skips disabled layer effects and applies reordered parameter values', () => {
    const effected = layer('layer-effected', 'image')
    effected.effects = [
      { ...createLayerEffect('blur', 'blur', { radius: 12 }), enabled: false },
      createLayerEffect('brightnessContrast', 'grade', { brightness: 7, contrast: 18 }),
    ]
    const plan = createRenderPlan({ ...planRequest([], []), layers: [effected], nodes: [] })
    expect(plan.passes[0]!.effects).toMatchObject({ blur: 0, brightness: 7, contrast: 18 })
  })

  it('combines branches with chained Mix nodes rather than one catch-all input list', () => {
    const three = [layer('a', 'video'), layer('b', 'image'), layer('c', 'text')]
    const { nodes, connections } = createDemoNodeGraph(three)
    expect(nodes.filter((node) => node.kind === 'mix')).toHaveLength(2)
    expect(nodes.some((node) => node.kind === 'stack')).toBe(false)
    expect(evaluateNodeGraph(nodes, connections)!.map((pass) => pass.layerId)).toEqual(['c', 'b', 'a'])
  })

  it('renders only what reaches the root, and nothing when the root is cut off', () => {
    const { nodes, connections } = createDemoNodeGraph(layers)
    const withoutTitle = connections.filter((connection) => connection.fromNodeId !== 'node-source-layer-title')
    expect(evaluateNodeGraph(nodes, withoutTitle)!.map((pass) => pass.layerId)).toEqual(['layer-video'])
    const cut = connections.filter((connection) => connection.toNodeId !== 'node-output')
    expect(evaluateNodeGraph(nodes, cut)).toEqual([])
    expect(createRenderPlan(planRequest(nodes, cut)).passes).toEqual([])
  })

  it('falls back to the layer stack only when there is no render root at all', () => {
    const { nodes, connections } = createDemoNodeGraph(layers)
    const headless = nodes.filter((node) => node.kind !== 'output')
    expect(evaluateNodeGraph(headless, connections)).toBeNull()
    expect(createRenderPlan(planRequest(headless, connections)).passes.map((pass) => pass.layerId))
      .toEqual(['layer-video', 'layer-title'])
  })

  it('lets a Viewer node take over the frame', () => {
    const { nodes, connections } = createDemoNodeGraph(layers)
    const video = nodes.find((node) => node.id === 'node-source-layer-video')!
    const viewer = createNode('viewer', 0, 0, 'viewer')
    const rewired = [...connections, link(video, viewer, 0, 'v-viewer')]
    expect(evaluateNodeGraph([...nodes, viewer], rewired, 'viewer')!.map((pass) => pass.layerId)).toEqual(['layer-video'])
    expect(createRenderPlan(planRequest([...nodes, viewer], rewired, 'viewer')).passes.map((pass) => pass.layerId)).toEqual(['layer-video'])
  })

  it('mixes two branches with a blend mode and a factor as the foreground alpha', () => {
    const video = createNode('image', 0, 0, 'video')
    const title = createNode('text', 0, 0, 'title')
    video.sourceId = 'layer-video'
    title.sourceId = 'layer-title'
    const mix = createNode('mix', 0, 0, 'mix')
    const output = createNode('output', 0, 0, 'out')
    mix.properties.blend = 'screen'
    mix.inputs[0]!.value = .4
    const nodes = [video, title, mix, output]
    const connections = [link(video, mix, 1, 'a'), link(title, mix, 2, 'b'), link(mix, output, 0, 'o')]

    const passes = evaluateNodeGraph(nodes, connections)!
    expect(passes.map((pass) => pass.layerId)).toEqual(['layer-video', 'layer-title'])
    expect(passes[0]!.blendMode).toBe('normal')
    expect(passes[0]!.effects.opacity).toBe(1)
    expect(passes[1]!.blendMode).toBe('screen')
    expect(passes[1]!.effects.opacity).toBeCloseTo(.4)
  })

  it('composes distort, blur and colour nodes down a chain', () => {
    const video = createNode('image', 0, 0, 'video')
    video.sourceId = 'layer-video'
    const translate = createNode('translate', 0, 0, 'translate')
    const rotate = createNode('rotate', 0, 0, 'rotate')
    const scale = createNode('scale', 0, 0, 'scale')
    const blur = createNode('blur', 0, 0, 'blur')
    const bc = createNode('brightnessContrast', 0, 0, 'bc')
    const output = createNode('output', 0, 0, 'out')
    translate.inputs[1]!.value = 40
    translate.inputs[2]!.value = -15
    rotate.inputs[1]!.value = 30
    scale.inputs[1]!.value = 50
    blur.inputs[1]!.value = 18
    bc.inputs[1]!.value = 20
    bc.inputs[2]!.value = -10

    const nodes = [video, translate, rotate, scale, blur, bc, output]
    const connections = [
      link(video, translate, 0, 'a'), link(translate, rotate, 0, 'b'), link(rotate, scale, 0, 'c'),
      link(scale, blur, 0, 'd'), link(blur, bc, 0, 'e'), link(bc, output, 0, 'f'),
    ]
    const pass = evaluateNodeGraph(nodes, connections)![0]!
    expect(pass.effects).toMatchObject({ offsetX: 40, offsetY: -15, rotation: 30, blur: 18, brightness: 20, contrast: -10 })
    expect(pass.effects.scale).toBeCloseTo(.5)
    expect(createRenderPlan(planRequest(nodes, connections)).passes[0]!.effects.blur).toBe(18)
  })

  it('drives a value socket from a Math node instead of its inline default', () => {
    const video = createNode('image', 0, 0, 'video')
    video.sourceId = 'layer-video'
    const blur = createNode('blur', 0, 0, 'blur')
    const math = createNode('math', 0, 0, 'math')
    const output = createNode('output', 0, 0, 'out')
    blur.inputs[1]!.value = 3
    math.properties.operation = 'multiply'
    math.inputs[0]!.value = 6
    math.inputs[1]!.value = 7

    const nodes = [video, blur, math, output]
    const base = [link(video, blur, 0, 'a'), link(blur, output, 0, 'b')]
    expect(evaluateNodeGraph(nodes, base)![0]!.effects.blur).toBe(3)

    const driven = [...base, { id: 'm', fromNodeId: math.id, fromPortId: math.outputs[0]!.id, toNodeId: blur.id, toPortId: blur.inputs[1]!.id }]
    expect(evaluateNodeGraph(nodes, driven)![0]!.effects.blur).toBe(42)
  })

  it('passes a muted node straight through', () => {
    const video = createNode('image', 0, 0, 'video')
    video.sourceId = 'layer-video'
    const blur = createNode('blur', 0, 0, 'blur')
    const output = createNode('output', 0, 0, 'out')
    blur.inputs[1]!.value = 25
    const nodes = [video, blur, output]
    const connections = [link(video, blur, 0, 'a'), link(blur, output, 0, 'b')]
    expect(evaluateNodeGraph(nodes, connections)![0]!.effects.blur).toBe(25)
    blur.muted = true
    const muted = evaluateNodeGraph(nodes, connections)!
    expect(muted).toHaveLength(1)
    expect(muted[0]!.effects.blur).toBe(0)
  })

  it('uses a shape branch as a mask without rendering that branch', () => {
    const content = createNode('image', 0, 0, 'content')
    const shape = createNode('image', 0, 0, 'shape')
    const mask = createNode('mask', 0, 0, 'mask')
    const output = createNode('output', 0, 0, 'out')
    content.sourceId = 'layer-video'
    shape.sourceId = 'layer-title'
    mask.inputs[2]!.value = 36
    mask.properties.invert = 'outside'
    mask.maskSegmentFeather = [0, 40, 0, 18]
    const nodes = [content, shape, mask, output]
    const connections = [
      link(content, mask, 0, 'content-mask'),
      link(shape, mask, 1, 'shape-mask'),
      link(mask, output, 0, 'mask-output'),
    ]

    const passes = evaluateNodeGraph(nodes, connections)!
    expect(passes).toHaveLength(1)
    expect(passes[0]!.layerId).toBe('layer-video')
    expect(passes[0]!.effects.mask).toEqual({
      layerId: 'layer-title', feather: 36, inverted: true, segmentFeather: [0, 40, 0, 18],
    })
  })

  it('keeps one free Stack input as links arrive and go', () => {
    const stack = createNode('stack', 0, 0, 'stack')
    const source = createNode('image', 0, 0, 'source')
    expect(stack.inputs).toHaveLength(2)

    const first = link(source, stack, 0, 'l1')
    expect(syncDynamicInputs(stack, [first])).toBe(false)

    const second = link(source, stack, 1, 'l2')
    syncDynamicInputs(stack, [first, second])
    expect(stack.inputs).toHaveLength(3)
    expect(stack.inputs.map((socket) => socket.label)).toEqual(['Input 1', 'Input 2', 'Input 3'])

    syncDynamicInputs(stack, [first])
    expect(stack.inputs).toHaveLength(2)
  })

  it('rejects self links, duplicates, and cycles', () => {
    const { nodes, connections } = createDemoNodeGraph(layers)
    const video = nodes.find((node) => node.id === 'node-source-layer-video')!
    const mix = nodes.find((node) => node.kind === 'mix')!
    const output = nodes.find((node) => node.kind === 'output')!
    const usedPort = connections.find((connection) => connection.fromNodeId === video.id)!.toPortId

    expect(canConnect(nodes, connections, { fromNodeId: video.id, fromPortId: video.outputs[0]!.id, toNodeId: video.id, toPortId: 'x' })).toBe(false)
    expect(canConnect(nodes, connections, { fromNodeId: video.id, fromPortId: video.outputs[0]!.id, toNodeId: mix.id, toPortId: usedPort })).toBe(false)
    expect(canConnect(nodes, connections, { fromNodeId: output.id, fromPortId: 'any', toNodeId: mix.id, toPortId: mix.inputs[2]!.id })).toBe(false)
    // The other Mix image input is free and takes an image, so this one is allowed.
    expect(canConnect(nodes, connections, { fromNodeId: video.id, fromPortId: video.outputs[0]!.id, toNodeId: mix.id, toPortId: mix.inputs[2]!.id })).toBe(true)
  })

  it('reports which nodes reach the root so the workspace can mark the rest', () => {
    const { nodes, connections } = createDemoNodeGraph(layers)
    const orphan = createNode('blur', 0, 0, 'orphan')
    const reached = contributingNodeIds([...nodes, orphan], connections)
    expect(reached.has('node-output')).toBe(true)
    expect(reached.has('node-source-layer-video')).toBe(true)
    expect(reached.has('orphan')).toBe(false)
  })

  it('gives every registered kind usable sockets', () => {
    NODE_KINDS.forEach((kind) => {
      const node = createNode(kind, 0, 0)
      if (kind === 'backdrop') expect(node.inputs.length + node.outputs.length).toBe(0)
      else expect(node.inputs.length + node.outputs.length).toBeGreaterThan(0)
      expect(nodeHeight(node)).toBeGreaterThan(30)
      node.outputs.forEach((socket) => expect(socketPosition(node, socket.id, 'output')).not.toBeNull())
    })
  })

  it('restores a saved graph and keeps node positions and socket values', () => {
    const graph = createDemoNodeGraph(layers)
    graph.nodes[0]!.x = 512
    const raw = JSON.stringify({ project, layers, scenes3D: [createDemo3DScene()], assets: [], nodes: graph.nodes, nodeConnections: graph.connections })
    const restored = deserializeEditorState(raw, fallbackState())
    expect(restored.nodes[0]?.x).toBe(512)
    expect(restored.nodeConnections).toHaveLength(graph.connections.length)
  })

  it('rebuilds graphs saved before typed sockets existed', () => {
    const legacy = [{ id: 'node-media', kind: 'input', title: 'Media', x: 0, y: 0, parameters: {}, inputs: [], outputs: [{ id: 'o', label: 'Image' }] }]
    const raw = JSON.stringify({ project, layers, scenes3D: [createDemo3DScene()], assets: [], nodes: legacy, nodeConnections: [] })
    const restored = deserializeEditorState(raw, fallbackState())
    expect(restored.nodes.some((node) => node.sourceId === 'layer-video')).toBe(true)
    expect(evaluateNodeGraph(restored.nodes, restored.nodeConnections)).toHaveLength(layers.length)
  })

  it('drops links that point at a node or socket that no longer exists', () => {
    const graph = createDemoNodeGraph(layers)
    const kept = graph.connections.length - 1
    const raw = JSON.stringify({
      project, layers, scenes3D: [createDemo3DScene()], assets: [], nodes: graph.nodes,
      nodeConnections: [
        ...graph.connections.slice(0, kept),
        { id: 'dangling', fromNodeId: 'ghost', fromPortId: 'a', toNodeId: 'node-stack', toPortId: 'b' },
        { id: 'bad-socket', fromNodeId: 'node-source-layer-video', fromPortId: 'missing', toNodeId: 'node-stack', toPortId: 'missing' },
      ],
    })
    expect(deserializeEditorState(raw, fallbackState()).nodeConnections).toHaveLength(kept)
  })
})
