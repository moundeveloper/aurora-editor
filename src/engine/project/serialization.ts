import type { Aurora3DScene, EditorLayer, EditorProject, MediaAsset, SerializedEditorState } from '@/models/editor'
import { makePathOffset, numericProperty } from '@/engine/scene3d/sceneFactory'

export const CURRENT_PROJECT_VERSION = 4

export interface EditorStateFallback {
  project: EditorProject
  layers: EditorLayer[]
  scenes3D: Aurora3DScene[]
  assets: MediaAsset[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Projects saved before 3D paths existed have no `paths` array and no camera constraints to repair. */
function normalizeScene(scene: Aurora3DScene): Aurora3DScene {
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
  state.scenes3D = state.scenes3D.map(normalizeScene)
  return state
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
      layers,
      scenes3D: clone(scenes3D).map(normalizeScene),
      assets: Array.isArray(parsed.assets) ? clone(parsed.assets) : clone(fallback.assets),
    }
  } catch {
    return cloneFallback(fallback)
  }
}
