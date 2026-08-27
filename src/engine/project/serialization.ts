import type {
  Aurora3DScene, EditorLayer, EditorNode, EditorNodeConnection, EditorProject, MediaAsset, SerializedEditorState,
} from '@/models/editor'
import { makePathOffset, numericProperty } from '@/engine/scene3d/sceneFactory'
import { createDemoNodeGraph, NODE_DEFINITIONS } from '@/engine/nodes/nodeGraph'
import { normalizeCameraCuts } from '@/engine/scene3d/cameraCuts'

export const CURRENT_PROJECT_VERSION = 8

export interface EditorStateFallback {
  project: EditorProject
  layers: EditorLayer[]
  scenes3D: Aurora3DScene[]
  assets: MediaAsset[]
  nodes?: EditorNode[]
  nodeConnections?: EditorNodeConnection[]
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
  scene.cameraCuts = normalizeCameraCuts(scene, scene.cameraCuts)
  if (!scene.cameras.some((camera) => camera.id === scene.activeCameraId)) scene.activeCameraId = scene.cameraCuts[0]?.cameraId ?? scene.cameras[0]?.id ?? null
  if (!Array.isArray(scene.paths)) scene.paths = []
  scene.objects.forEach((object) => {
    if (!Array.isArray(object.influences)) object.influences = []
    object.influences = object.influences.filter((influence) => influence?.type && influence.parameters)
  })
  scene.paths.forEach((path) => {
    path.color ||= '#7ee0c0'
    path.closed = Boolean(path.closed)
    path.locked = Boolean(path.locked)
    path.points = (path.points ?? []).filter((point) => Array.isArray(point?.position))
  })
  scene.paths = scene.paths.filter((path) => path.points.length >= 2)
  scene.cameras.forEach((camera) => {
    const constraint = camera.pathConstraint
    if (!constraint) return
    if (!scene.paths.some((path) => path.id === constraint.pathId)) {
      delete camera.pathConstraint
      return
    }
    constraint.orientation = constraint.orientation === 'look-at' ? 'look-at' : 'tangent'
    constraint.progress ??= numericProperty(`${camera.id}-path-progress`, 0)
    constraint.bank ??= numericProperty(`${camera.id}-path-bank`, 0)
    constraint.offset ??= makePathOffset(camera.id)
    if (constraint.lookAtEntityId && !sceneHasEntity(scene, constraint.lookAtEntityId)) delete constraint.lookAtEntityId
  })
  return scene
}

function cloneFallback(fallback: EditorStateFallback): SerializedEditorState {
  const state = clone(fallback)
  const graph = normalizeNodeGraph(state.nodes, state.nodeConnections, state.layers)
  return { ...state, scenes3D: state.scenes3D.map(normalizeScene), nodes: graph.nodes, nodeConnections: graph.connections }
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
  })
}

export function deserializeEditorState(raw: string | null, fallback: EditorStateFallback): SerializedEditorState {
  if (!raw) return cloneFallback(fallback)
  try {
    const parsed = JSON.parse(raw) as Partial<SerializedEditorState>
    if (!parsed.project || !Array.isArray(parsed.layers)) return cloneFallback(fallback)
    const fallbackScene = fallback.scenes3D[0]
    const scenes3D = Array.isArray(parsed.scenes3D) && parsed.scenes3D.length
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
    if (fallbackScene && !layers.some((layer) => layer.type === '3d-scene')) {
      const demoLayer = fallback.layers.find((layer) => layer.type === '3d-scene')
      if (demoLayer) layers.splice(Math.min(2, layers.length), 0, clone(demoLayer))
    }
    return {
      project: { ...clone(parsed.project), version: CURRENT_PROJECT_VERSION },
      ...(() => {
        const graph = normalizeNodeGraph(parsed.nodes, parsed.nodeConnections, layers, parsed.project.version ?? 1)
        return { nodes: clone(graph.nodes), nodeConnections: clone(graph.connections) }
      })(),
      layers,
      scenes3D: clone(scenes3D).map(normalizeScene),
      assets: Array.isArray(parsed.assets) ? clone(parsed.assets) : clone(fallback.assets),
    }
  } catch {
    return cloneFallback(fallback)
  }
}
