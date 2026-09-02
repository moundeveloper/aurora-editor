import type {
  Aurora3DScene, AuroraRig, AuroraRigBone, EditorLayer, EditorNode, EditorNodeConnection, EditorProject,
  MediaAsset, SerializedEditorState,
} from '@/models/editor'
import { createCameraObjectConstraint, makePathOffset, numericProperty } from '@/engine/scene3d/sceneFactory'
import { createDemoNodeGraph, NODE_DEFINITIONS } from '@/engine/nodes/nodeGraph'
import { normalizeCameraCuts } from '@/engine/scene3d/cameraCuts'
import { MAX_RIG_CELLS, MIN_RIG_CELLS } from '@/engine/rig/rigMesh'

export const CURRENT_PROJECT_VERSION = 13

export interface EditorStateFallback {
  project: EditorProject
  layers: EditorLayer[]
  scenes3D: Aurora3DScene[]
  assets: MediaAsset[]
  nodes?: EditorNode[]
  nodeConnections?: EditorNodeConnection[]
  rigs?: AuroraRig[]
}

/**
 * Projects saved before the node graph drove rendering get a fresh graph mirroring their layer
 * stack. Anything referencing a node or port that no longer exists is dropped rather than left
 * dangling, and missing parameter records are backfilled from the kind's defaults.
 */
function normalizeNodeGraph(nodes: unknown, connections: unknown, layers: EditorLayer[], version = CURRENT_PROJECT_VERSION) {
  const demo = createDemoNodeGraph(layers)
  const candidates = Array.isArray(nodes) ? nodes as EditorNode[] : []
  // Graphs from before the effect chains existed described a composite the project no longer means.
  if (version < 8) return demo
  // Anything from before typed sockets cannot be repaired field by field, so rebuild it instead.
  const usable = candidates.length > 0
    && candidates.every((node) => node?.id && NODE_DEFINITIONS[node.kind] && Array.isArray(node.inputs) && Array.isArray(node.outputs))
    && candidates.every((node) => [...node.inputs, ...node.outputs].every((socket) => socket?.id && socket.type))
    && candidates.some((node) => Boolean(node.sourceId))
  if (!usable) return demo
  const restored = candidates
  restored.forEach((node) => {
    node.muted = Boolean(node.muted)
    if (node.kind === 'mask') {
      /*
       * Projects saved before per-segment feather carried 32 normalised brush samples, which cannot
       * be mapped onto segment widths in pixels. They are dropped, and the segment list is filled in
       * from the node's own feather socket once the connected shape reveals how many segments exist.
       */
      delete (node as { maskEdgeFeather?: number[] }).maskEdgeFeather
      node.maskSegmentFeather = (node.maskSegmentFeather ?? [])
        .map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0))
    }
    const definition = NODE_DEFINITIONS[node.kind]
    node.properties = Object.fromEntries(definition.properties.map((property) => [
      property.key,
      definition.properties.find((item) => item.key === property.key)?.options.some((option) => option.value === node.properties?.[property.key])
        ? node.properties[property.key]!
        : property.value,
    ]))
  })
  const byId = new Map(restored.map((node) => [node.id, node]))
  const links = (Array.isArray(connections) ? connections as EditorNodeConnection[] : []).filter((connection) => {
    const from = byId.get(connection?.fromNodeId)
    const to = byId.get(connection?.toNodeId)
    return Boolean(from?.outputs.some((port) => port.id === connection.fromPortId)
      && to?.inputs.some((port) => port.id === connection.toPortId))
  })
  return { nodes: restored, connections: links }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Projects saved before 3D paths existed have no `paths` array and no camera constraints to repair. */
function normalizeScene(scene: Aurora3DScene): Aurora3DScene {
  scene.settings ??= {
    shadows: true, shadowMapSize: 1024, ambientOcclusion: true,
    ambientOcclusionIntensity: 1, ambientOcclusionRadius: .35,
    motionBlur: false, motionBlurShutter: 180, motionBlurSamples: 8,
    quality: 'preview', backgroundColor: null,
  }
  scene.settings.shadows = scene.settings.shadows !== false
  scene.settings.shadowMapSize = Math.max(256, Math.min(4096, finiteOr(scene.settings.shadowMapSize, 1024)))
  scene.settings.ambientOcclusion = scene.settings.ambientOcclusion !== false
  scene.settings.ambientOcclusionIntensity = Math.max(0, Math.min(3, finiteOr(scene.settings.ambientOcclusionIntensity, 1)))
  scene.settings.ambientOcclusionRadius = Math.max(.01, Math.min(5, finiteOr(scene.settings.ambientOcclusionRadius, .35)))
  scene.settings.motionBlur = scene.settings.motionBlur === true
  scene.settings.motionBlurShutter = Math.max(0, Math.min(360, finiteOr(scene.settings.motionBlurShutter, 180)))
  scene.settings.motionBlurSamples = Math.round(Math.max(2, Math.min(16, finiteOr(scene.settings.motionBlurSamples, 8))))
  scene.environmentIntensity = Math.max(0, finiteOr(scene.environmentIntensity, 1))
  if (typeof scene.environmentAssetId !== 'string' || !scene.environmentAssetId) delete scene.environmentAssetId
  scene.environmentBackground = scene.environmentBackground === true
  scene.cameraCuts = normalizeCameraCuts(scene, scene.cameraCuts)
  if (!scene.cameras.some((camera) => camera.id === scene.activeCameraId)) scene.activeCameraId = scene.cameraCuts[0]?.cameraId ?? scene.cameras[0]?.id ?? null
  if (!Array.isArray(scene.paths)) scene.paths = []
  scene.objects.forEach((object) => {
    object.visible = object.visible !== false
    if (!Array.isArray(object.influences)) object.influences = []
    object.influences = object.influences.filter((influence) => influence?.type && influence.parameters)
  })
  const objectById = new Map(scene.objects.map((object) => [object.id, object]))
  scene.objects.forEach((object) => {
    if (!object.parentId) return
    const parent = objectById.get(object.parentId)
    if (!parent || parent.type !== 'group' || parent.id === object.id) {
      delete object.parentId
      return
    }
    const visited = new Set([object.id])
    let ancestor: typeof parent | undefined = parent
    while (ancestor) {
      if (visited.has(ancestor.id)) {
        delete object.parentId
        break
      }
      visited.add(ancestor.id)
      ancestor = ancestor.parentId ? objectById.get(ancestor.parentId) : undefined
    }
  })
  scene.paths.forEach((path) => {
    path.visible = path.visible !== false
    path.color ||= '#7ee0c0'
    path.closed = Boolean(path.closed)
    path.locked = Boolean(path.locked)
    path.points = (path.points ?? []).filter((point) => Array.isArray(point?.position))
  })
  scene.paths = scene.paths.filter((path) => path.points.length >= 2)
  scene.cameras.forEach((camera) => {
    camera.visible = camera.visible !== false
    // Lens defaults are backfilled before the constraint branches below, which return early.
    camera.depthOfField = camera.depthOfField === true
    camera.focusDistance ??= numericProperty(`${camera.id}-focus-distance`, 8)
    camera.fStop ??= numericProperty(`${camera.id}-f-stop`, 2.8)
    const constraint = camera.pathConstraint
    if (constraint) {
      if (!scene.paths.some((path) => path.id === constraint.pathId)) delete camera.pathConstraint
      else {
        constraint.orientation = constraint.orientation === 'look-at' ? 'look-at' : 'tangent'
        constraint.progress ??= numericProperty(`${camera.id}-path-progress`, 0)
        constraint.bank ??= numericProperty(`${camera.id}-path-bank`, 0)
        constraint.offset ??= makePathOffset(camera.id)
        if (constraint.lookAtEntityId && !sceneHasEntity(scene, constraint.lookAtEntityId)) delete constraint.lookAtEntityId
      }
    }
    const objectConstraint = camera.objectConstraint
    if (!objectConstraint) return
    if (!scene.objects.some((object) => object.id === objectConstraint.objectId)) {
      delete camera.objectConstraint
      return
    }
    const defaults = createCameraObjectConstraint(camera.id, objectConstraint.objectId)
    objectConstraint.orientation = objectConstraint.orientation === 'look-at' ? 'look-at' : 'target'
    objectConstraint.positionOffset ??= defaults.positionOffset
    objectConstraint.rotationOffset ??= defaults.rotationOffset
    if (objectConstraint.lookAtEntityId && !sceneHasEntity(scene, objectConstraint.lookAtEntityId)) delete objectConstraint.lookAtEntityId
    // Older or hand-edited files may contain both; object follow is the newer explicit choice.
    delete camera.pathConstraint
  })
  scene.lights.forEach((light) => {
    light.visible = light.visible !== false
    if (light.type !== 'spot') return
    light.angle ??= numericProperty(`${light.id}-angle`, 32)
    light.distance ??= numericProperty(`${light.id}-distance`, 0)
    light.penumbra ??= numericProperty(`${light.id}-penumbra`, .25)
  })
  return scene
}

const finiteOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

function normalizeRigProperty(bone: Partial<AuroraRigBone>, key: 'rotation' | 'offsetX' | 'offsetY' | 'stretch', boneId: string, value: number) {
  const property = bone[key]
  if (!property || typeof property !== 'object') {
    bone[key] = numericProperty(`${boneId}-${key}`, value)
    return
  }
  property.id ||= `${boneId}-${key}`
  property.value = finiteOr(property.value, value)
  property.animated = Boolean(property.animated)
  property.keyframes = Array.isArray(property.keyframes)
    ? property.keyframes.filter((keyframe) => keyframe && Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value))
    : []
}

/**
 * Rigs arrive from disk, so nothing about them is trusted: a bone missing a pose channel, a grid
 * wide enough to stall a frame, or a parent that no longer exists all have to survive as something
 * posable rather than as a crash on the first render.
 */
function normalizeRigs(raw: unknown): AuroraRig[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((rig): rig is AuroraRig => Boolean(rig?.id) && Array.isArray(rig?.bones))
    .map((rig) => {
      rig.name ||= 'Rig'
      rig.columns = Math.max(MIN_RIG_CELLS, Math.min(MAX_RIG_CELLS, Math.round(finiteOr(rig.columns, 12))))
      rig.rows = Math.max(MIN_RIG_CELLS, Math.min(MAX_RIG_CELLS, Math.round(finiteOr(rig.rows, 12))))
      rig.bones = rig.bones.filter((bone) => Boolean(bone?.id))
      const boneIds = new Set(rig.bones.map((bone) => bone.id))
      rig.bones.forEach((bone, index) => {
        bone.name ||= `Bone ${index + 1}`
        bone.x = finiteOr(bone.x, 0)
        bone.y = finiteOr(bone.y, 0)
        bone.angle = finiteOr(bone.angle, 90)
        bone.length = Math.max(0, finiteOr(bone.length, .5))
        bone.falloff = Math.max(0, finiteOr(bone.falloff, .8))
        if (bone.parentId && (!boneIds.has(bone.parentId) || bone.parentId === bone.id)) delete bone.parentId
        normalizeRigProperty(bone, 'rotation', bone.id, 0)
        normalizeRigProperty(bone, 'offsetX', bone.id, 0)
        normalizeRigProperty(bone, 'offsetY', bone.id, 0)
        normalizeRigProperty(bone, 'stretch', bone.id, 1)
      })
      return rig
    })
}

/** A rig that no longer exists would otherwise leave a layer permanently claiming to be rigged. */
function pruneRigReferences(layers: EditorLayer[], scenes: Aurora3DScene[], rigs: AuroraRig[]) {
  const known = new Set(rigs.map((rig) => rig.id))
  const walk = (list: EditorLayer[]) => list.forEach((layer) => {
    if (layer.rigId && !known.has(layer.rigId)) delete layer.rigId
    if (layer.children) walk(layer.children)
  })
  walk(layers)
  scenes.forEach((scene) => scene.objects.forEach((object) => {
    if (object.rigId && !known.has(object.rigId)) delete object.rigId
  }))
}

function cloneFallback(fallback: EditorStateFallback): SerializedEditorState {
  const state = clone(fallback)
  const graph = normalizeNodeGraph(state.nodes, state.nodeConnections, state.layers)
  const scenes3D = state.scenes3D.map(normalizeScene)
  const rigs = normalizeRigs(state.rigs)
  pruneRigReferences(state.layers, scenes3D, rigs)
  return { ...state, scenes3D, rigs, nodes: graph.nodes, nodeConnections: graph.connections }
}

function sceneHasEntity(scene: Aurora3DScene, entityId: string) {
  return scene.objects.some((item) => item.id === entityId)
    || scene.lights.some((item) => item.id === entityId)
    || scene.cameras.some((item) => item.id === entityId)
}

export function serializeEditorState(state: SerializedEditorState): string {
  return JSON.stringify({
    project: { ...state.project, version: CURRENT_PROJECT_VERSION },
    layers: state.layers,
    scenes3D: state.scenes3D,
    assets: state.assets.map((asset) => ({ ...asset, thumbnail: asset.thumbnail?.startsWith('blob:') ? undefined : asset.thumbnail })),
    nodes: state.nodes,
    nodeConnections: state.nodeConnections,
    rigs: state.rigs,
  })
}

export function deserializeEditorState(raw: string | null, fallback: EditorStateFallback): SerializedEditorState {
  if (!raw) return cloneFallback(fallback)
  try {
    const parsed = JSON.parse(raw) as Partial<SerializedEditorState>
    if (!parsed.project || !Array.isArray(parsed.layers)) return cloneFallback(fallback)
    const fallbackScene = fallback.scenes3D[0]
    const scenes3D = Array.isArray(parsed.scenes3D)
      ? parsed.scenes3D
      : fallbackScene ? [clone(fallbackScene)] : []
    if ((parsed.project.version ?? 1) < 3) {
      const demoCamera = scenes3D.find((scene) => scene.id === 'scene-aurora-3d')?.cameras.find((camera) => camera.id === 'camera-main')
      const untouchedOldPose = demoCamera
        && demoCamera.transform.position.x.value === 4.8
        && demoCamera.transform.position.y.value === 3.2
        && demoCamera.transform.position.z.value === 6.2
        && demoCamera.transform.rotation.x.value === -22.4
        && demoCamera.transform.rotation.y.value === 37.8
        && demoCamera.transform.rotation.z.value === 0
      if (untouchedOldPose) {
        demoCamera.transform.position.x.value = 0
        demoCamera.transform.position.y.value = 2.4
        demoCamera.transform.position.z.value = 7
        demoCamera.transform.rotation.x.value = -18.924644416051237
        demoCamera.transform.rotation.y.value = 0
        demoCamera.transform.rotation.z.value = 0
      }
      const demoKeyLight = scenes3D.find((scene) => scene.id === 'scene-aurora-3d')?.lights.find((light) => light.id === 'light-key')
      const untouchedOldLight = demoKeyLight
        && demoKeyLight.transform.position.x.value === 4
        && demoKeyLight.transform.position.y.value === 7
        && demoKeyLight.transform.position.z.value === 5
        && demoKeyLight.transform.rotation.x.value === 0
        && demoKeyLight.transform.rotation.y.value === 0
        && demoKeyLight.transform.rotation.z.value === 0
      if (untouchedOldLight) {
        demoKeyLight.transform.rotation.x.value = -54.46232220802562
        demoKeyLight.transform.rotation.y.value = 24.937982703241797
      }
    }
    const layers = clone(parsed.layers)
    if ((parsed.project.version ?? 1) < 2 && fallbackScene && !layers.some((layer) => layer.type === '3d-scene')) {
      const demoLayer = fallback.layers.find((layer) => layer.type === '3d-scene')
      if (demoLayer) layers.splice(Math.min(2, layers.length), 0, clone(demoLayer))
    }
    const normalizedScenes = clone(scenes3D).map(normalizeScene)
    const rigs = normalizeRigs(clone(parsed.rigs ?? []))
    pruneRigReferences(layers, normalizedScenes, rigs)
    return {
      project: { ...clone(parsed.project), version: CURRENT_PROJECT_VERSION },
      ...(() => {
        const graph = normalizeNodeGraph(parsed.nodes, parsed.nodeConnections, layers, parsed.project.version ?? 1)
        return { nodes: clone(graph.nodes), nodeConnections: clone(graph.connections) }
      })(),
      layers,
      scenes3D: normalizedScenes,
      assets: Array.isArray(parsed.assets) ? clone(parsed.assets) : clone(fallback.assets),
      rigs,
    }
  } catch {
    return cloneFallback(fallback)
  }
}
