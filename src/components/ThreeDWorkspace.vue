<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Camera, Crosshair, Grid3X3, Move3D, Rotate3D, Scaling, Sun, View } from '@lucide/vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls, type TransformControlsMode } from 'three/addons/controls/TransformControls.js'
import { useEditorStore } from '@/stores/editor'
import { ThreeSceneRuntimeRegistry, type Scene3DRuntime } from '@/engine/scene3d/ThreeSceneRuntime'
import IconButton from './common/IconButton.vue'

const store = useEditorStore()
const { selectedScene, selectedSceneEntityId, currentTime, playing } = storeToRefs(store)
const viewport = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const transformMode = ref<TransformControlsMode>('translate')
const cameraView = ref('Perspective')
const stats = ref({ calls: 0, triangles: 0 })

const runtimeRegistry = new ThreeSceneRuntimeRegistry()
let renderer: THREE.WebGLRenderer | null = null
let editorCamera: THREE.PerspectiveCamera | null = null
let orbit: OrbitControls | null = null
let transform: TransformControls | null = null
let runtime: Scene3DRuntime | null = null
let resizeObserver: ResizeObserver | null = null

const activeSceneLabel = computed(() => selectedScene.value?.name ?? 'No 3D scene')

function ensureEditorHelpers(target: Scene3DRuntime) {
  if (!target.scene.getObjectByName('aurora-editor-grid')) {
    const grid = new THREE.GridHelper(20, 20, '#3d466e', '#242a3b')
    grid.name = 'aurora-editor-grid'
    grid.position.y = -1.19
    grid.userData.editorOnly = true
    target.scene.add(grid)
    const axes = new THREE.AxesHelper(2)
    axes.name = 'aurora-editor-axes'
    axes.userData.editorOnly = true
    target.scene.add(axes)
  }
  if (transform && !transform.getHelper().parent) target.scene.add(transform.getHelper())
}

function attachSelection() {
  if (!runtime || !transform) return
  const target = runtime.objects.get(selectedSceneEntityId.value)
  if (target) transform.attach(target)
  else transform.detach()
}

function renderViewport() {
  const sceneDefinition = selectedScene.value
  const host = viewport.value
  if (!renderer || !editorCamera || !host || !sceneDefinition) return
  runtime = runtimeRegistry.get(sceneDefinition, host.clientWidth, host.clientHeight, currentTime.value)
  ensureEditorHelpers(runtime)
  attachSelection()
  renderer.shadowMap.enabled = sceneDefinition.settings.shadows
  renderer.render(runtime.scene, editorCamera)
  stats.value = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
}

function resizeViewport() {
  const host = viewport.value
  if (!renderer || !editorCamera || !host) return
  const width = Math.max(1, host.clientWidth)
  const height = Math.max(1, host.clientHeight)
  renderer.setSize(width, height, false)
  editorCamera.aspect = width / height
  editorCamera.updateProjectionMatrix()
  renderViewport()
}

function setTransformMode(mode: TransformControlsMode) {
  transformMode.value = mode
  transform?.setMode(mode)
  renderViewport()
}

function setCameraView(view: 'Perspective' | 'Front' | 'Right' | 'Top') {
  if (!editorCamera || !orbit) return
  cameraView.value = view
  if (view === 'Front') editorCamera.position.set(0, 0, 10)
  else if (view === 'Right') editorCamera.position.set(10, 0, 0)
  else if (view === 'Top') editorCamera.position.set(0, 10, .001)
  else editorCamera.position.set(7, 5, 8)
  orbit.target.set(0, 0, 0)
  orbit.update()
  renderViewport()
}

function pickObject(event: PointerEvent) {
  if (!runtime || !editorCamera || !canvas.value || transform?.dragging) return
  const bounds = canvas.value.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(pointer, editorCamera)
  const hits = raycaster.intersectObjects([...runtime.objects.values()], true)
  const hit = hits.find((item) => {
    let candidate: THREE.Object3D | null = item.object
    while (candidate) {
      if (candidate.userData.auroraId) return true
      candidate = candidate.parent
    }
    return false
  })
  if (!hit || !selectedScene.value) return
  let candidate: THREE.Object3D | null = hit.object
  while (candidate && !candidate.userData.auroraId) candidate = candidate.parent
  if (candidate?.userData.auroraId) store.selectSceneEntity(selectedScene.value.id, candidate.userData.auroraId as string)
}

function commitTransform() {
  const object = transform?.object
  if (!object?.userData.auroraId) return
  store.update3DObjectTransform(object.userData.auroraId as string, {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [THREE.MathUtils.radToDeg(object.rotation.x), THREE.MathUtils.radToDeg(object.rotation.y), THREE.MathUtils.radToDeg(object.rotation.z)],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  })
}

function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.matches('input, textarea')) return
  if (event.key.toLowerCase() === 'g') setTransformMode('translate')
  if (event.key.toLowerCase() === 'r') setTransformMode('rotate')
  if (event.key.toLowerCase() === 's') setTransformMode('scale')
}

onMounted(async () => {
  await nextTick()
  if (!canvas.value || !viewport.value) return
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor('#090b10', 1)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  editorCamera = new THREE.PerspectiveCamera(48, 1, .1, 2000)
  editorCamera.position.set(7, 5, 8)
  orbit = new OrbitControls(editorCamera, canvas.value)
  orbit.enableDamping = false
  orbit.target.set(0, 0, 0)
  orbit.addEventListener('change', renderViewport)
  transform = new TransformControls(editorCamera, canvas.value)
  transform.setMode(transformMode.value)
  transform.setSize(.82)
  transform.addEventListener('change', renderViewport)
  transform.addEventListener('dragging-changed', (event) => { if (orbit) orbit.enabled = !event.value })
  transform.addEventListener('mouseUp', commitTransform)
  resizeObserver = new ResizeObserver(resizeViewport)
  resizeObserver.observe(viewport.value)
  window.addEventListener('keydown', onKeydown)
  resizeViewport()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeydown)
  orbit?.dispose()
  transform?.detach()
  transform?.dispose()
  runtimeRegistry.dispose()
  renderer?.dispose()
  renderer = null
})

watch([selectedScene, currentTime, selectedSceneEntityId], renderViewport, { deep: true })
</script>

<template>
  <section class="three-workspace">
    <div class="three-toolbar">
      <div class="tool-group">
        <IconButton :icon="Move3D" label="Move (G)" :active="transformMode === 'translate'" @click="setTransformMode('translate')" />
        <IconButton :icon="Rotate3D" label="Rotate (R)" :active="transformMode === 'rotate'" @click="setTransformMode('rotate')" />
        <IconButton :icon="Scaling" label="Scale (S)" :active="transformMode === 'scale'" @click="setTransformMode('scale')" />
      </div>
      <span class="toolbar-divider" />
      <button v-for="view in (['Perspective', 'Front', 'Right', 'Top'] as const)" :key="view" type="button" class="view-button" :class="{ active: cameraView === view }" @click="setCameraView(view)">{{ view }}</button>
      <span class="toolbar-spacer" />
      <span class="scene-label"><Box :size="11" /> {{ activeSceneLabel }}</span>
    </div>

    <div ref="viewport" class="three-viewport">
      <canvas ref="canvas" aria-label="3D scene editor viewport" @pointerdown="pickObject" />
      <div class="viewport-badge"><View :size="10" /> {{ cameraView }}</div>
      <div class="viewport-axis"><span class="x">X</span><span class="y">Y</span><span class="z">Z</span></div>
      <div class="viewport-help">Orbit: left-drag · Pan: right-drag · Zoom: wheel · G/R/S: transform</div>
    </div>

    <footer class="three-status">
      <span><Grid3X3 :size="10" /> World grid</span>
      <span><Crosshair :size="10" /> Local transform</span>
      <span class="status-spacer" />
      <span><Camera :size="10" /> {{ selectedScene?.cameras.length ?? 0 }} cameras</span>
      <span><Sun :size="10" /> {{ selectedScene?.lights.length ?? 0 }} lights</span>
      <span>{{ stats.calls }} calls · {{ stats.triangles.toLocaleString() }} tris</span>
      <strong :class="{ playing }">{{ playing ? 'LIVE' : 'READY' }}</strong>
    </footer>
  </section>
</template>

<style scoped>
.three-workspace { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: #090b10; }
.three-toolbar { display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 2px; padding: 0 7px; background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); }.tool-group { display: flex; gap: 1px; }.toolbar-divider { width: 1px; height: 20px; margin: 0 4px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.view-button { height: 24px; padding: 0 7px; color: var(--text-muted); background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; white-space: nowrap; }.view-button:hover { color: var(--text-primary); background: var(--bg-hover); }.view-button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.scene-label { display: flex; min-width: 0; align-items: center; gap: 5px; overflow: hidden; color: var(--text-secondary); font-size: 8.5px; text-overflow: ellipsis; white-space: nowrap; }
.three-viewport { position: relative; min-height: 0; flex: 1; overflow: hidden; background: #090b10; }.three-viewport canvas { display: block; width: 100%; height: 100%; outline: none; }.viewport-badge, .viewport-help { position: absolute; padding: 4px 6px; color: #858b99; background: rgb(12 14 20 / .78); border: 1px solid #292d37; border-radius: 3px; font-size: 7.5px; pointer-events: none; backdrop-filter: blur(4px); }.viewport-badge { top: 8px; left: 9px; display: flex; align-items: center; gap: 4px; }.viewport-help { right: 9px; bottom: 8px; }.viewport-axis { position: absolute; right: 10px; top: 9px; display: flex; gap: 3px; font-size: 7px; font-weight: 700; }.viewport-axis span { display: grid; width: 15px; height: 15px; place-items: center; color: #eef0f8; background: #252a35; border: 1px solid #3a404d; border-radius: 50%; }.viewport-axis .x { color: #ff9ca8; }.viewport-axis .y { color: #8bd5ad; }.viewport-axis .z { color: #91adff; }
.three-status { display: flex; height: 27px; flex: 0 0 auto; align-items: center; gap: 10px; padding: 0 8px; color: var(--text-muted); background: #111319; border-top: 1px solid var(--border-subtle); font-size: 7.5px; }.three-status span { display: flex; align-items: center; gap: 4px; white-space: nowrap; }.three-status .status-spacer { flex: 1; }.three-status strong { color: #7eb89f; font-size: 7px; letter-spacing: .08em; }.three-status strong.playing { color: #c3cafd; }
</style>

