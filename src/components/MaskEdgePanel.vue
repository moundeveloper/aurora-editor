<script setup lang="ts">
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ImageOff, ScanLine } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { shapeSegmentCount } from '@/engine/shapes/shapeGeometry'
import type { EditorLayer, EditorNode } from '@/models/editor'
import MaskEdgePainter from './MaskEdgePainter.vue'
import PanelHeader from './common/PanelHeader.vue'

const store = useEditorStore()
const { nodes, nodeConnections, layers, selectedNodeId, selectedMaskSegment } = storeToRefs(store)
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

const segmentCount = computed(() => (maskShape.value ? shapeSegmentCount(maskShape.value) : 0))
const segmentFeather = computed(() => selectedMask.value?.maskSegmentFeather ?? [])
const activeSegment = computed(() => {
  const segment = selectedMaskSegment.value
  return segment !== null && segment >= 0 && segment < segmentCount.value ? segment : null
})
const activeFeather = computed(() => (activeSegment.value === null ? 0 : Math.round(segmentFeather.value[activeSegment.value] ?? 0)))
const featherMax = computed(() => Math.max(20, Math.round(Math.min(maskShape.value?.shapeWidth ?? 280, maskShape.value?.shapeHeight ?? 180) / 2)))
const hardCount = computed(() => segmentFeather.value.slice(0, segmentCount.value).filter((value) => (value ?? 0) < .5).length)

/** The segment list belongs to the shape, so it is resized whenever the connected shape changes. */
watch([selectedMask, segmentCount], () => {
  if (selectedMask.value && segmentCount.value) store.ensureMaskSegments(selectedMask.value.id, segmentCount.value)
  if (selectedMaskSegment.value !== null && selectedMaskSegment.value >= segmentCount.value) selectedMaskSegment.value = null
}, { immediate: true })

function setFeather(value: number) {
  if (!selectedMask.value || activeSegment.value === null) return
  store.setMaskSegmentFeather(selectedMask.value.id, activeSegment.value, value)
}

function onSegmentFeather(segment: number, value: number) {
  if (selectedMask.value) store.setMaskSegmentFeather(selectedMask.value.id, segment, value)
}

function applyToAll(value: number) {
  if (selectedMask.value) store.setMaskSegmentFeatherAll(selectedMask.value.id, value)
}
</script>

<template>
  <section v-if="selectedMask" class="mask-edge-panel" aria-label="Mask edge editor">
    <PanelHeader title="Mask Edge" :subtitle="maskShape?.name ?? 'No shape connected'">
      <template #icon><ScanLine :size="12" /></template>
    </PanelHeader>
    <div v-if="maskShape" class="mask-editor-body">
      <div class="mask-source">
        <span>{{ maskShape.name }}</span>
        <small>{{ segmentCount }} {{ segmentCount === 1 ? 'segment' : 'segments' }} · {{ hardCount }} hard</small>
      </div>

      <MaskEdgePainter
        :shape="maskShape"
        :segment-feather="segmentFeather"
        :selected="activeSegment"
        @update:selected="selectedMaskSegment = $event"
        @feather="onSegmentFeather"
      />

      <div v-if="activeSegment !== null" class="segment-editor">
        <div class="segment-title"><strong>Segment {{ activeSegment + 1 }}</strong><small>{{ activeFeather ? 'Feathered' : 'Hard edge' }}</small></div>
        <div class="feather-control">
          <label :for="`segment-feather-${activeSegment}`">Feather</label>
          <input
            :id="`segment-feather-${activeSegment}`"
            :value="Math.min(activeFeather, featherMax)"
            type="range"
            min="0"
            :max="featherMax"
            step="1"
            title="Feather width for this segment, in project pixels. Zero is a hard cut."
            @input="setFeather(Number(($event.target as HTMLInputElement).value))"
          />
          <input
            class="feather-number"
            :value="activeFeather"
            type="number"
            min="0"
            step="1"
            aria-label="Feather width in pixels"
            @change="setFeather(Number(($event.target as HTMLInputElement).value))"
          />
          <span>px</span>
        </div>
        <div class="segment-actions">
          <button type="button" title="Make this segment a hard cut" @click="setFeather(0)">Hard</button>
          <button type="button" title="Give every segment this segment's feather" @click="applyToAll(activeFeather)">Apply to all</button>
          <button type="button" title="Make every segment a hard cut" @click="applyToAll(0)">Clear all</button>
        </div>
      </div>
      <p v-else class="segment-empty">Select a segment to set its feather.</p>
    </div>
    <div v-else class="mask-empty"><ImageOff :size="15" /><span>Connect a shape layer to the Shape socket.</span></div>
  </section>
</template>

<style scoped>
.mask-edge-panel { display: flex; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); border-top: 1px solid #30343c; }.mask-editor-body { min-height: 0; padding: 5px 7px 6px; overflow: auto; }
.mask-source { display: flex; height: 20px; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }.mask-source span { overflow: hidden; color: var(--text-secondary); font-size: 8px; font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }.mask-source small { flex: 0 0 auto; color: var(--text-muted); font-size: 6.5px; }
.segment-editor { display: grid; gap: 4px; margin-top: 6px; padding-top: 5px; border-top: 1px solid #2a2e37; }
.segment-title { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }.segment-title strong { color: #edc68b; font-size: 7.5px; font-weight: 600; }.segment-title small { color: var(--text-muted); font-size: 6.5px; }
.feather-control { display: flex; height: 20px; align-items: center; gap: 5px; color: var(--text-muted); font-size: 7px; }.feather-control label { flex: 0 0 auto; }.feather-control input[type="range"] { min-width: 0; flex: 1; accent-color: var(--focus); }.feather-number { width: 34px; flex: 0 0 auto; padding: 1px 3px; color: var(--text-secondary); background: #20232b; border: 1px solid #353a46; border-radius: 3px; font: inherit; font-size: 7px; font-variant-numeric: tabular-nums; text-align: right; }.feather-number:focus { border-color: var(--focus); outline: none; }
.segment-actions { display: flex; gap: 3px; }.segment-actions button { flex: 1; height: 18px; padding: 0 4px; color: var(--text-muted); background: #20232b; border: 1px solid #353a46; border-radius: 3px; font: inherit; font-size: 6.5px; cursor: pointer; white-space: nowrap; }.segment-actions button:hover { color: var(--text-primary); border-color: #596173; }
.segment-empty { margin: 6px 0 0; color: var(--text-muted); font-size: 7px; text-align: center; }
.mask-empty { display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; gap: 6px; padding: 12px; color: var(--text-muted); font-size: 8px; text-align: center; }.mask-empty svg { color: #727da9; }
</style>
