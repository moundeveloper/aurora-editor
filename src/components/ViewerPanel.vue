<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  BoxSelect, ChevronDown, Circle, Crosshair, Grid3X3, Hand, Maximize2, MousePointer2,
  Move, Pause, PenTool, Play, RotateCcw, SkipBack, SkipForward, Spline, Square,
  Type, Volume2, VolumeX, ZoomIn, ZoomOut,
} from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { AuroraFrameEngine } from '@/engine/rendering/AuroraFrameEngine'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { setNumericPropertyAtTime } from '@/engine/animation/editNumericProperty'
import type { AuroraRig, EditorLayer, ShapePathPoint } from '@/models/editor'
import { applyMatrix, boneTransforms, invert, multiply, rotation as rotationMatrix, scaling, translation, type Matrix2D, type RigPoint } from '@/engine/rig/skeleton'
import { poseOffsetTowards, poseRotationTowards, restAimTowards } from '@/engine/rig/rigPosing'
import IconButton from './common/IconButton.vue'

const store = useEditorStore()
const {
  project, currentTime, playing, loop, snap, zoom, activeClusterId, timelineLayers, assets, scenes3D,
  nodes, nodeConnections, renderRootNodeId, renderRevision, rigs, selectedRigBoneId, selectedLayer,
  selectedLayerId, selectedKeyframeId, frameCacheRequestId, frameCacheCancelId, frameCacheClearId,
  frameCacheRange,
} = storeToRefs(store)
const canvas = ref<HTMLCanvasElement>()
const canvasWrap = ref<HTMLElement>()
const transformBox = ref<HTMLElement>()
type MotionTool = 'Select' | 'Hand' | 'Zoom' | 'Text' | 'Rectangle' | 'Ellipse' | 'Pen' | 'Rig' | 'Transform'
const activeTool = ref<MotionTool>('Select')
const activeTransformMode = ref<'move' | 'scale' | 'rotate' | null>(null)
const audioEnabled = ref(true)
const showGrid = ref(false)
const showGuides = ref(true)
const viewportSize = ref({ width: 0, height: 0 })
const viewportPan = ref({ x: 0, y: 0 })
const isViewportPanning = ref(false)
let renderer: AuroraFrameEngine | null = null
let cacheRenderer: AuroraFrameEngine | null = null
let cacheAbort: AbortController | null = null
let cacheRun: Promise<void> | null = null
let resizeObserver: ResizeObserver | null = null

interface ShapeDrawState {
  pointerId: number
  kind: 'rectangle' | 'ellipse'
  start: { x: number; y: number }
  current: { x: number; y: number }
  startClientX: number
  startClientY: number
  shift: boolean
  alt: boolean
}

interface PenDragState { pointerId: number; pointId: string }

const shapeDraw = ref<ShapeDrawState | null>(null)
const penDraft = ref<{ points: ShapePathPoint[] } | null>(null)
let penDrag: PenDragState | null = null

/** Half the on-screen size of an image layer's quad, in project pixels. Rig space spans -1 to 1 across it. */
const RIG_HALF_SIZE = 130
/** Pointer slack for grabbing a bone handle, in screen pixels. */
const RIG_GRAB_RADIUS = 11

type RigDragMode = 'create' | 'rotate' | 'offset' | 'rest-head' | 'rest-tip'

interface RigDragState {
  pointerId: number
  mode: RigDragMode
  boneId: string
  origin: { x: number; y: number; angle: number; length: number }
  moved: boolean
}

let rigDrag: RigDragState | null = null

interface ViewportTransformState {
  layer: EditorLayer
  mode: 'move' | 'scale' | 'rotate'
  scaleAxis: 'uniform' | 'x' | 'y'
  startX: number
  startY: number
  centerX: number
  centerY: number
  startDistance: number
  startAxisDistanceX: number
  startAxisDistanceY: number
  startAngle: number
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  moved: boolean
}

interface ViewportPanState { pointerId: number; startX: number; startY: number; originX: number; originY: number }

let viewportTransformState: ViewportTransformState | null = null
let viewportPanState: ViewportPanState | null = null
const tools: Array<{ name: MotionTool; icon: typeof MousePointer2 }> = [
  { name: 'Select', icon: MousePointer2 }, { name: 'Hand', icon: Hand }, { name: 'Zoom', icon: ZoomIn },
  { name: 'Text', icon: Type }, { name: 'Rectangle', icon: Square }, { name: 'Ellipse', icon: Circle },
  { name: 'Pen', icon: PenTool }, { name: 'Rig', icon: Spline }, { name: 'Transform', icon: Move },
]

const timecode = computed(() => {
  const totalFrames = Math.floor(currentTime.value * project.value.frameRate)
  const frames = totalFrames % Math.max(1, Math.round(project.value.frameRate))
  const totalSeconds = Math.floor(totalFrames / project.value.frameRate)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':')
})

const interactiveLayers = computed(() => [...timelineLayers.value]
  .filter((layer) => layer.visible && !layer.locked && ['text', 'shape', 'image', 'video', 'cluster'].includes(layer.type) && currentTime.value >= layer.start && currentTime.value < layer.start + layer.duration)
  .reverse())

function layerBoxSize(layer: EditorLayer) {
  if (layer.type === 'cluster') return { width: 72, height: 72 }
  if (layer.type === 'video') return { width: 100, height: 100 }
  if (layer.type === 'shape') return {
    width: ((layer.shapeWidth ?? 280) / project.value.width) * 100,
    height: ((layer.shapeHeight ?? 180) / project.value.height) * 100,
  }
  if (layer.type === 'image') return { width: 20, height: 35.5 }
  return { width: layer.textContent === 'New Text' ? 28 : 48, height: 13 }
}

function layerOverlayStyle(layer: EditorLayer) {
  const size = layerBoxSize(layer)
  return {
    left: `${(evaluateNumericProperty(layer.transform.x, currentTime.value) / project.value.width) * 100}%`,
    top: `${(evaluateNumericProperty(layer.transform.y, currentTime.value) / project.value.height) * 100}%`,
    width: `${size.width}%`,
    height: `${size.height}%`,
    borderRadius: layer.shapeKind === 'ellipse' ? '50%' : '2px',
    transform: `translate(-50%, -50%) rotate(${evaluateNumericProperty(layer.transform.rotation, currentTime.value)}deg) scale(${evaluateNumericProperty(layer.transform.scaleX, currentTime.value) / 100}, ${evaluateNumericProperty(layer.transform.scaleY, currentTime.value) / 100})`,
  }
}

/**
 * The box may only describe a layer of the timeline currently being edited.
 *
 * `selectedLayer` resolves an id anywhere in the tree and falls back to the first layer when it
 * resolves to nothing — right for the inspector, wrong here. Either would put a box around something
 * the viewport is not showing: a fallback nobody selected, or a layer that has since been folded
 * into a cluster and now lives outside this timeline. Matching against the active context's own
 * layers rules out both.
 */
const activeSelection = computed(() => timelineLayers.value.find((layer) => layer.id === selectedLayerId.value && !layer.isPlaceholder) ?? null)

const selectionStyle = computed(() => {
  const layer = activeSelection.value
  if (!layer || !['text', 'shape', 'image', 'video', 'cluster'].includes(layer.type) || currentTime.value < layer.start || currentTime.value >= layer.start + layer.duration) return { display: 'none' }
  return layerOverlayStyle(layer)
})

const stageStyle = computed(() => {
  const availableWidth = Math.max(0, viewportSize.value.width - 48)
  const availableHeight = Math.max(0, viewportSize.value.height - 48)
  const fitScale = Math.min(availableWidth / project.value.width, availableHeight / project.value.height)
  const displayScale = Math.max(0, fitScale) * (zoom.value / 100)
  return {
    width: `${project.value.width * displayScale}px`,
    height: `${project.value.height * displayScale}px`,
    transform: `translate(${viewportPan.value.x}px, ${viewportPan.value.y}px)`,
  }
})

const previewRenderSize = computed(() => {
  const scale = Math.min(1, 1280 / project.value.width, 720 / project.value.height)
  return {
    width: Math.max(1, Math.round(project.value.width * scale)),
    height: Math.max(1, Math.round(project.value.height * scale)),
  }
})

/**
 * The layer the rig overlay can be drawn over.
 *
 * A rig bends a texture, so any textured layer can carry one — but only an image draws at a known
 * fixed size in project space, which is what the overlay needs to place bones under the cursor. A
 * video's quad depends on the decoded frame, so its rig is edited numerically in the inspector.
 */
const rigLayer = computed(() => (activeSelection.value?.type === 'image' ? activeSelection.value : null))
const activeRig = computed<AuroraRig | null>(() => rigs.value.find((rig) => rig.id === rigLayer.value?.rigId) ?? null)

/** Project space ← rig space, matching the SVG group transform exactly so hit-testing agrees with what is drawn. */
const rigMatrix = computed<Matrix2D | null>(() => {
  const layer = rigLayer.value
  if (!layer) return null
  const at = (key: keyof EditorLayer['transform']) => evaluateNumericProperty(layer.transform[key], currentTime.value)
  return multiply(
    translation(at('x'), at('y')),
    multiply(
      rotationMatrix(at('rotation')),
      multiply(scaling(at('scaleX') / 100, at('scaleY') / 100), scaling(RIG_HALF_SIZE, -RIG_HALF_SIZE)),
    ),
  )
})

const rigGroupTransform = computed(() => {
  const layer = rigLayer.value
  if (!layer) return ''
  const at = (key: keyof EditorLayer['transform']) => evaluateNumericProperty(layer.transform[key], currentTime.value)
  return `translate(${at('x')} ${at('y')}) rotate(${at('rotation')}) scale(${at('scaleX') / 100} ${at('scaleY') / 100}) scale(${RIG_HALF_SIZE} ${-RIG_HALF_SIZE})`
})

/** Posed head and tip of every bone, in rig space, ready to draw inside the transformed group. */
const rigBoneShapes = computed(() => {
  const rig = activeRig.value
  if (!rig) return []
  const transforms = boneTransforms(rig, currentTime.value)
  return rig.bones.map((bone) => {
    const world = transforms.get(bone.id)?.world
    return {
      id: bone.id,
      name: bone.name,
      head: world ? applyMatrix(world, 0, 0) : { x: bone.x, y: bone.y },
      tip: world ? applyMatrix(world, bone.length, 0) : { x: bone.x, y: bone.y },
    }
  })
})

/** Handles are authored in rig units, so they have to shrink as the layer's own scale grows. */
const rigHandleRadius = computed(() => {
  const layer = rigLayer.value
  const scale = layer ? Math.abs(evaluateNumericProperty(layer.transform.scaleX, currentTime.value)) / 100 : 1
  return .045 / Math.max(.05, scale)
})

/** Capture keeps a drag alive past the element's edge; a pointer that refuses it still drags inside. */
function capturePointer(pointerId: number) {
  try {
    canvasWrap.value?.setPointerCapture(pointerId)
  } catch {
    // Nothing to hold on to — the pointer ended, or it never belonged to this element.
  }
}

function rigPointAt(event: PointerEvent): RigPoint | null {
  const matrix = rigMatrix.value
  const bounds = canvas.value?.getBoundingClientRect()
  // A collapsed or hidden viewport has no size to divide by, and would hand back a bone at NaN.
  if (!matrix || !bounds?.width || !bounds.height) return null
  const projectX = ((event.clientX - bounds.left) / bounds.width) * project.value.width
  const projectY = ((event.clientY - bounds.top) / bounds.height) * project.value.height
  const point = applyMatrix(invert(matrix), projectX, projectY)
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null
}

/** Distance in screen pixels between a rig-space point and the pointer, for hit-testing handles. */
function rigScreenDistance(point: RigPoint, event: PointerEvent) {
  const matrix = rigMatrix.value
  const bounds = canvas.value?.getBoundingClientRect()
  if (!matrix || !bounds?.width || !bounds.height) return Number.POSITIVE_INFINITY
  const projected = applyMatrix(matrix, point.x, point.y)
  const clientX = bounds.left + (projected.x / project.value.width) * bounds.width
  const clientY = bounds.top + (projected.y / project.value.height) * bounds.height
  return Math.hypot(event.clientX - clientX, event.clientY - clientY)
}

function ensureLayerRig() {
  const layer = rigLayer.value
  if (!layer) return null
  const existing = rigs.value.find((rig) => rig.id === layer.rigId)
  if (existing) return existing
  const rig = store.addRig(`${layer.name} Rig`)
  store.attachRigToLayer(rig.id)
  return rig
}

/**
 * A pointer press with the Rig tool either grabs a handle or starts a new bone.
 *
 * Grab order runs tip, head, then the bone itself, because the tip is the handle people reach for
 * most and it sits on top of the shaft. Shift edits the rest pose — where the skeleton *is* — while
 * a plain drag poses it, which is the distinction the whole tool turns on.
 */
function beginRigInteraction(event: PointerEvent) {
  const rig = activeRig.value
  const point = rigPointAt(event)
  if (!point) return
  event.preventDefault()
  capturePointer(event.pointerId)

  if (rig) {
    const shapes = rigBoneShapes.value
    const nearest = (pick: 'head' | 'tip') => shapes
      .map((shape) => ({ shape, distance: rigScreenDistance(shape[pick], event) }))
      .sort((left, right) => left.distance - right.distance)[0]
    const tip = nearest('tip')
    const head = nearest('head')
    const target = tip && tip.distance <= RIG_GRAB_RADIUS && tip.distance <= (head?.distance ?? Infinity)
      ? { shape: tip.shape, mode: event.shiftKey ? 'rest-tip' as const : 'rotate' as const }
      : head && head.distance <= RIG_GRAB_RADIUS
        ? { shape: head.shape, mode: event.shiftKey ? 'rest-head' as const : 'offset' as const }
        : null
    if (target) {
      const bone = rig.bones.find((item) => item.id === target.shape.id)!
      selectedRigBoneId.value = bone.id
      rigDrag = { pointerId: event.pointerId, mode: target.mode, boneId: bone.id, origin: { x: bone.x, y: bone.y, angle: bone.angle, length: bone.length }, moved: false }
      store.beginInteractiveEdit()
      return
    }
  }

  // Nothing under the cursor: draw a new bone from here, chained to the selected one unless Alt is held.
  const target = rig ?? ensureLayerRig()
  if (!target) return
  const parentId = event.altKey ? undefined : selectedRigBoneId.value ?? undefined
  const bone = store.addRigBone(target.id, { x: point.x, y: point.y, angle: 90, length: .02, parentId })
  if (!bone) return
  rigDrag = { pointerId: event.pointerId, mode: 'create', boneId: bone.id, origin: { x: point.x, y: point.y, angle: 90, length: .02 }, moved: false }
  store.beginInteractiveEdit()
}

function updateRigDrag(event: PointerEvent) {
  const drag = rigDrag
  const rig = activeRig.value
  const point = rigPointAt(event)
  if (!drag || !rig || !point || drag.pointerId !== event.pointerId) return
  const bone = rig.bones.find((item) => item.id === drag.boneId)
  if (!bone) return
  drag.moved = true

  if (drag.mode === 'create' || drag.mode === 'rest-tip') {
    const { angle, length } = restAimTowards(drag.origin, point, drag.origin.angle)
    store.setRigBoneRest(rig.id, bone.id, { angle, length, ...(drag.mode === 'create' ? { falloff: Math.max(.25, length * 1.6) } : {}) })
    return
  }
  if (drag.mode === 'rest-head') {
    store.setRigBoneRest(rig.id, bone.id, { x: point.x, y: point.y })
    return
  }
  if (drag.mode === 'offset') {
    const offset = poseOffsetTowards(rig, bone, currentTime.value, point)
    store.setRigBonePose(rig.id, bone.id, 'offsetX', offset.x)
    store.setRigBonePose(rig.id, bone.id, 'offsetY', offset.y)
    return
  }
  store.setRigBonePose(rig.id, bone.id, 'rotation', poseRotationTowards(rig, bone, currentTime.value, point))
}

function endRigDrag() {
  const drag = rigDrag
  rigDrag = null
  if (!drag) return
  const rig = activeRig.value
  const bone = rig?.bones.find((item) => item.id === drag.boneId)
  // A click that never became a drag would leave a zero-length bone nobody asked for.
  if (rig && bone && drag.mode === 'create' && bone.length < .04) store.deleteRigBone(rig.id, bone.id)
  store.endInteractiveEdit()
}

function currentCacheScope() {
  return activeClusterId.value ? `cluster:${activeClusterId.value}` : 'project'
}

function renderRequest(time: number, playback: boolean) {
  // A cluster tab is an isolated composition context. Its children are authored in project time,
  // so they keep the same playhead value, but the root node graph must not pull sibling layers
  // back into the frame while the user is editing inside the cluster.
  const editingCluster = Boolean(activeClusterId.value)
  return {
    project: project.value,
    layers: timelineLayers.value,
    scenes3D: scenes3D.value,
    assets: assets.value,
    nodes: editingCluster ? [] : nodes.value,
    nodeConnections: editingCluster ? [] : nodeConnections.value,
    renderRootNodeId: editingCluster ? null : renderRootNodeId.value,
    revision: renderRevision.value,
    cacheScope: currentCacheScope(),
    cacheVersion: store.saveStatus === 'Saved' ? 'saved' : `edit:${renderRevision.value}`,
    rigs: rigs.value,
    time,
    playback,
    width: previewRenderSize.value.width,
    height: previewRenderSize.value.height,
    quality: 'preview' as const,
  }
}

async function drawNow() {
  if (!renderer) return
  try {
    await renderer.requestFrame(renderRequest(currentTime.value, playing.value))
  } catch {
    // A dropped preview frame must never break viewport interaction.
  }
}


async function buildFrameCacheRange() {
  const previousRun = cacheRun
  cacheAbort?.abort()
  await previousRun?.catch(() => undefined)
  await store.flushProjectSave()

  const controller = new AbortController()
  cacheAbort = controller
  const revision = renderRevision.value
  const scope = currentCacheScope()
  const frameRate = Math.max(1, project.value.frameRate)
  const startFrame = Math.max(0, Math.ceil(frameCacheRange.value.start * frameRate))
  const finalProjectFrame = Math.max(0, Math.ceil(project.value.duration * frameRate) - 1)
  const endFrame = Math.min(finalProjectFrame, Math.floor(frameCacheRange.value.end * frameRate))
  const total = Math.max(0, endFrame - startFrame + 1)
  if (!total) return

  const snapshot = JSON.parse(JSON.stringify(renderRequest(0, false))) as ReturnType<typeof renderRequest>
  const detachedCanvas = document.createElement('canvas')
  detachedCanvas.width = snapshot.width
  detachedCanvas.height = snapshot.height
  const { AuroraFrameEngine } = await import('@/engine/rendering/AuroraFrameEngine')
  const backgroundRenderer = new AuroraFrameEngine(detachedCanvas, '/demo/aurora-ridge.png', {
    adaptiveQuality: false,
    onFrameCached: store.recordFrameCached,
  })
  cacheRenderer = backgroundRenderer
  store.beginFrameCache(snapshot.project.id, revision, scope, total)

  try {
    await backgroundRenderer.initialize({ width: snapshot.width, height: snapshot.height, pixelRatio: 1 })
    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      if (controller.signal.aborted || revision !== renderRevision.value || scope !== currentCacheScope()) {
        store.finishFrameCache('cancelled')
        return
      }
      await backgroundRenderer.renderImmediate({ ...snapshot, time: frame / frameRate, cacheWrite: true })
      store.updateFrameCacheProgress(frame - startFrame + 1, total)
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    }
    store.finishFrameCache('ready')
  } catch {
    store.finishFrameCache(controller.signal.aborted ? 'cancelled' : 'error')
  } finally {
    await backgroundRenderer.dispose()
    detachedCanvas.width = 0
    detachedCanvas.height = 0
    if (cacheRenderer === backgroundRenderer) cacheRenderer = null
    if (cacheAbort === controller) cacheAbort = null
  }
}

watch(frameCacheRequestId, () => {
  const run = buildFrameCacheRange()
  cacheRun = run
  void run.finally(() => { if (cacheRun === run) cacheRun = null }).catch(() => undefined)
})

watch(frameCacheCancelId, () => { cacheAbort?.abort() })

watch(frameCacheClearId, async () => {
  cacheAbort?.abort()
  await cacheRun?.catch(() => undefined)
  const { auroraFrameCache } = await import('@/engine/rendering/frameCache')
  await auroraFrameCache.clearProject(project.value.id)
  store.resetFrameCacheDisplay()
})

/** Brush strokes and drags can outpace rendering; the engine keeps only the newest queued frame. */
function draw() {
  void drawNow()
}

function setTransformValue(key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation', value: number, targetLayer?: EditorLayer) {
  const layer = targetLayer ?? selectedLayer.value
  if (!layer) return
  const channel = layer.transform[key]
  const result = setNumericPropertyAtTime(channel, value, currentTime.value, project.value.frameRate, {
    autoKey: store.autoKey,
    selectedKeyframeId: selectedKeyframeId.value,
  })
  if (result.keyframeId) selectedKeyframeId.value = result.keyframeId
}

function scaleAxisForHandle(handle: number): ViewportTransformState['scaleAxis'] {
  if (handle === 4 || handle === 8) return 'x'
  if (handle === 2 || handle === 6) return 'y'
  return 'uniform'
}

function beginViewportTransform(event: PointerEvent, mode: ViewportTransformState['mode'], scaleAxis: ViewportTransformState['scaleAxis'] = 'uniform', targetLayer?: EditorLayer, targetBounds?: DOMRect) {
  if (!['Select', 'Transform'].includes(activeTool.value)) return
  const layer = targetLayer ?? selectedLayer.value
  const box = transformBox.value
  if (event.button !== 0 || !layer || (!box && !targetBounds)) return
  event.preventDefault()
  event.stopPropagation()
  const bounds = targetBounds ?? box!.getBoundingClientRect()
  const centerX = bounds.left + bounds.width / 2
  const centerY = bounds.top + bounds.height / 2
  viewportTransformState = {
    layer,
    mode,
    scaleAxis,
    startX: event.clientX,
    startY: event.clientY,
    centerX,
    centerY,
    startDistance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
    startAxisDistanceX: Math.max(1, Math.abs(event.clientX - centerX)),
    startAxisDistanceY: Math.max(1, Math.abs(event.clientY - centerY)),
    startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
    x: evaluateNumericProperty(layer.transform.x, currentTime.value),
    y: evaluateNumericProperty(layer.transform.y, currentTime.value),
    scaleX: evaluateNumericProperty(layer.transform.scaleX, currentTime.value),
    scaleY: evaluateNumericProperty(layer.transform.scaleY, currentTime.value),
    rotation: evaluateNumericProperty(layer.transform.rotation, currentTime.value),
    moved: false,
  }
  activeTool.value = 'Transform'
  activeTransformMode.value = mode
}

function beginLayerMove(event: PointerEvent, layer: EditorLayer) {
  if (activeTool.value !== 'Select' && activeTool.value !== 'Transform') return
  selectedLayerId.value = layer.id
  selectedKeyframeId.value = null
  beginViewportTransform(event, 'move', 'uniform', layer, (event.currentTarget as HTMLElement).getBoundingClientRect())
}

function beginViewportPan(event: PointerEvent) {
  if (event.button !== 1 && !(event.button === 0 && activeTool.value === 'Hand')) return false
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  isViewportPanning.value = true
  viewportPanState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: viewportPan.value.x, originY: viewportPan.value.y }
  return true
}

function setViewportZoom(value: number) {
  zoom.value = Math.max(10, Math.min(800, Math.round(value)))
}

function resetViewport() {
  zoom.value = 100
  viewportPan.value = { x: 0, y: 0 }
}

function projectPointAt(event: PointerEvent) {
  const bounds = canvas.value?.getBoundingClientRect()
  if (!bounds || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * project.value.width,
    y: ((event.clientY - bounds.top) / bounds.height) * project.value.height,
  }
}

function shapeDrawBounds(state: ShapeDrawState) {
  let dx = state.current.x - state.start.x
  let dy = state.current.y - state.start.y
  if (state.shift) {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    dx = (dx < 0 ? -1 : 1) * size
    dy = (dy < 0 ? -1 : 1) * size
  }
  const left = state.alt ? state.start.x - Math.abs(dx) : Math.min(state.start.x, state.start.x + dx)
  const right = state.alt ? state.start.x + Math.abs(dx) : Math.max(state.start.x, state.start.x + dx)
  const top = state.alt ? state.start.y - Math.abs(dy) : Math.min(state.start.y, state.start.y + dy)
  const bottom = state.alt ? state.start.y + Math.abs(dy) : Math.max(state.start.y, state.start.y + dy)
  return { left, top, width: right - left, height: bottom - top, x: (left + right) / 2, y: (top + bottom) / 2 }
}

const shapePreviewStyle = computed(() => {
  if (!shapeDraw.value) return { display: 'none' }
  const bounds = shapeDrawBounds(shapeDraw.value)
  return {
    left: `${(bounds.left / project.value.width) * 100}%`,
    top: `${(bounds.top / project.value.height) * 100}%`,
    width: `${(bounds.width / project.value.width) * 100}%`,
    height: `${(bounds.height / project.value.height) * 100}%`,
    borderRadius: shapeDraw.value.kind === 'ellipse' ? '50%' : '2px',
  }
})

function pathData(points: ShapePathPoint[], closed = false) {
  const first = points[0]
  if (!first) return ''
  let result = `M ${first.position[0]} ${first.position[1]}`
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const point = points[index]!
    result += ` C ${previous.handleOut[0]} ${previous.handleOut[1]} ${point.handleIn[0]} ${point.handleIn[1]} ${point.position[0]} ${point.position[1]}`
  }
  if (closed && points.length > 2) {
    const last = points.at(-1)!
    result += ` C ${last.handleOut[0]} ${last.handleOut[1]} ${first.handleIn[0]} ${first.handleIn[1]} ${first.position[0]} ${first.position[1]} Z`
  }
  return result
}

const penDraftPath = computed(() => pathData(penDraft.value?.points ?? []))

function closeEnoughToFirst(point: { x: number; y: number }) {
  const first = penDraft.value?.points[0]
  const bounds = canvas.value?.getBoundingClientRect()
  if (!first || !bounds) return false
  const dx = ((point.x - first.position[0]) / project.value.width) * bounds.width
  const dy = ((point.y - first.position[1]) / project.value.height) * bounds.height
  return Math.hypot(dx, dy) <= 10
}

function finishPen(closed: boolean) {
  const points = penDraft.value?.points ?? []
  if (points.length >= 2) store.addPathLayer(points.map((point) => ({ ...point, position: [...point.position], handleIn: [...point.handleIn], handleOut: [...point.handleOut] })), closed)
  penDraft.value = null
  penDrag = null
  activeTool.value = 'Select'
}

function finishPenFromDoubleClick() {
  const points = penDraft.value?.points
  if (!points?.length) return
  const last = points.at(-1)
  const previous = points.at(-2)
  if (last && previous && Math.hypot(last.position[0] - previous.position[0], last.position[1] - previous.position[1]) < 2) points.pop()
  finishPen(false)
}

function selectTool(tool: MotionTool) {
  if (activeTool.value === 'Pen' && tool !== 'Pen' && penDraft.value?.points.length) finishPen(false)
  activeTool.value = tool
}

function onViewportPointerDown(event: PointerEvent) {
  if (beginViewportPan(event)) return
  if (event.button !== 0) return
  const point = projectPointAt(event)
  /*
   * Layer hit targets and the transform box stop propagation, so anything still arriving here with
   * the Select tool is a click on empty composition — which clears the selection, the same way
   * clicking away from a shape does in any editor. Clicks outside the stage entirely count too.
   */
  if (activeTool.value === 'Rig') {
    beginRigInteraction(event)
    return
  }
  if (activeTool.value === 'Select' || activeTool.value === 'Transform') {
    selectedLayerId.value = null
    selectedKeyframeId.value = null
    return
  }
  if (!point) return
  if (activeTool.value === 'Zoom') {
    event.preventDefault()
    setViewportZoom(zoom.value * (event.altKey ? .8 : 1.25))
  } else if (activeTool.value === 'Text') {
    event.preventDefault()
    store.addGeneratedLayer('text', point.x, point.y)
    activeTool.value = 'Select'
  } else if (activeTool.value === 'Rectangle' || activeTool.value === 'Ellipse') {
    event.preventDefault()
    shapeDraw.value = {
      pointerId: event.pointerId,
      kind: activeTool.value === 'Ellipse' ? 'ellipse' : 'rectangle',
      start: point,
      current: point,
      startClientX: event.clientX,
      startClientY: event.clientY,
      shift: event.shiftKey,
      alt: event.altKey,
    }
    canvasWrap.value?.setPointerCapture?.(event.pointerId)
  } else if (activeTool.value === 'Pen') {
    event.preventDefault()
    if (penDraft.value?.points.length && closeEnoughToFirst(point) && penDraft.value.points.length > 2) {
      finishPen(true)
      return
    }
    const next: ShapePathPoint = {
      id: crypto.randomUUID(),
      position: [point.x, point.y],
      handleIn: [point.x, point.y],
      handleOut: [point.x, point.y],
    }
    if (penDraft.value) penDraft.value.points.push(next)
    else penDraft.value = { points: [next] }
    penDrag = { pointerId: event.pointerId, pointId: next.id }
    canvasWrap.value?.setPointerCapture?.(event.pointerId)
  }
}

function onViewportWheel(event: WheelEvent) {
  event.preventDefault()
  setViewportZoom(zoom.value * (event.deltaY < 0 ? 1.12 : .89))
}

function onViewportPointerMove(event: PointerEvent) {
  if (rigDrag) {
    updateRigDrag(event)
    return
  }
  if (viewportPanState) {
    viewportPan.value = {
      x: viewportPanState.originX + event.clientX - viewportPanState.startX,
      y: viewportPanState.originY + event.clientY - viewportPanState.startY,
    }
    return
  }
  if (shapeDraw.value && shapeDraw.value.pointerId === event.pointerId) {
    const point = projectPointAt(event)
    if (point) {
      shapeDraw.value.current = point
      shapeDraw.value.shift = event.shiftKey
      shapeDraw.value.alt = event.altKey
    }
    return
  }
  if (penDrag?.pointerId === event.pointerId && penDraft.value) {
    const point = projectPointAt(event)
    const anchor = penDraft.value.points.find((item) => item.id === penDrag?.pointId)
    if (point && anchor) {
      anchor.handleOut = [point.x, point.y]
      anchor.handleIn = [anchor.position[0] * 2 - point.x, anchor.position[1] * 2 - point.y]
    }
    return
  }
  const state = viewportTransformState
  const stage = canvas.value
  if (!state || !stage) return
  const stageBounds = stage.getBoundingClientRect()
  state.moved ||= Math.abs(event.clientX - state.startX) + Math.abs(event.clientY - state.startY) > 2
  if (state.mode === 'move') {
    let nextX = state.x + ((event.clientX - state.startX) / stageBounds.width) * project.value.width
    let nextY = state.y + ((event.clientY - state.startY) / stageBounds.height) * project.value.height
    if (snap.value) {
      const snapDistanceX = (8 / stageBounds.width) * project.value.width
      const snapDistanceY = (8 / stageBounds.height) * project.value.height
      if (Math.abs(nextX - project.value.width / 2) < snapDistanceX) nextX = project.value.width / 2
      if (Math.abs(nextY - project.value.height / 2) < snapDistanceY) nextY = project.value.height / 2
    }
    setTransformValue('x', Math.max(0, Math.min(project.value.width, nextX)), state.layer)
    setTransformValue('y', Math.max(0, Math.min(project.value.height, nextY)), state.layer)
  } else if (state.mode === 'scale') {
    if (state.scaleAxis === 'uniform') {
      const distance = Math.max(1, Math.hypot(event.clientX - state.centerX, event.clientY - state.centerY))
      const factor = distance / state.startDistance
      setTransformValue('scaleX', Math.max(5, Math.min(500, state.scaleX * factor)), state.layer)
      setTransformValue('scaleY', Math.max(5, Math.min(500, state.scaleY * factor)), state.layer)
    } else if (state.scaleAxis === 'x') {
      const factor = Math.max(1, Math.abs(event.clientX - state.centerX)) / state.startAxisDistanceX
      setTransformValue('scaleX', Math.max(5, Math.min(500, state.scaleX * factor)), state.layer)
    } else {
      const factor = Math.max(1, Math.abs(event.clientY - state.centerY)) / state.startAxisDistanceY
      setTransformValue('scaleY', Math.max(5, Math.min(500, state.scaleY * factor)), state.layer)
    }
  } else {
    const angle = Math.atan2(event.clientY - state.centerY, event.clientX - state.centerX)
    let rotation = state.rotation + ((angle - state.startAngle) * 180) / Math.PI
    if (event.shiftKey) rotation = Math.round(rotation / 15) * 15
    setTransformValue('rotation', rotation, state.layer)
  }
}

function endViewportTransform(event?: PointerEvent) {
  if (rigDrag && (!event || rigDrag.pointerId === event.pointerId)) {
    if (canvasWrap.value?.hasPointerCapture?.(rigDrag.pointerId)) canvasWrap.value.releasePointerCapture(rigDrag.pointerId)
    endRigDrag()
  }
  if (shapeDraw.value && (!event || shapeDraw.value.pointerId === event.pointerId)) {
    const state = shapeDraw.value
    const bounds = shapeDrawBounds(state)
    const moved = Math.hypot((event?.clientX ?? state.startClientX) - state.startClientX, (event?.clientY ?? state.startClientY) - state.startClientY) > 3
    if (moved && bounds.width > 1 && bounds.height > 1) store.addGeneratedLayer('shape', bounds.x, bounds.y, state.kind, { width: bounds.width, height: bounds.height })
    if (canvasWrap.value?.hasPointerCapture?.(state.pointerId)) canvasWrap.value.releasePointerCapture(state.pointerId)
    shapeDraw.value = null
    activeTool.value = 'Select'
  }
  if (penDrag && (!event || penDrag.pointerId === event.pointerId)) {
    if (canvasWrap.value?.hasPointerCapture?.(penDrag.pointerId)) canvasWrap.value.releasePointerCapture(penDrag.pointerId)
    penDrag = null
  }
  if (viewportTransformState?.moved) store.markChanged()
  if (viewportPanState && canvasWrap.value?.hasPointerCapture?.(viewportPanState.pointerId)) canvasWrap.value.releasePointerCapture(viewportPanState.pointerId)
  viewportTransformState = null
  viewportPanState = null
  isViewportPanning.value = false
  activeTransformMode.value = null
}

function onViewerKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.matches('input, textarea')) return
  if (activeTool.value !== 'Pen') return
  if (event.key === 'Enter' && penDraft.value?.points.length) {
    event.preventDefault()
    finishPen(false)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    penDraft.value = null
    penDrag = null
    activeTool.value = 'Select'
  } else if ((event.key === 'Backspace' || event.key === 'Delete') && penDraft.value?.points.length) {
    event.preventDefault()
    penDraft.value.points.pop()
    if (!penDraft.value.points.length) penDraft.value = null
  }
}

onMounted(async () => {
  await nextTick()
  if (!canvas.value) return
  const { AuroraFrameEngine } = await import('@/engine/rendering/AuroraFrameEngine')
  renderer = new AuroraFrameEngine(canvas.value, '/demo/aurora-ridge.png', { onFrameCached: store.recordFrameCached })
  await renderer.initialize({ ...previewRenderSize.value, pixelRatio: 1 })
  if (canvasWrap.value) {
    resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return
      viewportSize.value = { width: entry.contentRect.width, height: entry.contentRect.height }
    })
    resizeObserver.observe(canvasWrap.value)
  }
  window.addEventListener('pointermove', onViewportPointerMove)
  window.addEventListener('pointerup', endViewportTransform)
  window.addEventListener('pointercancel', endViewportTransform)
  window.addEventListener('keydown', onViewerKeydown)
  draw()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('pointermove', onViewportPointerMove)
  window.removeEventListener('pointerup', endViewportTransform)
  window.removeEventListener('pointercancel', endViewportTransform)
  window.removeEventListener('keydown', onViewerKeydown)
  void renderer?.dispose()
  cacheAbort?.abort()
  renderer = null
})

/*
 * A deep watch over the whole project is what keeps the viewport honest while the user edits: it
 * catches a keyframe value or a material channel written straight onto the reactive tree. The cost
 * is that every trigger re-traverses every layer, scene object, node and rig to recollect
 * dependencies — and the playhead is a trigger, so playback paid that whole-project walk once per
 * frame on top of the render.
 *
 * Nothing in those structures can change while the transport runs, so the deep watch is suspended
 * for the duration and the playhead alone drives redraws.
 */
const structureSources = [project, activeClusterId, timelineLayers, scenes3D, nodes, nodeConnections, renderRootNodeId, renderRevision, rigs]
let stopStructureWatch: (() => void) | null = null

function watchStructures() {
  stopStructureWatch ??= watch(structureSources, draw, { deep: true })
}

function unwatchStructures() {
  stopStructureWatch?.()
  stopStructureWatch = null
}

watch(currentTime, draw)
watch(playing, (isPlaying) => {
  if (isPlaying) return unwatchStructures()
  watchStructures()
  // An edit landing during playback was never observed, so the frame on pause has to be rebuilt.
  draw()
}, { immediate: true })

onBeforeUnmount(unwatchStructures)
</script>

<template>
  <section class="viewer-panel">
    <div class="viewer-toolbar">
      <div class="tool-group">
        <IconButton v-for="tool in tools" :key="tool.name" :icon="tool.icon" :label="tool.name" :active="activeTool === tool.name" @click="selectTool(tool.name)" />
      </div>
      <span class="toolbar-divider" />
      <IconButton :icon="BoxSelect" label="Safe guides" :active="showGuides" @click="showGuides = !showGuides" />
      <IconButton :icon="Grid3X3" label="Grid overlay" :active="showGrid" @click="showGrid = !showGrid" />
      <IconButton :icon="Crosshair" label="Snap" :active="snap" @click="snap = !snap" />
      <span class="toolbar-divider" />
      <IconButton :icon="ZoomOut" label="Zoom out viewport" @click="setViewportZoom(zoom - 10)" />
      <span class="viewport-zoom-label">{{ zoom }}%</span>
      <IconButton :icon="ZoomIn" label="Zoom in viewport" @click="setViewportZoom(zoom + 10)" />
      <div class="toolbar-spacer" />
      <button class="viewer-select" type="button">Full <ChevronDown :size="11" /></button>
      <button class="viewer-select" type="button">RGB <ChevronDown :size="11" /></button>
      <button class="viewer-select" type="button" title="Fit composition in viewer" @click="resetViewport">Fit</button>
      <IconButton :icon="Maximize2" label="Full screen viewer" />
    </div>

    <div ref="canvasWrap" class="canvas-viewport" :class="{ 'show-grid': showGrid, panning: isViewportPanning, 'hand-tool': activeTool === 'Hand', 'zoom-tool': activeTool === 'Zoom', 'drawing-tool': activeTool === 'Rectangle' || activeTool === 'Ellipse', 'pen-tool': activeTool === 'Pen', 'rig-tool': activeTool === 'Rig' }" @pointerdown="onViewportPointerDown" @dblclick.prevent="activeTool === 'Pen' && finishPenFromDoubleClick()" @wheel="onViewportWheel" @auxclick.prevent>
      <div class="canvas-stage" :style="stageStyle">
        <canvas ref="canvas" :width="previewRenderSize.width" :height="previewRenderSize.height" aria-label="Composition preview" />
        <div v-if="shapeDraw" class="shape-draw-preview" :style="shapePreviewStyle" />
        <svg v-if="penDraft" class="pen-draft-overlay" :viewBox="`0 0 ${project.width} ${project.height}`" preserveAspectRatio="none" aria-label="Path being drawn">
          <path :d="penDraftPath" />
          <g v-for="point in penDraft.points" :key="point.id">
            <line :x1="point.handleIn[0]" :y1="point.handleIn[1]" :x2="point.handleOut[0]" :y2="point.handleOut[1]" />
            <circle class="handle" :cx="point.handleIn[0]" :cy="point.handleIn[1]" r="5" />
            <circle class="handle" :cx="point.handleOut[0]" :cy="point.handleOut[1]" r="5" />
            <circle class="anchor" :cx="point.position[0]" :cy="point.position[1]" r="7" />
          </g>
        </svg>
        <svg v-if="rigLayer && (activeTool === 'Rig' || rigBoneShapes.length)" class="rig-overlay" :class="{ passive: activeTool !== 'Rig' }" :viewBox="`0 0 ${project.width} ${project.height}`" preserveAspectRatio="none" aria-label="Rig skeleton">
          <g :transform="rigGroupTransform">
            <rect class="rig-bounds" x="-1" y="-1" width="2" height="2" />
            <g v-for="shape in rigBoneShapes" :key="shape.id" class="rig-bone" :class="{ selected: shape.id === selectedRigBoneId }">
              <line :x1="shape.head.x" :y1="shape.head.y" :x2="shape.tip.x" :y2="shape.tip.y" />
              <circle class="rig-head" :cx="shape.head.x" :cy="shape.head.y" :r="rigHandleRadius" />
              <circle class="rig-tip" :cx="shape.tip.x" :cy="shape.tip.y" :r="rigHandleRadius * .8" />
            </g>
          </g>
        </svg>
        <div v-if="showGuides" class="safe-guides"><span /><span /></div>
        <button
          v-for="layer in interactiveLayers"
          :key="layer.id"
          class="layer-hit-target"
          :class="{ selected: selectedLayerId === layer.id }"
          type="button"
          :style="layerOverlayStyle(layer)"
          :title="`Select and move ${layer.name}`"
          @pointerdown="beginLayerMove($event, layer)"
        />
        <div
          v-if="activeSelection && ['text', 'shape', 'image', 'video', 'cluster'].includes(activeSelection.type)"
          ref="transformBox"
          class="transform-box"
          :class="[activeTransformMode, { 'background-layer': activeSelection.type === 'video' }]"
          :style="selectionStyle"
          title="Drag to move"
          @pointerdown="beginViewportTransform($event, 'move')"
        >
          <i
            v-for="handle in 8"
            :key="handle"
            :class="`handle h-${handle}`"
            :title="scaleAxisForHandle(handle) === 'uniform' ? 'Scale proportionally' : scaleAxisForHandle(handle) === 'x' ? 'Scale width' : 'Scale height'"
            @pointerdown="beginViewportTransform($event, 'scale', scaleAxisForHandle(handle))"
          />
          <i class="rotation-line" title="Drag to rotate" @pointerdown="beginViewportTransform($event, 'rotate')" />
          <span class="anchor-point"><Crosshair :size="13" /></span>
        </div>
      </div>
      <div class="viewport-badge"><span class="live-dot" /> Active camera</div>
      <div class="viewport-help">Middle-drag: pan · Wheel: zoom<span v-if="activeTool === 'Text'"> · Click composition to create text</span><span v-else-if="activeTool === 'Rectangle' || activeTool === 'Ellipse'"> · Drag to draw · Shift: equal sides · Alt: from centre</span><span v-else-if="activeTool === 'Pen'"> · Click: corner · Drag: Bézier handles · Click first point to close · Enter: finish</span><span v-else-if="activeTool === 'Rig'"> · Drag empty space: new bone (chains to selection, Alt for a root) · Drag tip: rotate · Drag head: shift · Shift+drag: edit rest pose</span></div>
    </div>

    <div class="viewer-controls">
      <div class="time-display"><span>{{ timecode }}</span><small>{{ Math.floor(currentTime * project.frameRate) }}f</small></div>
      <div class="transport">
        <IconButton :icon="SkipBack" label="Previous frame" @click="store.stepFrame(-1)" />
        <IconButton :icon="playing ? Pause : Play" :label="playing ? 'Pause' : 'Play'" :active="playing" @click="store.togglePlayback()" />
        <IconButton :icon="SkipForward" label="Next frame" @click="store.stepFrame(1)" />
        <IconButton :icon="RotateCcw" label="Loop playback" :active="loop" @click="loop = !loop" />
      </div>
      <div class="viewer-status">
        <IconButton :icon="audioEnabled ? Volume2 : VolumeX" label="Toggle preview audio" :active="audioEnabled" @click="audioEnabled = !audioEnabled" />
        <span>Draft off</span><span class="separator" />
        <span>{{ zoom }}%</span><span class="separator" />
        <strong>{{ project.frameRate.toFixed(2) }} fps</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.viewer-panel { display: flex; height: 100%; min-height: 0; flex-direction: column; background: #090b0f; }
.viewer-toolbar { display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 2px; padding: 0 7px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-panel-alt); }
.tool-group { display: flex; gap: 1px; }.toolbar-divider { width: 1px; height: 20px; margin: 0 4px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.viewport-zoom-label { width: 32px; color: var(--text-muted); font-size: 8px; text-align: center; }
.viewer-select { display: flex; height: 25px; align-items: center; gap: 6px; padding: 0 6px; color: var(--text-secondary); background: #171920; border: 1px solid var(--border-strong); border-radius: 4px; font: inherit; font-size: 9.5px; cursor: pointer; }
.viewer-select:hover { color: var(--text-primary); background: var(--bg-hover); }
.canvas-viewport { position: relative; display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; padding: 24px; overflow: hidden; background-color: #08090c; background-image: linear-gradient(45deg, #0c0e13 25%, transparent 25%), linear-gradient(-45deg, #0c0e13 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #0c0e13 75%), linear-gradient(-45deg, transparent 75%, #0c0e13 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; touch-action: none; }
.canvas-viewport.drawing-tool, .canvas-viewport.pen-tool, .canvas-viewport.rig-tool { cursor: crosshair; }.canvas-viewport.drawing-tool .layer-hit-target, .canvas-viewport.drawing-tool .transform-box, .canvas-viewport.pen-tool .layer-hit-target, .canvas-viewport.pen-tool .transform-box, .canvas-viewport.rig-tool .layer-hit-target, .canvas-viewport.rig-tool .transform-box { pointer-events: none; }
.canvas-viewport.show-grid::after { position: absolute; inset: 0; background-image: linear-gradient(rgb(142 154 225 / .08) 1px, transparent 1px), linear-gradient(90deg, rgb(142 154 225 / .08) 1px, transparent 1px); background-size: 36px 36px; content: ''; pointer-events: none; }
.canvas-viewport.hand-tool { cursor: grab; }.canvas-viewport.zoom-tool { cursor: zoom-in; }.canvas-viewport.panning { cursor: grabbing; user-select: none; }.canvas-stage { position: relative; flex: 0 0 auto; box-shadow: 0 15px 45px rgb(0 0 0 / .55), 0 0 0 1px #30333d; transform-origin: center; }
.canvas-stage canvas { display: block; width: 100%; height: 100%; }
.shape-draw-preview { position: absolute; z-index: 12; background: rgb(140 155 255 / .16); border: 1px solid #a5b4fc; box-shadow: 0 0 0 1px rgb(13 15 24 / .55); pointer-events: none; }
.pen-draft-overlay { position: absolute; z-index: 12; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }.pen-draft-overlay path { fill: rgb(140 155 255 / .1); stroke: #a5b4fc; stroke-width: 3; vector-effect: non-scaling-stroke; }.pen-draft-overlay line { stroke: #717da9; stroke-width: 1; vector-effect: non-scaling-stroke; }.pen-draft-overlay circle.handle { fill: #151821; stroke: #8c9bff; stroke-width: 2; vector-effect: non-scaling-stroke; }.pen-draft-overlay circle.anchor { fill: #e0e7ff; stroke: #4f5d9d; stroke-width: 2; vector-effect: non-scaling-stroke; }
.rig-overlay.passive { opacity: .38; }.rig-overlay { position: absolute; z-index: 13; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }.rig-overlay .rig-bounds { fill: rgb(199 154 224 / .05); stroke: rgb(199 154 224 / .45); stroke-dasharray: 6 4; stroke-width: 1; vector-effect: non-scaling-stroke; }.rig-bone line { stroke: #c79ae0; stroke-linecap: round; stroke-width: 3; vector-effect: non-scaling-stroke; }.rig-bone.selected line { stroke: #ffd9a0; stroke-width: 4; }.rig-head { fill: #1a1420; stroke: #c79ae0; stroke-width: 2; vector-effect: non-scaling-stroke; }.rig-tip { fill: #c79ae0; stroke: #1a1420; stroke-width: 1; vector-effect: non-scaling-stroke; }.rig-bone.selected .rig-head { stroke: #ffd9a0; }.rig-bone.selected .rig-tip { fill: #ffd9a0; }
.safe-guides { position: absolute; inset: 5%; border: 1px solid rgb(230 233 246 / .22); pointer-events: none; }.safe-guides span:first-child { position: absolute; inset: 5%; border: 1px dashed rgb(230 233 246 / .15); }.safe-guides span:last-child::before, .safe-guides span:last-child::after { position: absolute; top: 50%; left: 50%; background: rgb(230 233 246 / .18); content: ''; }.safe-guides span:last-child::before { width: 1px; height: 12px; transform: translateY(-6px); }.safe-guides span:last-child::after { width: 12px; height: 1px; transform: translateX(-6px); }
.layer-hit-target { position: absolute; z-index: 2; padding: 0; background: transparent; border: 0; outline: 0; cursor: move; touch-action: none; }.layer-hit-target:hover { box-shadow: inset 0 0 0 1px rgb(165 180 252 / .45); }.layer-hit-target.selected { pointer-events: none; }.transform-box { position: absolute; z-index: 4; width: 48%; height: 13%; border: 1px solid #9aa8ff; box-shadow: 0 0 0 1px rgb(20 24 39 / .45); cursor: move; touch-action: none; user-select: none; }.transform-box.background-layer { z-index: 1; }.transform-box.move { cursor: grabbing; }.transform-box.scale { cursor: nwse-resize; }.transform-box.rotate { cursor: crosshair; }.handle { position: absolute; z-index: 3; width: 8px; height: 8px; background: #dce2ff; border: 1px solid #6978d0; pointer-events: auto; }.handle:hover { background: #fff; box-shadow: 0 0 0 2px rgb(154 168 255 / .25); }.h-1 { top: -5px; left: -5px; cursor: nwse-resize; }.h-2 { top: -5px; left: 50%; cursor: ns-resize; }.h-3 { top: -5px; right: -5px; cursor: nesw-resize; }.h-4 { top: 50%; right: -5px; cursor: ew-resize; }.h-5 { right: -5px; bottom: -5px; cursor: nwse-resize; }.h-6 { bottom: -5px; left: 50%; cursor: ns-resize; }.h-7 { bottom: -5px; left: -5px; cursor: nesw-resize; }.h-8 { top: 50%; left: -5px; cursor: ew-resize; }.rotation-line { position: absolute; bottom: -29px; left: 50%; width: 11px; height: 29px; border-left: 1px solid #9aa8ff; pointer-events: auto; cursor: crosshair; }.rotation-line::after { position: absolute; bottom: -1px; left: -5px; width: 9px; height: 9px; background: #dce2ff; border: 1px solid #6978d0; border-radius: 50%; content: ''; }.rotation-line:hover::after { background: #fff; box-shadow: 0 0 0 2px rgb(154 168 255 / .25); }.anchor-point { position: absolute; top: 50%; left: 50%; display: grid; color: #edc68b; transform: translate(-50%, -50%); pointer-events: none; }
.viewport-badge { position: absolute; top: 8px; left: 9px; display: flex; align-items: center; gap: 5px; padding: 4px 7px; color: #9ba0aa; background: rgb(12 14 19 / .72); border: 1px solid #262a32; border-radius: 3px; font-size: 8.5px; backdrop-filter: blur(5px); }.live-dot { width: 5px; height: 5px; border-radius: 50%; background: #7eb89f; }
.viewport-help { position: absolute; right: 9px; bottom: 8px; padding: 4px 6px; color: #767c88; background: rgb(12 14 19 / .76); border: 1px solid #252a33; border-radius: 3px; font-size: 7.5px; pointer-events: none; }
.viewer-controls { display: grid; height: 35px; flex: 0 0 auto; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 8px; border-top: 1px solid var(--border-subtle); background: #111319; }.time-display { display: flex; align-items: baseline; gap: 7px; color: #dce1ec; font-variant-numeric: tabular-nums; }.time-display span { font-size: 11px; font-weight: 580; letter-spacing: .04em; }.time-display small { color: var(--text-muted); font-size: 8.5px; }.transport { display: flex; gap: 2px; }.viewer-status { display: flex; align-items: center; justify-content: flex-end; gap: 7px; color: var(--text-muted); font-size: 8.5px; }.viewer-status strong { color: #72b295; font-weight: 550; }.separator { width: 1px; height: 12px; background: var(--border-subtle); }
</style>
