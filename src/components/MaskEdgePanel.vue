<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { ImageOff, ScanLine } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { shapeOutline } from '@/engine/shapes/shapeGeometry'
import type { EditorLayer, EditorNode } from '@/models/editor'
import MaskEdgePainter from './MaskEdgePainter.vue'
import PanelHeader from './common/PanelHeader.vue'

const store = useEditorStore()
const { nodes, nodeConnections, layers, selectedNodeId, currentTime } = storeToRefs(store)
const selectedMask = computed(() => nodes.value.find((node) => node.id === selectedNodeId.value && node.kind === 'mask') ?? null)

function upstreamSource(nodeId: string, visited = new Set<string>()): EditorNode | null {
  if (visited.has(nodeId)) return null
  visited.add(nodeId)
  const node = nodes.value.find((item) => item.id === nodeId)
  if (!node) return null
  if (node.sourceId) return node
  for (const input of node.inputs.filter((socket) => socket.type === 'image')) {
    const link = nodeConnections.value.find((connection) => connection.toNodeId === node.id && connection.toPortId === input.id)
    if (!link) continue
    const source = upstreamSource(link.fromNodeId, visited)
    if (source) return source
  }
  return null
}

const maskShape = computed<EditorLayer | null>(() => {
  const mask = selectedMask.value
  const socket = mask?.inputs.filter((input) => input.type === 'image')[1]
  const link = socket ? nodeConnections.value.find((connection) => connection.toNodeId === mask!.id && connection.toPortId === socket.id) : null
  const source = link ? upstreamSource(link.fromNodeId) : null
  return layers.value.find((layer) => layer.id === source?.sourceId && layer.type === 'shape') ?? null
})

/**
 * A centred feather reaches half its width outside the shape, so past twice the shape's own half-width
 * it stops masking and starts washing the layer's rectangle over the frame. The renderer clamps there;
 * the slider stops at the same place so the last part of its travel is not dead.
 */
const featherMax = computed(() => {
  const shape = maskShape.value
  const outline = shape ? shapeOutline(shape, 8) : null
  if (!shape || !outline?.points.length) return 400
  const xs = outline.points.map((point) => point[0])
  const ys = outline.points.map((point) => point[1])
  const spanX = (Math.max(...xs) - Math.min(...xs)) * evaluateNumericProperty(shape.transform.scaleX, currentTime.value) / 100
  const spanY = (Math.max(...ys) - Math.min(...ys)) * evaluateNumericProperty(shape.transform.scaleY, currentTime.value) / 100
  return Math.max(4, Math.round(Math.min(Math.abs(spanX), Math.abs(spanY))))
})

/** The Feather socket sets how wide a feathered stretch of the edge fades; painting only picks where it applies. */
const featherSocket = computed(() => selectedMask.value?.inputs[2] ?? null)
const featherLinked = computed(() => Boolean(featherSocket.value
  && nodeConnections.value.some((connection) => connection.toNodeId === selectedMask.value?.id && connection.toPortId === featherSocket.value?.id)))
const featherValue = computed(() => Math.round(featherSocket.value?.value ?? 0))

function setFeather(value: number) {
  const mask = selectedMask.value
  const socket = featherSocket.value
  if (!mask || !socket || featherLinked.value) return
  store.setNodeSocketValue(mask.id, socket.id, Math.max(0, Math.min(featherMax.value, value)))
}
</script>

<template>
  <section v-if="selectedMask" class="mask-edge-panel" aria-label="Mask edge editor">
    <PanelHeader title="Mask Edge" :subtitle="maskShape?.name ?? 'No shape connected'">
      <template #icon><ScanLine :size="12" /></template>
    </PanelHeader>
    <div v-if="maskShape" class="mask-editor-body">
      <div class="mask-source"><span>{{ maskShape.name }}</span><small>{{ maskShape.shapeKind === 'path' ? maskShape.shapePath?.closed ? 'Closed Bézier path' : 'Open Bézier path' : maskShape.shapeKind }}</small></div>
      <div class="feather-control" :class="{ linked: featherLinked }">
        <label for="mask-feather-amount">Feather</label>
        <input id="mask-feather-amount" :value="Math.min(featherValue, featherMax)" type="range" min="0" :max="featherMax" step="1" :disabled="featherLinked" :title="featherLinked ? 'Driven by an upstream link' : `Width of the feathered fade, in project pixels. Capped at ${featherMax} px by the shape's own size.`" @input="setFeather(Number(($event.target as HTMLInputElement).value))" />
        <span>{{ featherLinked ? 'linked' : `${Math.min(featherValue, featherMax)} px` }}</span>
      </div>
      <MaskEdgePainter :model-value="selectedMask.maskEdgeFeather ?? Array.from({ length: 32 }, () => 1)" :shape="maskShape" @update:model-value="store.setNodeMaskEdgeFeather(selectedMask.id, $event)" />
    </div>
    <div v-else class="mask-empty"><ImageOff :size="15" /><span>Connect a shape layer to the Shape socket.</span></div>
  </section>
</template>

<style scoped>
.mask-edge-panel { display: flex; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); border-top: 1px solid #30343c; }.mask-editor-body { min-height: 0; padding: 5px 7px 6px; overflow: auto; }.mask-source { display: flex; height: 20px; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }.mask-source span { overflow: hidden; color: var(--text-secondary); font-size: 8px; font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }.mask-source small { flex: 0 0 auto; color: var(--text-muted); font-size: 6.5px; text-transform: capitalize; }
.feather-control { display: flex; height: 20px; align-items: center; gap: 6px; margin-bottom: 3px; color: var(--text-muted); font-size: 7px; }.feather-control label { flex: 0 0 auto; }.feather-control input { min-width: 0; flex: 1; accent-color: var(--focus); }.feather-control span { width: 34px; flex: 0 0 auto; color: var(--text-secondary); font-variant-numeric: tabular-nums; text-align: right; }.feather-control.linked { opacity: .55; }.mask-empty { display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; gap: 6px; padding: 12px; color: var(--text-muted); font-size: 8px; text-align: center; }.mask-empty svg { color: #727da9; }
</style>
