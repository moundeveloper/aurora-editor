<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ImageOff, View } from '@lucide/vue'
import * as THREE from 'three'
import { useEditorStore } from '@/stores/editor'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { cameraIdAtTime } from '@/engine/scene3d/cameraCuts'
import MSelect, { type MSelectOption } from './common/MSelect.vue'

const store = useEditorStore()
const { selectedScene, currentTime } = storeToRefs(store)
const viewport = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const renderError = ref(false)
const cameraChoice = ref('program')
const runtimeRegistry = new ThreeSceneRuntimeRegistry()
let renderer: THREE.WebGLRenderer | null = null
let resizeObserver: ResizeObserver | null = null

const previewCamera = computed(() => {
  const scene = selectedScene.value
  if (!scene) return null
  const cameraId = cameraChoice.value === 'program' ? cameraIdAtTime(scene, currentTime.value) : cameraChoice.value
  return scene.cameras.find((camera) => camera.id === cameraId)
    ?? scene.cameras[0]
    ?? null
})
const cameraOptions = computed<MSelectOption[]>(() => {
  const scene = selectedScene.value
  const programmed = scene?.cameras.find((camera) => camera.id === cameraIdAtTime(scene, currentTime.value))
  return [
    { value: 'program', label: `Program · ${programmed?.name ?? 'No camera'}` },
    ...(scene?.cameras.map((camera) => ({ value: camera.id, label: camera.name })) ?? []),
  ]
})

function renderPreview() {
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
    const runtime = runtimeRegistry.get(sceneDefinition, width, height, currentTime.value)
    const camera = runtime.cameras.get(cameraDefinition.id)
    if (!camera) return
    renderer.render(runtime.scene, camera)
    renderError.value = false
  } catch {
    renderError.value = true
  }
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
  resizeObserver?.disconnect()
  runtimeRegistry.dispose()
  renderer?.dispose()
  renderer = null
})

watch([selectedScene, currentTime, cameraChoice], renderPreview, { deep: true })
watch(() => selectedScene.value?.cameras.map((camera) => camera.id), (cameraIds) => {
  if (cameraChoice.value !== 'program' && !cameraIds?.includes(cameraChoice.value)) cameraChoice.value = 'program'
}, { deep: true })
</script>

<template>
  <section class="three-preview-panel" aria-label="3D camera viewport">
    <header class="preview-header">
      <span class="preview-title"><View :size="11" /> 3D Viewport</span>
      <span class="preview-divider" />
      <MSelect v-model="cameraChoice" class="camera-select" :options="cameraOptions" label="Preview camera" />
      <span class="preview-spacer" />
      <span v-if="previewCamera" class="live-status"><i /> Live</span>
    </header>

    <div ref="viewport" class="preview-viewport">
      <canvas ref="canvas" aria-label="Live 3D camera preview" />
      <div v-if="renderError || !previewCamera" class="preview-message"><ImageOff :size="15" /> {{ renderError ? 'Preview unavailable' : 'No camera in scene' }}</div>
    </div>
  </section>
</template>

<style scoped>
.three-preview-panel { display: flex; min-height: 0; flex-direction: column; overflow: hidden; background: #090b10; }
.preview-header { display: flex; height: 30px; min-width: 0; flex: 0 0 auto; align-items: center; gap: 7px; padding: 0 8px; color: var(--text-secondary); background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); }
.preview-title { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; color: #dce2ff; font-size: 8.5px; font-weight: 620; letter-spacing: .035em; text-transform: uppercase; }.preview-title svg { color: var(--accent); }.preview-divider { width: 1px; height: 16px; flex: 0 0 auto; background: var(--border-subtle); }
.camera-select { min-width: 88px; flex: 1; }.preview-spacer { flex: 0 0 0; }.live-status { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; color: var(--success); font-size: 7px; letter-spacing: .05em; text-transform: uppercase; }.live-status i { width: 5px; height: 5px; border-radius: 50%; background: var(--success); }
.preview-viewport { position: relative; display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; overflow: hidden; background: #080a0e; }.preview-viewport canvas { display: block; width: calc(100% - 28px); max-width: 960px; height: auto; max-height: calc(100% - 20px); aspect-ratio: 16 / 9; background: #090b10; box-shadow: 0 8px 28px rgb(0 0 0 / .48), 0 0 0 1px #30333d; }
.preview-message { position: absolute; display: flex; align-items: center; gap: 6px; padding: 6px 9px; color: var(--text-muted); background: rgb(12 14 19 / .82); border: 1px solid var(--border-subtle); border-radius: 3px; font-size: 8px; }
</style>
