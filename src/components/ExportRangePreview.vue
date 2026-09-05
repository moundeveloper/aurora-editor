<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Eye, ImageOff } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { AuroraFrameEngine } from '@/engine/rendering/AuroraFrameEngine'

const props = defineProps<{ time: number; label: string }>()
const store = useEditorStore()
const { project, layers, assets, scenes3D, nodes, nodeConnections, renderRootNodeId, renderRevision, rigs } = storeToRefs(store)
const canvas = ref<HTMLCanvasElement>()
const initializing = ref(true)
const renderError = ref(false)
let renderer: AuroraFrameEngine | null = null

const renderSize = computed(() => {
  const scale = Math.min(1, 480 / project.value.width, 270 / project.value.height)
  return { width: Math.max(1, Math.round(project.value.width * scale)), height: Math.max(1, Math.round(project.value.height * scale)) }
})

function formatTime(time: number) {
  const seconds = Math.max(0, time)
  const whole = Math.floor(seconds)
  const frame = Math.min(Math.round(project.value.frameRate) - 1, Math.floor((seconds % 1) * project.value.frameRate))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}:${String(frame).padStart(2, '0')}`
}

async function drawNow() {
  if (!renderer) return
  try {
    await renderer.requestFrame({
      project: project.value,
      layers: layers.value,
      scenes3D: scenes3D.value,
      assets: assets.value,
      nodes: nodes.value,
      nodeConnections: nodeConnections.value,
      renderRootNodeId: renderRootNodeId.value,
      revision: renderRevision.value,
      rigs: rigs.value,
      time: props.time,
      width: renderSize.value.width,
      height: renderSize.value.height,
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
    renderer = new AuroraFrameEngine(canvas.value, '/demo/aurora-ridge.png', { adaptiveQuality: false })
    await renderer.initialize({ ...renderSize.value, pixelRatio: 1 })
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

watch([() => props.time, project, layers, scenes3D, nodes, nodeConnections, renderRootNodeId, renderRevision, rigs], scheduleDraw, { deep: true })
</script>

<template>
  <aside class="range-preview" aria-label="Export range frame preview">
    <header><span><Eye :size="10" /> Frame preview</span><strong>{{ label }} · {{ formatTime(time) }}</strong></header>
    <div class="preview-stage">
      <canvas ref="canvas" :width="renderSize.width" :height="renderSize.height" aria-label="Frame at the selected export time" />
      <div v-if="initializing" class="preview-message">Loading preview…</div>
      <div v-else-if="renderError" class="preview-message error"><ImageOff :size="13" /> Preview unavailable</div>
      <span class="preview-time">{{ time.toFixed(2) }}s</span>
    </div>
  </aside>
</template>

<style scoped>
.range-preview { display: flex; min-width: 0; height: 112px; flex-direction: column; overflow: hidden; background: #0c0e12; border: 1px solid #343946; border-radius: 3px; }.range-preview > header { display: flex; height: 23px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 6px; padding: 0 6px; color: var(--text-muted); background: #151820; border-bottom: 1px solid #2b303a; font-size: 6.5px; }.range-preview > header span { display: flex; align-items: center; gap: 4px; color: #aeb5d9; text-transform: uppercase; }.range-preview > header strong { overflow: hidden; color: #cfd5ff; font-weight: 550; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }.preview-stage { position: relative; display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; overflow: hidden; background-color: #08090c; background-image: linear-gradient(45deg, #0c0e13 25%, transparent 25%), linear-gradient(-45deg, #0c0e13 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #0c0e13 75%), linear-gradient(-45deg, transparent 75%, #0c0e13 75%); background-position: 0 0, 0 7px, 7px -7px, -7px 0; background-size: 14px 14px; }.preview-stage canvas { display: block; width: auto; height: calc(100% - 10px); max-width: calc(100% - 12px); background: #08090c; box-shadow: 0 4px 12px rgb(0 0 0 / .45), 0 0 0 1px #30333d; }.preview-message { position: absolute; display: flex; align-items: center; gap: 4px; padding: 4px 6px; color: var(--text-muted); background: rgb(12 14 19 / .82); border: 1px solid var(--border-subtle); border-radius: 3px; font-size: 7px; }.preview-message.error { color: #c98d8d; }.preview-time { position: absolute; right: 4px; bottom: 3px; padding: 2px 4px; color: #cfd5ff; background: rgb(9 11 15 / .8); border-radius: 2px; font-size: 6.5px; font-variant-numeric: tabular-nums; }
</style>
