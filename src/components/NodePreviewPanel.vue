<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Eye, ImageOff } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { evaluateNodeGraph } from '@/engine/nodes/evaluateGraph'
import type { AuroraFrameEngine } from '@/engine/rendering/AuroraFrameEngine'

const store = useEditorStore()
const {
  project, currentTime, playing, layers, assets, scenes3D, nodes, nodeConnections, renderRootNodeId, renderRevision, rigs, selectedNodeId,
} = storeToRefs(store)
const canvas = ref<HTMLCanvasElement>()
const initializing = ref(true)
const renderError = ref(false)
let renderer: AuroraFrameEngine | null = null

const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedNodeId.value))
const selectedNodeHasImage = computed(() => {
  const node = selectedNode.value
  return Boolean(node && (node.kind !== 'math') && (
    node.inputs.some((socket) => socket.type === 'image')
    || node.outputs.some((socket) => socket.type === 'image')
  ))
})
const selectedNodeUsesAdjustmentLayer = computed(() => {
  const nodeId = selectedNode.value?.id
  if (!nodeId) return false
  const byId = new Map(nodes.value.map((node) => [node.id, node]))
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    const node = byId.get(id)
    if (!node) return false
    if (node.sourceId) return layers.value.some((layer) => layer.id === node.sourceId && layer.type === 'adjustment')
    return nodeConnections.value.filter((connection) => connection.toNodeId === id).some((connection) => visit(connection.fromNodeId))
  }
  return visit(nodeId)
})
const previewRootNodeId = computed(() => {
  if (!selectedNodeHasImage.value) return renderRootNodeId.value
  if (selectedNodeUsesAdjustmentLayer.value) return nodes.value.find((node) => node.kind === 'output')?.id ?? selectedNode.value!.id
  return selectedNode.value!.id
})
const previewLabel = computed(() => selectedNodeHasImage.value
  ? selectedNode.value!.title
  : renderRootNodeId.value
    ? nodes.value.find((node) => node.id === renderRootNodeId.value)?.title ?? 'Viewer'
    : 'Composite')
const liveLayers = computed(() => layers.value.filter((layer) => !layer.isPlaceholder && layer.visible && layer.type !== 'audio'
  && currentTime.value >= layer.start && currentTime.value < layer.start + layer.duration))
const passCount = computed(() => selectedNodeHasImage.value
  ? (evaluateNodeGraph(nodes.value, nodeConnections.value, previewRootNodeId.value) ?? [])
    .filter((pass) => liveLayers.value.some((layer) => layer.id === pass.layerId)).length
  : liveLayers.value.length)
const previewRenderSize = computed(() => {
  const scale = Math.min(1, 640 / project.value.width, 360 / project.value.height)
  return { width: Math.max(1, Math.round(project.value.width * scale)), height: Math.max(1, Math.round(project.value.height * scale)) }
})
const previewCanvasStyle = computed(() => ({
  width: project.value.width >= project.value.height ? 'calc(100% - 28px)' : 'auto',
  height: project.value.width >= project.value.height ? 'auto' : 'calc(100% - 20px)',
  aspectRatio: `${project.value.width} / ${project.value.height}`,
}))

async function drawNow() {
  if (!renderer) return
  try {
    await renderer.requestFrame({
      project: project.value,
      layers: layers.value,
      scenes3D: scenes3D.value,
      assets: assets.value,
      nodes: selectedNodeHasImage.value ? nodes.value : [],
      nodeConnections: selectedNodeHasImage.value ? nodeConnections.value : [],
      renderRootNodeId: selectedNodeHasImage.value ? previewRootNodeId.value : null,
      revision: renderRevision.value,
      rigs: rigs.value,
      time: currentTime.value,
      playback: playing.value,
      width: previewRenderSize.value.width,
      height: previewRenderSize.value.height,
      quality: 'preview',
    })
    renderError.value = false
  } catch {
    renderError.value = true
  }
}

function scheduleDraw() {
  void drawNow()
}

onMounted(async () => {
  await nextTick()
  if (!canvas.value) return
  try {
    const { AuroraFrameEngine } = await import('@/engine/rendering/AuroraFrameEngine')
    renderer = new AuroraFrameEngine(canvas.value, '/demo/aurora-ridge.png', { targetFrameMs: 24, adaptiveQuality: true })
    await renderer.initialize({ ...previewRenderSize.value, pixelRatio: 1 })
    await drawNow()
  } catch {
    renderError.value = true
  } finally {
    initializing.value = false
  }
})

onBeforeUnmount(() => {
  void renderer?.dispose()
  renderer = null
})

watch([currentTime, project, layers, scenes3D, nodes, nodeConnections, previewRootNodeId, renderRevision, rigs], scheduleDraw, { deep: true })
</script>

<template>
  <section class="node-preview-panel" aria-label="Selected node preview">
    <header class="preview-header">
      <span class="preview-title"><Eye :size="11" /> Viewport</span>
      <span class="preview-divider" />
      <span class="preview-source" :title="previewLabel">
        <small>{{ selectedNodeUsesAdjustmentLayer ? 'Adjustment preview' : selectedNodeHasImage ? 'Selected node' : 'Render root' }}</small>
        <strong>{{ previewLabel }}</strong>
      </span>
      <span class="preview-spacer" />
      <span class="preview-status" :class="{ empty: !passCount }">{{ passCount }} {{ passCount === 1 ? 'source' : 'sources' }}</span>
    </header>

    <div class="preview-viewport">
      <canvas ref="canvas" :width="previewRenderSize.width" :height="previewRenderSize.height" :style="previewCanvasStyle" aria-label="Live output of the selected node" />
      <div v-if="initializing" class="preview-message">Starting viewport…</div>
      <div v-else-if="renderError" class="preview-message error"><ImageOff :size="15" /> Preview unavailable</div>
      <div v-else-if="!passCount" class="preview-message"><ImageOff :size="15" /> No image reaches this node</div>
      <div class="preview-badge"><span class="live-dot" /> Live · {{ previewLabel }}</div>
    </div>
  </section>
</template>

<style scoped>
.node-preview-panel { display: flex; min-height: 0; flex-direction: column; overflow: hidden; background: #090b0f; }
.preview-header { display: flex; height: 30px; min-width: 0; flex: 0 0 auto; align-items: center; gap: 7px; padding: 0 8px; color: var(--text-secondary); background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); }
.preview-title { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; color: #dce2ff; font-size: 8.5px; font-weight: 620; letter-spacing: .035em; text-transform: uppercase; }.preview-title svg { color: var(--accent); }
.preview-divider { width: 1px; height: 16px; flex: 0 0 auto; background: var(--border-subtle); }
.preview-source { display: flex; min-width: 0; align-items: baseline; gap: 6px; overflow: hidden; }.preview-source small { flex: 0 0 auto; color: var(--text-muted); font-size: 7.5px; }.preview-source strong { overflow: hidden; color: var(--text-primary); font-size: 8.5px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.preview-spacer { flex: 1; }.preview-status { flex: 0 0 auto; color: var(--success); font-size: 7.5px; white-space: nowrap; }.preview-status.empty { color: var(--text-muted); }
.preview-viewport { position: relative; display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; overflow: hidden; background-color: #08090c; background-image: linear-gradient(45deg, #0c0e13 25%, transparent 25%), linear-gradient(-45deg, #0c0e13 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #0c0e13 75%), linear-gradient(-45deg, transparent 75%, #0c0e13 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; }
.preview-viewport canvas { display: block; max-width: calc(100% - 28px); max-height: calc(100% - 20px); background: #08090c; box-shadow: 0 8px 28px rgb(0 0 0 / .48), 0 0 0 1px #30333d; }
.preview-message { position: absolute; display: flex; align-items: center; gap: 6px; padding: 6px 9px; color: var(--text-muted); background: rgb(12 14 19 / .82); border: 1px solid var(--border-subtle); border-radius: 3px; font-size: 8px; backdrop-filter: blur(4px); }.preview-message.error { color: #c98d8d; }
.preview-badge { position: absolute; top: 7px; left: 8px; display: flex; max-width: calc(100% - 16px); align-items: center; gap: 5px; overflow: hidden; padding: 4px 7px; color: #9ba0aa; background: rgb(12 14 19 / .74); border: 1px solid #262a32; border-radius: 3px; font-size: 7.5px; text-overflow: ellipsis; white-space: nowrap; backdrop-filter: blur(5px); }.live-dot { width: 5px; height: 5px; flex: 0 0 auto; border-radius: 50%; background: var(--success); }
</style>
