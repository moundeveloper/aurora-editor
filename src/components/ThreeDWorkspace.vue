<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ArrowLeftToLine, ArrowRightToLine, Box, Camera, Crosshair, Grid3X3, Move3D, Plus, Rotate3D, Scaling, Spline, Sun, Trash2, View } from '@lucide/vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls, type TransformControlsMode } from 'three/addons/controls/TransformControls.js'
import { useEditorStore } from '@/stores/editor'
import { planeHalfExtents, ThreeSceneRuntimeRegistry, type Scene3DRuntime } from '@/engine/scene3d/ThreeSceneRuntime'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { applyMatrix, boneTransforms } from '@/engine/rig/skeleton'
import { poseOffsetTowards, poseRotationTowards, restAimTowards } from '@/engine/rig/rigPosing'
import { pathTransformComponents, sampleLocalPath } from '@/engine/scene3d/pathEvaluation'
import { movePathHandle, movePathPoint, type PathHandleKey, type PathVector } from '@/engine/scene3d/pathEditing'
import { AuroraSceneRenderPipeline } from '@/engine/rendering/AuroraSceneRenderPipeline'
import type { Aurora3DObject, Aurora3DPath, Aurora3DPathPoint, Aurora3DScene, AuroraRig } from '@/models/editor'
import IconButton from './common/IconButton.vue'

const store = useEditorStore()
const { selectedLayer, selectedScene, selectedSceneEntityId, currentTime, playing, assets, rigs } = storeToRefs(store)
const viewport = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const transformMode = ref<TransformControlsMode>('translate')
const cameraView = ref('Perspective')
const stats = ref({ calls: 0, triangles: 0 })
interface PathPointSelection { pathId: string; pointId: string; target: PathHandleKey }
/** Point-level selection lives beside the entity selection; it only applies while its path stays selected. */
const pathSelection = ref<PathPointSelection | null>(null)
const activePathPoint = computed(() => pathSelection.value?.pathId === selectedSceneEntityId.value ? pathSelection.value : null)

const PATH_GROUP_PREFIX = 'aurora-editor-path-'
const RIG_GROUP_PREFIX = 'aurora-editor-rig-'
const INFLUENCE_GROUP_PREFIX = 'aurora-editor-influence-'

const assetMap = computed(() => new Map(assets.value.map((asset) => [asset.id, asset])))

const runtimeRegistry = new ThreeSceneRuntimeRegistry(() => renderViewport())
let renderer: THREE.WebGLRenderer | null = null
let scenePipeline: AuroraSceneRenderPipeline | null = null
let perspectiveCamera: THREE.PerspectiveCamera | null = null
let orthographicCamera: THREE.OrthographicCamera | null = null
let editorCamera: THREE.Camera | null = null
let orbit: OrbitControls | null = null
let transform: TransformControls | null = null
let runtime: Scene3DRuntime | null = null
let resizeObserver: ResizeObserver | null = null
let pickStart: { x: number; y: number } | null = null
let skipNextPick = false
let navigationPointerId: number | null = null
let transformDirty = false

interface PathDragState {
  pathId: string
  pointId: string
  target: PathHandleKey
  group: THREE.Object3D
  plane: THREE.Plane
  grabOffset: THREE.Vector3
  pointerId: number
  moved: boolean
  position: PathVector
}
let pathDrag: PathDragState | null = null

/** A direct grab on a rig bone or an influence centre, dragged on a plane facing the camera. */
interface GizmoDragState {
  pointerId: number
  kind: 'rig' | 'influence'
  objectId: string
  rigId: string
  boneId: string
  target: 'head' | 'tip'
  influenceId: string
  /** Shift edits where the skeleton rests instead of how it is posed. */
  rest: boolean
  host: THREE.Object3D
  plane: THREE.Plane
  grabOffset: THREE.Vector3
}
let gizmoDrag: GizmoDragState | null = null

const activeSceneLabel = computed(() => selectedScene.value?.name ?? 'No 3D scene')

const viewportHelp = computed(() => {
  if (selectedPath.value) return 'Click an anchor or handle to edit it · drag with the gizmo · G/R/S: transform'
  const object = selectedScene.value?.objects.find((item) => item.id === selectedSceneEntityId.value)
  const rigged = object?.rigId && rigs.value.some((rig) => rig.id === object.rigId && rig.bones.length)
  if (rigged) return 'Drag a bone tip to rotate · drag its head to shift · Shift+drag edits the rest pose'
  if (object && radialInfluences(object).length) return 'Drag the green marker to move the radial array centre · G/R/S: transform'
  if (selectedCamera.value) return 'Ctrl+Alt+C snaps this camera to the current view · Orbit: left-drag · Zoom: wheel'
  return 'Orbit: left-drag · Pan: middle-drag · Zoom: wheel · G/R/S: transform'
})

function makeCameraOutline(id: string) {
  const corners = [[-.65, .4, -1], [.65, .4, -1], [.65, -.4, -1], [-.65, -.4, -1]] as const
  const segments: number[] = []
  corners.forEach((corner) => segments.push(0, 0, 0, ...corner))
  ;[[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([from, to]) => segments.push(...corners[from!]!, ...corners[to!]!))
  segments.push(-.3, .4, -1, 0, .68, -1, 0, .68, -1, .3, .4, -1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3))
  const outline = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#7eb6ff', depthTest: false, transparent: true, opacity: .9 }))
  outline.name = `aurora-editor-camera-helper-${id}`
  outline.userData = { editorOnly: true, auroraId: id }
  outline.renderOrder = 20
  return outline
}

function disposeHelperRoot(root: THREE.Object3D) {
  root.traverse((object) => {
    if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) object.geometry.dispose()
    if (!('material' in object)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => { if (material instanceof THREE.Material) material.dispose() })
  })
  root.removeFromParent()
}

function disposeEditorHelpers(target: Scene3DRuntime | null) {
  if (!target) return
  const transformHelper = transform?.getHelper()
  const roots: THREE.Object3D[] = []
  target.scene.traverse((object) => {
    if (object !== transformHelper && object.userData.editorOnly && !object.parent?.userData.editorOnly) roots.push(object)
  })
  roots.forEach(disposeHelperRoot)
}

const pathSignature = (path: Aurora3DPath) => `${path.points.map((point) => point.id).join(',')}|${path.closed}`

function makePathControl(path: Aurora3DPath, point: Aurora3DPathPoint, target: PathHandleKey) {
  const anchor = target === 'position'
  const mesh = new THREE.Mesh(
    anchor ? new THREE.BoxGeometry(.15, .15, .15) : new THREE.SphereGeometry(.095, 12, 8),
    new THREE.MeshBasicMaterial({ color: anchor ? path.color : '#aab4ff', depthTest: false, transparent: true, opacity: anchor ? 1 : .85 }),
  )
  mesh.name = `${target}-${point.id}`
  mesh.userData = { editorOnly: true, auroraId: path.id, pathPointId: point.id, pathTarget: target }
  mesh.renderOrder = 22
  return mesh
}

function makePathHelper(path: Aurora3DPath) {
  const group = new THREE.Group()
  group.name = `${PATH_GROUP_PREFIX}${path.id}`
  group.userData = { editorOnly: true, auroraId: path.id, signature: pathSignature(path) }

  const curve = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: path.color, depthTest: false, transparent: true, opacity: .95 }),
  )
  curve.name = 'path-curve'
  curve.userData = { editorOnly: true, auroraId: path.id }
  curve.renderOrder = 20
  group.add(curve)

  const bars = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#5f6b8c', depthTest: false, transparent: true, opacity: .8 }),
  )
  bars.name = 'path-handle-bars'
  bars.userData = { editorOnly: true, auroraId: path.id }
  bars.renderOrder = 21
  group.add(bars)

  path.points.forEach((point) => {
    group.add(makePathControl(path, point, 'position'))
    group.add(makePathControl(path, point, 'handleIn'))
    group.add(makePathControl(path, point, 'handleOut'))
  })
  return group
}

/** The control being moved right now — by a direct grab or by the gizmo — so the curve previews it live. */
function draggedPathControl(path: Aurora3DPath) {
  if (pathDrag?.pathId === path.id) {
    return { pointId: pathDrag.pointId, target: pathDrag.target, position: pathDrag.position }
  }
  const object = transform?.object
  if (!transform?.dragging || !object?.userData.pathPointId || object.userData.auroraId !== path.id) return null
  return {
    pointId: object.userData.pathPointId as string,
    target: object.userData.pathTarget as PathHandleKey,
    position: [object.position.x, object.position.y, object.position.z] as PathVector,
  }
}

/** Applies the in-flight drag to a copy of the points, using the same rules as the committed edit. */
function previewPathPoints(path: Aurora3DPath) {
  const points = path.points.map((point) => ({
    ...point,
    position: [...point.position] as PathVector,
    handleIn: [...point.handleIn] as PathVector,
    handleOut: [...point.handleOut] as PathVector,
  }))
  const dragged = draggedPathControl(path)
  const point = dragged ? points.find((item) => item.id === dragged.pointId) : undefined
  if (dragged && point) {
    if (dragged.target === 'position') movePathPoint(point, dragged.position)
    else movePathHandle(point, dragged.target, dragged.position)
  }
  return points
}

function updatePathHelper(group: THREE.Object3D, path: Aurora3DPath, time: number) {
  const { position, rotation, scale } = pathTransformComponents(path.transform, time)
  group.position.copy(position)
  group.rotation.copy(rotation)
  group.scale.copy(scale)
  group.visible = path.visible && selectedLayer.value?.visible !== false

  const points = previewPathPoints(path)
  const curve = group.getObjectByName('path-curve') as THREE.Line | undefined
  if (curve) {
    curve.geometry.setFromPoints(sampleLocalPath({ ...path, points }))
    ;(curve.material as THREE.LineBasicMaterial).color.set(path.color)
  }

  const selectedEntity = selectedSceneEntityId.value === path.id
  const selection = activePathPoint.value
  const bars: number[] = []
  points.forEach((point) => {
    const anchor = group.getObjectByName(`position-${point.id}`)
    if (anchor) {
      anchor.position.set(...point.position)
      anchor.scale.setScalar(selection?.pointId === point.id && selection.target === 'position' ? 1.6 : 1)
      ;((anchor as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(path.color)
    }
    ;(['handleIn', 'handleOut'] as const).forEach((target) => {
      const control = group.getObjectByName(`${target}-${point.id}`)
      if (!control) return
      control.visible = selectedEntity && point.mode === 'smooth'
      control.position.set(...point[target])
      control.scale.setScalar(selection?.pointId === point.id && selection.target === target ? 1.6 : 1)
      if (control.visible) bars.push(...point.position, ...point[target])
    })
  })

  const handleBars = group.getObjectByName('path-handle-bars') as THREE.LineSegments | undefined
  if (handleBars) {
    handleBars.visible = selectedEntity
    handleBars.geometry.setAttribute('position', new THREE.Float32BufferAttribute(bars, 3))
    handleBars.geometry.computeBoundingSphere()
  }
}

function syncPathHelpers(target: Scene3DRuntime, sceneDefinition: Aurora3DScene) {
  const paths = sceneDefinition.paths ?? []
  const live = new Set(paths.map((path) => path.id))
  target.scene.children
    .filter((child) => child.name.startsWith(PATH_GROUP_PREFIX) && !live.has(child.userData.auroraId as string))
    .forEach(disposeHelperRoot)
  paths.forEach((path) => {
    let group = target.scene.getObjectByName(`${PATH_GROUP_PREFIX}${path.id}`)
    if (group && group.userData.signature !== pathSignature(path)) {
      disposeHelperRoot(group)
      group = undefined
    }
    if (!group) {
      group = makePathHelper(path)
      target.scene.add(group)
    }
    updatePathHelper(group, path, currentTime.value)
  })
}

const rigHelperSignature = (rig: AuroraRig) => rig.bones.map((bone) => bone.id).join(',')

function makeRigHandle(kind: 'head' | 'tip', objectId: string, rigId: string, boneId: string) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(kind === 'head' ? .075 : .055, 12, 8),
    new THREE.MeshBasicMaterial({ color: kind === 'head' ? '#c79ae0' : '#efd7ff', depthTest: false, transparent: true, opacity: .95 }),
  )
  mesh.name = `${kind}-${boneId}`
  mesh.userData = { editorOnly: true, auroraId: objectId, rigId, rigBoneId: boneId, rigTarget: kind }
  mesh.renderOrder = 24
  return mesh
}

/** Bones are drawn as children of the plane they bend, so they inherit its transform for free. */
function makeRigHelper(objectId: string, rig: AuroraRig) {
  const group = new THREE.Group()
  group.name = `${RIG_GROUP_PREFIX}${objectId}`
  group.userData = { editorOnly: true, auroraId: objectId, signature: rigHelperSignature(rig) }
  const shafts = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#c79ae0', depthTest: false, transparent: true, opacity: .9 }),
  )
  shafts.name = 'rig-shafts'
  shafts.userData = { editorOnly: true }
  shafts.renderOrder = 23
  group.add(shafts)
  rig.bones.forEach((bone) => {
    group.add(makeRigHandle('head', objectId, rig.id, bone.id))
    group.add(makeRigHandle('tip', objectId, rig.id, bone.id))
  })
  return group
}

function updateRigHelper(group: THREE.Object3D, object: Aurora3DObject, rig: AuroraRig, time: number) {
  const { halfWidth, halfHeight } = planeHalfExtents(object, assetMap.value)
  const transforms = boneTransforms(rig, time)
  const segments: number[] = []
  // A hair in front of the card, so the handles never fight the plane for depth.
  const toLocal = (point: { x: number; y: number }) => new THREE.Vector3(point.x * halfWidth, point.y * halfHeight, .02)
  rig.bones.forEach((bone) => {
    const world = transforms.get(bone.id)?.world
    const head = toLocal(world ? applyMatrix(world, 0, 0) : { x: bone.x, y: bone.y })
    const tip = toLocal(world ? applyMatrix(world, bone.length, 0) : { x: bone.x, y: bone.y })
    segments.push(head.x, head.y, head.z, tip.x, tip.y, tip.z)
    const selected = store.selectedRigBoneId === bone.id
    ;([['head', head], ['tip', tip]] as const).forEach(([kind, position]) => {
      const handle = group.getObjectByName(`${kind}-${bone.id}`) as THREE.Mesh | undefined
      if (!handle) return
      handle.position.copy(position)
      handle.scale.setScalar(selected ? 1.45 : 1)
      ;(handle.material as THREE.MeshBasicMaterial).color.set(selected ? '#ffd9a0' : kind === 'head' ? '#c79ae0' : '#efd7ff')
    })
  })
  const shafts = group.getObjectByName('rig-shafts') as THREE.LineSegments | undefined
  if (shafts) {
    shafts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3))
    shafts.geometry.computeBoundingSphere()
  }
}

function syncRigHelpers(target: Scene3DRuntime, sceneDefinition: Aurora3DScene) {
  sceneDefinition.objects.forEach((object) => {
    const mesh = target.objects.get(object.id)
    if (!mesh) return
    const rig = object.rigId ? rigs.value.find((item) => item.id === object.rigId) : undefined
    const usable = Boolean(rig?.bones.length) && object.primitive === 'plane'
    let group = mesh.getObjectByName(`${RIG_GROUP_PREFIX}${object.id}`)
    if (group && (!usable || group.userData.signature !== rigHelperSignature(rig!))) {
      disposeHelperRoot(group)
      group = undefined
    }
    if (!usable || !rig) return
    if (!group) {
      group = makeRigHelper(object.id, rig)
      mesh.add(group)
    }
    // Only the selected plane shows its skeleton; every rig at once would bury the scene.
    group.visible = selectedSceneEntityId.value === object.id
    if (group.visible) updateRigHelper(group, object, rig, currentTime.value)
  })
}

const radialInfluences = (object: Aurora3DObject) =>
  (object.influences ?? []).filter((influence) => influence.type === 'radial-array' && influence.enabled)

const influenceParameterValue = (object: Aurora3DObject, influenceId: string, key: string, fallback: number) => {
  const property = (object.influences ?? []).find((item) => item.id === influenceId)?.parameters[key]
  return property ? evaluateNumericProperty(property, currentTime.value) : fallback
}

/** The centre a radial array sweeps around, shown where it actually is and draggable from there. */
function makeInfluenceHelper(objectId: string, influenceId: string) {
  const group = new THREE.Group()
  group.name = `${INFLUENCE_GROUP_PREFIX}${influenceId}`
  group.userData = { editorOnly: true, auroraId: objectId, influenceId }

  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, index) => {
      const angle = (index / 48) * Math.PI * 2
      return new THREE.Vector3(Math.cos(angle) * .38, 0, Math.sin(angle) * .38)
    })),
    new THREE.LineBasicMaterial({ color: '#8fd3b6', depthTest: false, transparent: true, opacity: .85 }),
  )
  ring.name = 'influence-ring'
  ring.userData = { editorOnly: true }
  ring.renderOrder = 23
  group.add(ring)

  const knob = new THREE.Mesh(
    new THREE.OctahedronGeometry(.1),
    new THREE.MeshBasicMaterial({ color: '#8fd3b6', depthTest: false, transparent: true, opacity: .95 }),
  )
  knob.name = 'influence-center'
  knob.userData = { editorOnly: true, auroraId: objectId, influenceId, influenceTarget: 'center' }
  knob.renderOrder = 24
  group.add(knob)
  return group
}

function updateInfluenceHelper(group: THREE.Object3D, object: Aurora3DObject, influenceId: string) {
  group.position.set(
    influenceParameterValue(object, influenceId, 'centerX', 0),
    influenceParameterValue(object, influenceId, 'centerY', 0),
    influenceParameterValue(object, influenceId, 'centerZ', 0),
  )
  const ring = group.getObjectByName('influence-ring')
  if (!ring) return
  // The ring lies in the plane the copies sweep through, so the axis parameter reads at a glance.
  const axis = Math.max(0, Math.min(2, Math.round(influenceParameterValue(object, influenceId, 'axis', 1))))
  ring.rotation.set(axis === 2 ? Math.PI / 2 : 0, 0, axis === 0 ? Math.PI / 2 : 0)
}

function syncInfluenceHelpers(target: Scene3DRuntime, sceneDefinition: Aurora3DScene) {
  sceneDefinition.objects.forEach((object) => {
    const mesh = target.objects.get(object.id)
    if (!mesh) return
    const live = selectedSceneEntityId.value === object.id ? radialInfluences(object) : []
    const liveIds = new Set(live.map((influence) => influence.id))
    mesh.children
      .filter((child) => child.name.startsWith(INFLUENCE_GROUP_PREFIX) && !liveIds.has(child.userData.influenceId as string))
      .forEach(disposeHelperRoot)
    live.forEach((influence) => {
      let group = mesh.getObjectByName(`${INFLUENCE_GROUP_PREFIX}${influence.id}`)
      if (!group) {
        group = makeInfluenceHelper(object.id, influence.id)
        mesh.add(group)
      }
      updateInfluenceHelper(group, object, influence.id)
    })
  })
}

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
  target.cameras.forEach((camera, id) => {
    const name = `aurora-editor-camera-helper-${id}`
    if (target.scene.getObjectByName(name)) return
    camera.add(makeCameraOutline(id))
  })
  target.lights.forEach((light, id) => {
    const name = `aurora-editor-light-helper-${id}`
    if (target.scene.getObjectByName(name)) return
    let helper: THREE.Object3D
    if (light instanceof THREE.DirectionalLight) helper = new THREE.DirectionalLightHelper(light, .7, '#ffd37a')
    else if (light instanceof THREE.PointLight) helper = new THREE.PointLightHelper(light, .32, '#ffd37a')
    else {
      helper = new THREE.Mesh(
        new THREE.IcosahedronGeometry(.3, 1),
        new THREE.MeshBasicMaterial({ color: '#ffd37a', wireframe: true, depthTest: false }),
      )
    }
    helper.name = name
    helper.userData = { editorOnly: true, auroraId: id }
    if (light instanceof THREE.AmbientLight) light.add(helper)
    else target.scene.add(helper)
  })
  if (transform && !transform.getHelper().parent) {
    transform.getHelper().userData.editorOnly = true
    target.scene.add(transform.getHelper())
  }
}

function updateEditorHelpers(target: Scene3DRuntime) {
  target.scene.updateMatrixWorld(true)
  target.lights.forEach((light) => {
    if (!(light instanceof THREE.DirectionalLight)) return
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(light.quaternion)
    light.target.position.copy(light.position).add(direction)
    light.target.updateMatrixWorld(true)
  })
  target.scene.traverse((object) => {
    if (object instanceof THREE.DirectionalLightHelper || object instanceof THREE.PointLightHelper) {
      const light = selectedScene.value?.lights.find((item) => item.id === object.userData.auroraId)
      object.visible = selectedLayer.value?.visible !== false && light?.visible !== false
      object.update()
    }
  })
  if (transform) transform.getHelper().visible = selectedLayer.value?.visible !== false && store.selectedSceneEntity?.value.visible !== false
}

function attachSelection() {
  if (!runtime || !transform) return
  const id = selectedSceneEntityId.value
  const selection = activePathPoint.value
  if (selection) {
    const control = runtime.scene.getObjectByName(`${PATH_GROUP_PREFIX}${id}`)
      ?.getObjectByName(`${selection.target}-${selection.pointId}`)
    if (control) {
      transform.setMode('translate')
      transform.attach(control)
      return
    }
    pathSelection.value = null
  }
  transform.setMode(transformMode.value)
  const constrainedCamera = selectedScene.value?.cameras.some((camera) => camera.id === id && (camera.pathConstraint || camera.objectConstraint))
  const target = runtime.objects.get(id) ?? runtime.cameras.get(id) ?? runtime.lights.get(id)
    ?? runtime.scene.getObjectByName(`${PATH_GROUP_PREFIX}${id}`)
  if (target && !constrainedCamera) transform.attach(target)
  else transform.detach()
}

let viewportFrame = 0

function renderViewportNow() {
  const sceneDefinition = selectedScene.value
  const host = viewport.value
  if (!renderer || !editorCamera || !host || !sceneDefinition) return
  const syncScene = !transform?.dragging || !runtime || runtime.sceneId !== sceneDefinition.id
  if (syncScene) {
    if (runtime && runtime.sceneId !== sceneDefinition.id) disposeEditorHelpers(runtime)
    runtime = runtimeRegistry.get(sceneDefinition, host.clientWidth, host.clientHeight, currentTime.value, assets.value, rigs.value)
  }
  const targetRuntime = runtime
  if (!targetRuntime) return
  ensureEditorHelpers(targetRuntime)
  targetRuntime.root.visible = selectedLayer.value?.visible !== false
  syncPathHelpers(targetRuntime, sceneDefinition)
  syncRigHelpers(targetRuntime, sceneDefinition)
  syncInfluenceHelpers(targetRuntime, sceneDefinition)
  if (syncScene) attachSelection()
  updateEditorHelpers(targetRuntime)
  renderer.shadowMap.enabled = sceneDefinition.settings.shadows
  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, host.clientWidth, host.clientHeight)
  scenePipeline?.render(targetRuntime.scene, editorCamera, sceneDefinition.settings, host.clientWidth, host.clientHeight, 'screen')
  stats.value = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
}

function renderViewport() {
  if (viewportFrame) return
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = 0
    renderViewportNow()
  })
}

function resizeViewport() {
  const host = viewport.value
  if (!renderer || !editorCamera || !host) return
  const width = Math.max(1, host.clientWidth)
  const height = Math.max(1, host.clientHeight)
  renderer.setSize(width, height, false)
  const aspect = width / height
  if (perspectiveCamera) {
    perspectiveCamera.aspect = aspect
    perspectiveCamera.updateProjectionMatrix()
  }
  if (orthographicCamera) {
    const halfHeight = 5.5
    orthographicCamera.left = -halfHeight * aspect
    orthographicCamera.right = halfHeight * aspect
    orthographicCamera.top = halfHeight
    orthographicCamera.bottom = -halfHeight
    orthographicCamera.updateProjectionMatrix()
  }
  renderViewport()
}

function setTransformMode(mode: TransformControlsMode) {
  transformMode.value = mode
  if (!activePathPoint.value) transform?.setMode(mode)
  renderViewport()
}

const selectedPath = computed(() => selectedScene.value?.paths?.find((path) => path.id === selectedSceneEntityId.value) ?? null)

function clearPathPointSelection() {
  pathSelection.value = null
  attachSelection()
  renderViewport()
}

function addPointAfterSelection() {
  const path = selectedPath.value
  if (!path) return
  const point = store.add3DPathPoint(path.id, activePathPoint.value?.pointId)
  if (point) pathSelection.value = { pathId: path.id, pointId: point.id, target: 'position' }
}

function extendPath(side: 'start' | 'end') {
  const path = selectedPath.value
  if (!path) return
  const point = store.add3DPathEndpoint(path.id, side)
  if (point) pathSelection.value = { pathId: path.id, pointId: point.id, target: 'position' }
}

function deleteSelectedPathPoint() {
  const path = selectedPath.value
  const selection = activePathPoint.value
  if (!path || !selection) return
  if (store.delete3DPathPoint(path.id, selection.pointId)) clearPathPointSelection()
}

function setCameraView(view: 'Perspective' | 'Front' | 'Right' | 'Top') {
  if (!perspectiveCamera || !orthographicCamera || !orbit) return
  cameraView.value = view
  orbit.target.set(0, 0, 0)
  editorCamera = view === 'Perspective' ? perspectiveCamera : orthographicCamera
  orbit.object = editorCamera
  if (transform) transform.camera = editorCamera
  editorCamera.up.set(0, 1, 0)
  if (view === 'Front') editorCamera.position.set(0, 0, 10)
  else if (view === 'Right') editorCamera.position.set(10, 0, 0)
  else if (view === 'Top') {
    editorCamera.position.set(0, 10, 0)
    editorCamera.up.set(0, 0, -1)
  } else editorCamera.position.set(7, 5, 8)
  editorCamera.lookAt(orbit.target)
  orbit.enableRotate = view === 'Perspective'
  orbit.mouseButtons.LEFT = view === 'Perspective' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN
  orbit.update()
  renderViewport()
}

const selectedCamera = computed(() => selectedScene.value?.cameras.find((camera) => camera.id === selectedSceneEntityId.value) ?? null)
const cameraAlignBlocked = computed(() => Boolean(selectedCamera.value?.pathConstraint || selectedCamera.value?.objectConstraint))
const cameraAlignLabel = computed(() => {
  const camera = selectedCamera.value
  if (!camera) return 'Select a scene camera to snap it to this viewport view'
  if (cameraAlignBlocked.value) return `${camera.name} is driven by a constraint, so its own transform is ignored`
  return `Move ${camera.name} to this viewport view (Ctrl+Alt+C)`
})

/**
 * Drops the selected scene camera exactly where the viewport is looking from.
 *
 * Only the transform moves: the lens stays whatever the shot was framed with, so aligning never
 * silently re-frames the composition behind the user's back.
 */
function alignCameraToView() {
  const camera = selectedCamera.value
  if (!camera || !editorCamera || cameraAlignBlocked.value) return
  editorCamera.updateMatrixWorld(true)
  const position = editorCamera.getWorldPosition(new THREE.Vector3())
  const euler = new THREE.Euler().setFromQuaternion(editorCamera.getWorldQuaternion(new THREE.Quaternion()), 'XYZ')
  store.update3DEntityTransform(camera.id, {
    position: [position.x, position.y, position.z],
    rotation: [THREE.MathUtils.radToDeg(euler.x), THREE.MathUtils.radToDeg(euler.y), THREE.MathUtils.radToDeg(euler.z)],
    scale: (['x', 'y', 'z'] as const).map((axis) => evaluateNumericProperty(camera.transform.scale[axis], currentTime.value)) as [number, number, number],
  })
  renderViewport()
}

/** Keeps the axis presets mathematically square after OrbitControls pans or zooms the view. */
function enforceAxisView() {
  if (!editorCamera || !orbit || cameraView.value === 'Perspective') return
  const distance = Math.max(.1, editorCamera.position.distanceTo(orbit.target))
  editorCamera.up.set(0, 1, 0)
  if (cameraView.value === 'Front') editorCamera.position.copy(orbit.target).add(new THREE.Vector3(0, 0, distance))
  else if (cameraView.value === 'Right') editorCamera.position.copy(orbit.target).add(new THREE.Vector3(distance, 0, 0))
  else {
    editorCamera.position.copy(orbit.target).add(new THREE.Vector3(0, distance, 0))
    editorCamera.up.set(0, 0, -1)
  }
  editorCamera.lookAt(orbit.target)
}

function rememberPickStart(event: PointerEvent) {
  if (event.button !== 0) {
    pickStart = null
    finishTransformInteraction()
    navigationPointerId = event.pointerId
    if (transform) {
      transform.axis = null
      transform.enabled = false
    }
    return
  }
  pickStart = { x: event.clientX, y: event.clientY }
  if (transform && !transform.dragging) transform.axis = null
  if (beginGizmoDrag(event)) return
  beginPathDrag(event)
}

/**
 * Anchors and handles are grabbed directly: one press selects the control and starts moving it on a
 * plane facing the camera. The gizmo's invisible pickers cover a wide area around the entity origin
 * and would otherwise swallow the press, so both it and the orbit controls stand down for the drag.
 * Grabbing a gizmo axis still works — the arrows sit away from the control itself.
 */
function beginPathDrag(event: PointerEvent) {
  const scene = selectedScene.value
  const raycaster = raycasterAt(event.clientX, event.clientY)
  const hit = raycaster && !transform?.dragging ? pickPathControl(raycaster) : null
  if (!scene || !hit?.pointId || !editorCamera) return
  const path = scene.paths?.find((item) => item.id === hit.pathId)
  const group = hit.object.parent
  if (!path || path.locked || !group) return

  const worldPosition = hit.object.getWorldPosition(new THREE.Vector3())
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(editorCamera.getWorldDirection(new THREE.Vector3()), worldPosition)
  const grab = raycaster!.ray.intersectPlane(plane, new THREE.Vector3())
  if (!grab) return

  pathSelection.value = { pathId: hit.pathId, pointId: hit.pointId, target: hit.target }
  store.selectSceneEntity(scene.id, hit.pathId)
  pathDrag = {
    pathId: hit.pathId,
    pointId: hit.pointId,
    target: hit.target,
    group,
    plane,
    grabOffset: worldPosition.clone().sub(grab),
    pointerId: event.pointerId,
    moved: false,
    position: hit.object.position.toArray() as PathVector,
  }
  skipNextPick = true
  if (orbit) orbit.enabled = false
  if (transform) transform.enabled = false
  attachSelection()
  renderViewport()
}

function onPathDragMove(event: PointerEvent) {
  if (!pathDrag || event.pointerId !== pathDrag.pointerId) return
  const raycaster = raycasterAt(event.clientX, event.clientY)
  const hit = raycaster?.ray.intersectPlane(pathDrag.plane, new THREE.Vector3())
  if (!hit) return
  pathDrag.group.updateMatrixWorld(true)
  const local = pathDrag.group.worldToLocal(hit.add(pathDrag.grabOffset))
  pathDrag.position = [local.x, local.y, local.z]
  pathDrag.moved = true
  renderViewport()
}

function finishPathDrag() {
  if (!pathDrag) return
  if (pathDrag.moved) store.move3DPathPoint(pathDrag.pathId, pathDrag.pointId, pathDrag.target, pathDrag.position)
  pathDrag = null
  if (orbit) orbit.enabled = true
  if (transform) transform.enabled = true
  attachSelection()
  renderViewport()
}

/**
 * Rig bones and influence centres are grabbed the same way path points are: press to select and
 * drag on a plane facing the camera. They draw with `depthTest: false`, so they get their own hit
 * pass — what you see in front is what you grab, whatever solid geometry the ray crosses first.
 */
function pickGizmoControl(raycaster: THREE.Raycaster) {
  const groups: THREE.Object3D[] = []
  runtime?.scene.traverse((object) => {
    if (object.visible && (object.name.startsWith(RIG_GROUP_PREFIX) || object.name.startsWith(INFLUENCE_GROUP_PREFIX))) groups.push(object)
  })
  if (!groups.length) return null
  const hits = raycaster.intersectObjects(groups, true).filter((item) => item.object.visible)
  // Tips sit on top of shafts, and a bone handle wins over the wider influence knob beneath it.
  return hits.find((item) => item.object.userData.rigTarget === 'tip')?.object
    ?? hits.find((item) => item.object.userData.rigTarget === 'head')?.object
    ?? hits.find((item) => item.object.userData.influenceTarget === 'center')?.object
    ?? null
}

function beginGizmoDrag(event: PointerEvent) {
  const scene = selectedScene.value
  const raycaster = raycasterAt(event.clientX, event.clientY)
  const control = scene && raycaster && !transform?.dragging ? pickGizmoControl(raycaster) : null
  const host = control?.parent?.parent
  if (!scene || !control || !host || !editorCamera) return false

  const worldPosition = control.getWorldPosition(new THREE.Vector3())
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(editorCamera.getWorldDirection(new THREE.Vector3()), worldPosition)
  const grab = raycaster!.ray.intersectPlane(plane, new THREE.Vector3())
  if (!grab) return false

  const objectId = control.userData.auroraId as string
  store.selectSceneEntity(scene.id, objectId)
  if (control.userData.rigBoneId) store.selectedRigBoneId = control.userData.rigBoneId as string
  gizmoDrag = {
    pointerId: event.pointerId,
    kind: control.userData.rigTarget ? 'rig' : 'influence',
    objectId,
    rigId: (control.userData.rigId as string) ?? '',
    boneId: (control.userData.rigBoneId as string) ?? '',
    target: (control.userData.rigTarget as 'head' | 'tip') ?? 'head',
    influenceId: (control.userData.influenceId as string) ?? '',
    rest: event.shiftKey,
    host,
    plane,
    grabOffset: worldPosition.clone().sub(grab),
  }
  skipNextPick = true
  if (orbit) orbit.enabled = false
  if (transform) transform.enabled = false
  store.beginInteractiveEdit()
  attachSelection()
  renderViewport()
  return true
}

function onGizmoDragMove(event: PointerEvent) {
  const drag = gizmoDrag
  if (!drag || event.pointerId !== drag.pointerId) return
  const raycaster = raycasterAt(event.clientX, event.clientY)
  const hit = raycaster?.ray.intersectPlane(drag.plane, new THREE.Vector3())
  const object = selectedScene.value?.objects.find((item) => item.id === drag.objectId)
  if (!hit || !object) return
  drag.host.updateMatrixWorld(true)
  const local = drag.host.worldToLocal(hit.add(drag.grabOffset))

  if (drag.kind === 'influence') {
    ;([['centerX', local.x], ['centerY', local.y], ['centerZ', local.z]] as const)
      .forEach(([key, value]) => store.set3DInfluenceParameter(drag.influenceId, key, value))
    renderViewport()
    return
  }

  const rig = rigs.value.find((item) => item.id === drag.rigId)
  const bone = rig?.bones.find((item) => item.id === drag.boneId)
  if (!rig || !bone) return
  const { halfWidth, halfHeight } = planeHalfExtents(object, assetMap.value)
  const point = { x: local.x / Math.max(1e-4, halfWidth), y: local.y / Math.max(1e-4, halfHeight) }
  if (drag.rest && drag.target === 'head') store.setRigBoneRest(rig.id, bone.id, { x: point.x, y: point.y })
  else if (drag.rest) store.setRigBoneRest(rig.id, bone.id, restAimTowards({ x: bone.x, y: bone.y }, point, bone.angle))
  else if (drag.target === 'head') {
    const offset = poseOffsetTowards(rig, bone, currentTime.value, point)
    store.setRigBonePose(rig.id, bone.id, 'offsetX', offset.x)
    store.setRigBonePose(rig.id, bone.id, 'offsetY', offset.y)
  } else store.setRigBonePose(rig.id, bone.id, 'rotation', poseRotationTowards(rig, bone, currentTime.value, point))
  renderViewport()
}

function finishGizmoDrag() {
  if (!gizmoDrag) return
  gizmoDrag = null
  store.endInteractiveEdit()
  if (orbit) orbit.enabled = true
  if (transform) transform.enabled = true
  attachSelection()
  renderViewport()
}

function raycasterAt(clientX: number, clientY: number) {
  if (!editorCamera || !canvas.value) return null
  const bounds = canvas.value.getBoundingClientRect()
  const raycaster = new THREE.Raycaster()
  raycaster.params.Line.threshold = .14
  raycaster.setFromCamera(new THREE.Vector2(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    -((clientY - bounds.top) / bounds.height) * 2 + 1,
  ), editorCamera)
  return raycaster
}

/**
 * Path controls draw with `depthTest: false`, so they are always visible on top of the scene.
 * They therefore get their own hit pass: what you see in front is what you click, no matter what
 * solid geometry the ray crosses first. Handles win over anchors, and both win over the curve.
 */
function pickPathControl(raycaster: THREE.Raycaster) {
  const groups = runtime?.scene.children.filter((child) => child.name.startsWith(PATH_GROUP_PREFIX)) ?? []
  if (!groups.length) return null
  const hits = raycaster.intersectObjects(groups, true).filter((item) => item.object.visible)
  const control = hits.find((item) => item.object.userData.pathTarget && item.object.userData.pathTarget !== 'position')
    ?? hits.find((item) => item.object.userData.pathPointId)
  const target = control ?? hits.find((item) => item.object.userData.auroraId)
  if (!target) return null
  return {
    object: control?.object ?? target.object,
    pathId: target.object.userData.auroraId as string,
    pointId: control ? control.object.userData.pathPointId as string : null,
    target: (control?.object.userData.pathTarget as PathHandleKey | undefined) ?? 'position',
  }
}

function pickObject(event: MouseEvent) {
  const moved = pickStart && Math.hypot(event.clientX - pickStart.x, event.clientY - pickStart.y) > 3
  pickStart = null
  if (skipNextPick || moved || !runtime || !editorCamera || !canvas.value || transform?.dragging) return
  const scene = selectedScene.value
  const raycaster = raycasterAt(event.clientX, event.clientY)
  if (!scene || !raycaster) return

  const pathHit = pickPathControl(raycaster)
  if (pathHit) {
    pathSelection.value = pathHit.pointId ? { pathId: pathHit.pathId, pointId: pathHit.pointId, target: pathHit.target } : null
    store.selectSceneEntity(scene.id, pathHit.pathId)
    attachSelection()
    renderViewport()
    return
  }

  const hits = raycaster.intersectObjects(runtime.scene.children, true)
  const hit = hits.find((item) => {
    let candidate: THREE.Object3D | null = item.object
    while (candidate) {
      if (candidate.userData.auroraId) return true
      candidate = candidate.parent
    }
    return false
  })
  if (!hit) return
  let candidate: THREE.Object3D | null = hit.object
  while (candidate && !candidate.userData.auroraId) candidate = candidate.parent
  if (!candidate?.userData.auroraId) return
  pathSelection.value = null
  store.selectSceneEntity(scene.id, candidate.userData.auroraId as string)
  attachSelection()
  renderViewport()
}

function commitTransform() {
  const object = transform?.object
  if (!object?.userData.auroraId) return
  if (object.userData.pathPointId) {
    store.move3DPathPoint(
      object.userData.auroraId as string,
      object.userData.pathPointId as string,
      object.userData.pathTarget as PathHandleKey,
      [object.position.x, object.position.y, object.position.z],
    )
    return
  }
  store.update3DEntityTransform(object.userData.auroraId as string, {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [THREE.MathUtils.radToDeg(object.rotation.x), THREE.MathUtils.radToDeg(object.rotation.y), THREE.MathUtils.radToDeg(object.rotation.z)],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  })
}

function finishTransformInteraction() {
  if (!transform) return
  if (transform.dragging && transformDirty) commitTransform()
  transformDirty = false
  transform.dragging = false
  transform.axis = null
  if (orbit) orbit.enabled = true
}

function onGlobalPointerEnd(event: PointerEvent) {
  if (gizmoDrag?.pointerId === event.pointerId) {
    finishGizmoDrag()
    requestAnimationFrame(() => { skipNextPick = false })
    return
  }
  if (pathDrag?.pointerId === event.pointerId) {
    finishPathDrag()
    requestAnimationFrame(() => { skipNextPick = false })
    return
  }
  if (navigationPointerId === event.pointerId) {
    navigationPointerId = null
    requestAnimationFrame(() => { if (transform) transform.enabled = true })
    return
  }
  finishTransformInteraction()
  requestAnimationFrame(() => { skipNextPick = false })
}

function onWindowBlur() {
  navigationPointerId = null
  finishGizmoDrag()
  finishPathDrag()
  if (transform) transform.enabled = true
  finishTransformInteraction()
  skipNextPick = false
}

function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.matches('input, textarea')) return
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    alignCameraToView()
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key.toLowerCase() === 'g') setTransformMode('translate')
  if (event.key.toLowerCase() === 'r') setTransformMode('rotate')
  if (event.key.toLowerCase() === 's') setTransformMode('scale')
}

onMounted(async () => {
  await nextTick()
  if (!canvas.value || !viewport.value) return
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.setClearColor('#090b10', 1)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  scenePipeline = new AuroraSceneRenderPipeline(renderer)
  perspectiveCamera = new THREE.PerspectiveCamera(48, 1, .1, 2000)
  perspectiveCamera.position.set(7, 5, 8)
  orthographicCamera = new THREE.OrthographicCamera(-5.5, 5.5, 5.5, -5.5, .1, 2000)
  editorCamera = perspectiveCamera
  orbit = new OrbitControls(editorCamera, canvas.value)
  orbit.enableDamping = false
  orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE
  orbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN
  orbit.mouseButtons.RIGHT = THREE.MOUSE.PAN
  orbit.target.set(0, 0, 0)
  orbit.addEventListener('change', () => {
    enforceAxisView()
    renderViewport()
  })
  transform = new TransformControls(editorCamera, canvas.value)
  transform.setMode(transformMode.value)
  transform.setSize(.82)
  transform.addEventListener('change', renderViewport)
  transform.addEventListener('objectChange', () => { transformDirty = true })
  transform.addEventListener('dragging-changed', (event) => { if (orbit) orbit.enabled = !event.value })
  transform.addEventListener('mouseDown', () => {
    transformDirty = false
    skipNextPick = true
  })
  resizeObserver = new ResizeObserver(resizeViewport)
  resizeObserver.observe(viewport.value)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointermove', onPathDragMove)
  window.addEventListener('pointermove', onGizmoDragMove)
  window.addEventListener('pointerup', onGlobalPointerEnd, true)
  window.addEventListener('pointercancel', onGlobalPointerEnd, true)
  window.addEventListener('blur', onWindowBlur)
  resizeViewport()
})

onBeforeUnmount(() => {
  if (viewportFrame) cancelAnimationFrame(viewportFrame)
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointermove', onPathDragMove)
  window.removeEventListener('pointermove', onGizmoDragMove)
  window.removeEventListener('pointerup', onGlobalPointerEnd, true)
  window.removeEventListener('pointercancel', onGlobalPointerEnd, true)
  window.removeEventListener('blur', onWindowBlur)
  finishTransformInteraction()
  orbit?.dispose()
  disposeEditorHelpers(runtime)
  transform?.detach()
  transform?.dispose()
  transform = null
  runtimeRegistry.dispose()
  scenePipeline?.dispose()
  scenePipeline = null
  renderer?.dispose()
  renderer = null
  editorCamera = null
  perspectiveCamera = null
  orthographicCamera = null
})

watch([selectedLayer, selectedScene, currentTime, selectedSceneEntityId, assets, rigs], renderViewport, { deep: true })
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
      <IconButton :icon="Camera" :label="cameraAlignLabel" :disabled="!selectedCamera || cameraAlignBlocked" @click="alignCameraToView" />
      <span class="toolbar-divider" />
      <button v-for="view in (['Perspective', 'Front', 'Right', 'Top'] as const)" :key="view" type="button" class="view-button" :title="view === 'Perspective' ? 'Switch to perspective view' : `Switch to exact ${view.toLowerCase()} orthographic view`" @click="setCameraView(view)">{{ view }}</button>
      <template v-if="selectedPath">
        <span class="toolbar-divider" />
        <span class="path-label"><Spline :size="11" :style="{ color: selectedPath.color }" /> {{ selectedPath.name }}</span>
        <IconButton :icon="Plus" label="Insert a point after the selected vertex, preserving the Bézier segment" :disabled="selectedPath.locked" @click="addPointAfterSelection" />
        <IconButton :icon="ArrowLeftToLine" label="Extend the open path before its first endpoint" :disabled="selectedPath.locked || selectedPath.closed" @click="extendPath('start')" />
        <IconButton :icon="ArrowRightToLine" label="Extend the open path beyond its last endpoint" :disabled="selectedPath.locked || selectedPath.closed" @click="extendPath('end')" />
        <IconButton :icon="Trash2" label="Delete the selected path point" :disabled="!activePathPoint || selectedPath.points.length <= 2" @click="deleteSelectedPathPoint" />
        <button type="button" class="view-button" :class="{ active: selectedPath.closed }" title="Close the path into a loop" @click="store.toggle3DPathClosed(selectedPath.id)">Closed</button>
      </template>
      <span class="toolbar-spacer" />
      <span class="scene-label"><Box :size="11" /> {{ activeSceneLabel }}</span>
    </div>

    <div ref="viewport" class="three-viewport">
      <canvas ref="canvas" aria-label="3D scene editor viewport" @pointerdown="rememberPickStart" @click="pickObject" @contextmenu.prevent />
      <div v-if="!selectedScene" class="scene-empty-state">
        <span><Box :size="22" /></span>
        <strong>No 3D scene yet</strong>
        <small>Create a scene here. It will also be saved in the Library so it can be reused like a cluster.</small>
        <button type="button" @click="store.create3DSceneFromWorkspace()"><Plus :size="12" /> Create 3D scene</button>
      </div>
      <div class="viewport-badge"><View :size="10" /> {{ cameraView }}{{ cameraView === 'Perspective' ? '' : ' · Orthographic' }}</div>
      <div class="viewport-axis"><span class="x">X</span><span class="y">Y</span><span class="z">Z</span></div>
      <div class="viewport-help">{{ viewportHelp }}</div>
    </div>

    <footer class="three-status">
      <span><Grid3X3 :size="10" /> World grid</span>
      <span><Crosshair :size="10" /> Local transform</span>
      <span class="status-spacer" />
      <span><Camera :size="10" /> {{ selectedScene?.cameras.length ?? 0 }} cameras</span>
      <span><Sun :size="10" /> {{ selectedScene?.lights.length ?? 0 }} lights</span>
      <span><Spline :size="10" /> {{ selectedScene?.paths?.length ?? 0 }} paths</span>
      <span>{{ stats.calls }} calls · {{ stats.triangles.toLocaleString() }} tris</span>
      <strong :class="{ playing }">{{ playing ? 'LIVE' : 'READY' }}</strong>
    </footer>
  </section>
</template>

<style scoped>
.three-workspace { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: #090b10; }
.three-toolbar { display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 2px; padding: 0 7px; background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); }.tool-group { display: flex; gap: 1px; }.toolbar-divider { width: 1px; height: 20px; margin: 0 4px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.view-button { height: 24px; padding: 0 7px; color: var(--text-muted); background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; white-space: nowrap; }.view-button:hover { color: var(--text-primary); background: var(--bg-hover); }.view-button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.scene-label, .path-label { display: flex; min-width: 0; align-items: center; gap: 5px; overflow: hidden; color: var(--text-secondary); font-size: 8.5px; text-overflow: ellipsis; white-space: nowrap; }.path-label { max-width: 110px; }
.three-viewport { position: relative; min-height: 0; flex: 1; overflow: hidden; background: #090b10; }.three-viewport canvas { display: block; width: 100%; height: 100%; outline: none; touch-action: none; }.viewport-badge, .viewport-help { position: absolute; padding: 4px 6px; color: #858b99; background: rgb(12 14 20 / .78); border: 1px solid #292d37; border-radius: 3px; font-size: 7.5px; pointer-events: none; backdrop-filter: blur(4px); }.viewport-badge { top: 8px; left: 9px; display: flex; align-items: center; gap: 4px; }.viewport-help { right: 9px; bottom: 8px; }.viewport-axis { position: absolute; top: 9px; right: 10px; display: flex; gap: 3px; font-size: 7px; font-weight: 700; }.viewport-axis span { display: grid; width: 15px; height: 15px; place-items: center; color: #eef0f8; background: #252a35; border: 1px solid #3a404d; border-radius: 50%; }.viewport-axis .x { color: #ff9ca8; }.viewport-axis .y { color: #8bd5ad; }.viewport-axis .z { color: #91adff; }
.scene-empty-state { position: absolute; top: 50%; left: 50%; display: flex; width: min(330px, calc(100% - 40px)); flex-direction: column; align-items: center; gap: 7px; padding: 18px; color: var(--text-muted); text-align: center; background: rgb(18 21 29 / .92); border: 1px solid #343948; border-radius: 5px; box-shadow: 0 16px 40px rgb(0 0 0 / .35); transform: translate(-50%, -50%); }.scene-empty-state > span { display: grid; width: 38px; height: 38px; place-items: center; color: #cbd3ff; background: #262d48; border: 1px solid #586593; border-radius: 4px; }.scene-empty-state strong { color: var(--text-primary); font-size: 11px; }.scene-empty-state small { max-width: 260px; font-size: 8.5px; line-height: 1.5; }.scene-empty-state button { display: inline-flex; height: 27px; align-items: center; gap: 5px; margin-top: 2px; padding: 0 9px; color: #11131a; background: var(--button-accent); border: 1px solid #a8b2ff; border-radius: 4px; font: inherit; font-size: 9px; font-weight: 650; cursor: pointer; }.scene-empty-state button:hover { background: var(--button-accent-hover); }
.three-status { display: flex; height: 27px; flex: 0 0 auto; align-items: center; gap: 10px; padding: 0 8px; color: var(--text-muted); background: #111319; border-top: 1px solid var(--border-subtle); font-size: 7.5px; }.three-status span { display: flex; align-items: center; gap: 4px; white-space: nowrap; }.three-status .status-spacer { flex: 1; }.three-status strong { color: #7eb89f; font-size: 7px; letter-spacing: .08em; }.three-status strong.playing { color: #c3cafd; }
</style>
