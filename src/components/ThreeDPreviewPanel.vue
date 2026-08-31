<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ImageOff, Radio, View } from '@lucide/vue'
import * as THREE from 'three'
import { useEditorStore } from '@/stores/editor'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { cameraIdAtTime } from '@/engine/scene3d/cameraCuts'
import MSelect, { type MSelectOption } from './common/MSelect.vue'

const store = useEditorStore()
const { selectedLayer, selectedScene, currentTime, assets, project, rigs } = storeToRefs(store)
const viewport = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const renderError = ref(false)
const cameraChoice = ref('')
const followCuts = ref(true)
const runtimeRegistry = new ThreeSceneRuntimeRegistry(() => renderPreview())
let renderer: THREE.WebGLRenderer | null = null
let resizeObserver: ResizeObserver | null = null
let previewFrame = 0

const previewCamera = computed(() => {
  const scene = selectedScene.value
  if (!scene) return null
  return scene.cameras.find((camera) => camera.id === cameraChoice.value)
    ?? scene.cameras[0]
    ?? null
})
const cameraOptions = computed<MSelectOption[]>(() => selectedScene.value?.cameras.map((camera) => ({ value: camera.id, label: camera.name })) ?? [])
const previewCanvasStyle = computed(() => ({
  width: project.value.width >= project.value.height ? 'calc(100% - 28px)' : 'auto',
  height: project.value.width >= project.value.height ? 'auto' : 'calc(100% - 20px)',
  aspectRatio: `${project.value.width} / ${project.value.height}`,
}))

function syncProgramCamera() {
  const scene = selectedScene.value
  if (scene && followCuts.value) cameraChoice.value = cameraIdAtTime(scene, currentTime.value) ?? scene.cameras[0]?.id ?? ''
}

function selectPreviewCamera(cameraId: string) {
  cameraChoice.value = cameraId
  followCuts.value = false
}

function toggleFollowCuts() {
  followCuts.value = !followCuts.value
  syncProgramCamera()
}

function renderPreviewNow() {
  const sceneDefinition = selectedScene.value
  const cameraDefinition = previewCamera.value
  const host = viewport.value
  const surface = canvas.value
  if (!renderer || !sceneDefinition || !cameraDefinition || !host || !surface || surface.clientWidth < 2 || surface.clientHeight < 2) return
  try {
    const width = surface.clientWidth
    const height = surface.clientHeight
    renderer.setSize(width, height, false)
    renderer.setClearColor(sceneDefinition.settings.backgroundColor ?? '#090b10', 1)
    renderer.shadowMap.enabled = sceneDefinition.settings.shadows
    const runtime = runtimeRegistry.get(sceneDefinition, width, height, currentTime.value, assets.value, rigs.value)
    runtime.root.visible = selectedLayer.value?.visible !== false
    const camera = runtime.cameras.get(cameraDefinition.id)
    if (!camera) return
    renderer.render(runtime.scene, camera)
    renderError.value = false
  } catch {
    renderError.value = true
  }
}

function renderPreview() {
  if (previewFrame) return
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0
    renderPreviewNow()
  })
}

onMounted(async () => {
  await nextTick()
  if (!canvas.value || !viewport.value) return
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    resizeObserver = new ResizeObserver(renderPreview)
    resizeObserver.observe(viewport.value)
    renderPreview()
  } catch {
    renderError.value = true
  }
})

onBeforeUnmount(() => {
  if (previewFrame) cancelAnimationFrame(previewFrame)
  resizeObserver?.disconnect()
  runtimeRegistry.dispose()
  renderer?.dispose()
  renderer = null
})

watch([selectedLayer, selectedScene, currentTime, assets, project, rigs], () => {
  syncProgramCamera()
  renderPreview()
}, { deep: true, immediate: true })
watch(cameraChoice, renderPreview)
watch(() => selectedScene.value?.cameras.map((camera) => camera.id), (cameraIds) => {
  if (!cameraIds?.includes(cameraChoice.value)) {
    followCuts.value = true
    syncProgramCamera()
  }
}, { deep: true })
</script>

<template>
  <section class="three-preview-panel" aria-label="3D camera viewport">
    <header class="preview-header">
      <span class="preview-title"><View :size="11" /> 3D Viewport</span>
      <span class="preview-divider" />
      <MSelect :model-value="cameraChoice" class="camera-select" :options="cameraOptions" label="Preview camera" @update:model-value="selectPreviewCamera" />
      <button type="button" class="follow-cuts" :class="{ active: followCuts }" :title="followCuts ? 'Following camera cuts' : 'Follow camera cuts'" @click="toggleFollowCuts"><Radio :size="10" /></button>
      <span class="preview-spacer" />
      <span v-if="previewCamera" class="live-status" :class="{ preview: !followCuts }"><i /> {{ followCuts ? 'Cuts' : 'Preview' }}</span>
    </header>

    <div ref="viewport" class="preview-viewport">
      <canvas ref="canvas" :style="previewCanvasStyle" aria-label="Live 3D camera preview" />
      <div v-if="renderError || !previewCamera" class="preview-message"><ImageOff :size="15" /> {{ renderError ? 'Preview unavailable' : 'No camera in scene' }}</div>
    </div>
  </section>
</template>

<style scoped>
.three-preview-panel { display: flex; min-height: 0; flex-direction: column; overflow: hidden; background: #090b10; }
.preview-header { display: flex; height: 30px; min-width: 0; flex: 0 0 auto; align-items: center; gap: 7px; padding: 0 8px; color: var(--text-secondary); background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); }
.preview-title { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; color: #dce2ff; font-size: 8.5px; font-weight: 620; letter-spacing: .035em; text-transform: uppercase; }.preview-title svg { color: var(--accent); }.preview-divider { width: 1px; height: 16px; flex: 0 0 auto; background: var(--border-subtle); }
.camera-select { min-width: 88px; flex: 1; }.follow-cuts { display: grid; width: 22px; height: 22px; flex: 0 0 auto; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 1px solid transparent; border-radius: 3px; cursor: pointer; }.follow-cuts:hover { color: var(--text-primary); background: var(--bg-hover); }.follow-cuts.active { color: #cdd5ff; background: var(--bg-selected); border-color: var(--accent-border); }.preview-spacer { flex: 0 0 0; }.live-status { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; color: var(--success); font-size: 7px; letter-spacing: .05em; text-transform: uppercase; }.live-status.preview { color: #aeb8e8; }.live-status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.preview-viewport { position: relative; display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; overflow: hidden; background: #080a0e; }.preview-viewport canvas { display: block; max-width: calc(100% - 28px); max-height: calc(100% - 20px); background: #090b10; box-shadow: 0 8px 28px rgb(0 0 0 / .48), 0 0 0 1px #30333d; }
.preview-message { position: absolute; display: flex; align-items: center; gap: 6px; padding: 6px 9px; color: var(--text-muted); background: rgb(12 14 19 / .82); border: 1px solid var(--border-subtle); border-radius: 3px; font-size: 8px; }
</style>
