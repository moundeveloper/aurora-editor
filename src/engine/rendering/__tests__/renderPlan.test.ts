import { describe, expect, it } from 'vitest'
import { createRenderPlan, type RenderFrameRequest } from '@/engine/rendering/contracts'
import { NEUTRAL_EFFECTS } from '@/engine/nodes/evaluateGraph'
import { createNode } from '@/engine/nodes/nodeGraph'
import type { EditorLayer, EditorNode, EditorNodeConnection } from '@/models/editor'

const channel = (value: number) => ({ value, animated: false, keyframes: [] })

function layer(id: string, start: number, duration: number, type: EditorLayer['type'] = 'video'): EditorLayer {
  return {
    id, name: id, type, start, duration, visible: true, locked: false, track: 0,
    ...(type === 'shape' ? { shapeKind: 'rectangle' as const, shapeWidth: 200, shapeHeight: 120 } : {}),
    transform: { x: channel(640), y: channel(360), scaleX: channel(100), scaleY: channel(100), rotation: channel(0), opacity: channel(100) },
  } as unknown as EditorLayer
}

const link = (from: EditorNode, to: EditorNode, inputIndex: number, id: string): EditorNodeConnection => ({
  id, fromNodeId: from.id, fromPortId: from.outputs[0]!.id, toNodeId: to.id, toPortId: to.inputs[inputIndex]!.id,
})

/** Content runs the whole composition; the mask shape only appears part-way through, as a clip. */
function maskedGraph(invert: 'inside' | 'outside') {
  const content = createNode('image', 0, 0, 'node-content')
  const shape = createNode('image', 0, 0, 'node-shape')
  const mask = createNode('mask', 0, 0, 'node-mask')
  const output = createNode('output', 0, 0, 'node-output')
  content.sourceId = 'layer-content'
  shape.sourceId = 'layer-shape'
  mask.properties.invert = invert
  return {
    nodes: [content, shape, mask, output],
    nodeConnections: [
      link(content, mask, 0, 'content-mask'),
      link(shape, mask, 1, 'shape-mask'),
      link(mask, output, 0, 'mask-output'),
    ],
    layers: [layer('layer-content', 0, 10), layer('layer-shape', 4, 3, 'shape')],
  }
}

function planAt(time: number, invert: 'inside' | 'outside' = 'inside') {
  const graph = maskedGraph(invert)
  const request: RenderFrameRequest = {
    project: { width: 1280, height: 720 } as RenderFrameRequest['project'],
    layers: graph.layers,
    scenes3D: [],
    nodes: graph.nodes,
    nodeConnections: graph.nodeConnections,
    renderRootNodeId: 'node-output',
    time,
    width: 1280,
    height: 720,
    quality: 'preview',
  }
  return createRenderPlan(request)
}

describe('render plan masking over time', () => {
  it('masks the layer while the mask shape is on the timeline', () => {
    const plan = planAt(5)
    expect(plan.passes).toHaveLength(1)
    expect(plan.passes[0]!.layerId).toBe('layer-content')
    expect(plan.passes[0]!.effects.mask?.layerId).toBe('layer-shape')
  })

  it('drops the masked layer before its mask shape starts', () => {
    expect(planAt(2).passes).toHaveLength(0)
  })

  it('drops the masked layer again once its mask shape ends', () => {
    expect(planAt(8).passes).toHaveLength(0)
  })

  it('keeps an inverted mask fully visible while its shape is absent', () => {
    const plan = planAt(2, 'outside')
    expect(plan.passes).toHaveLength(1)
    expect(plan.passes[0]!.effects.mask).toBeNull()
  })

  it('drops the masked layer when the mask shape is hidden rather than out of range', () => {
    const graph = maskedGraph('inside')
    graph.layers[1]!.visible = false
    const plan = createRenderPlan({
      project: { width: 1280, height: 720 } as RenderFrameRequest['project'],
      layers: graph.layers,
      scenes3D: [],
      nodes: graph.nodes,
      nodeConnections: graph.nodeConnections,
      renderRootNodeId: 'node-output',
      time: 5,
      width: 1280,
      height: 720,
      quality: 'preview',
    })
    expect(plan.passes).toHaveLength(0)
  })

  it('leaves unmasked passes alone', () => {
    const content = createNode('image', 0, 0, 'node-content')
    const output = createNode('output', 0, 0, 'node-output')
    content.sourceId = 'layer-content'
    const plan = createRenderPlan({
      project: { width: 1280, height: 720 } as RenderFrameRequest['project'],
      layers: [layer('layer-content', 0, 10)],
      scenes3D: [],
      nodes: [content, output],
      nodeConnections: [link(content, output, 0, 'content-output')],
      renderRootNodeId: 'node-output',
      time: 2,
      width: 1280,
      height: 720,
      quality: 'preview',
    })
    expect(plan.passes).toHaveLength(1)
    expect(plan.passes[0]!.effects).toEqual(NEUTRAL_EFFECTS)
  })
})
