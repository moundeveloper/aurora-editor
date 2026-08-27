import type { Aurora3DScene, EditorLayer, EditorProject, MediaAsset, SerializedEditorState } from '@/models/editor'

export const CURRENT_PROJECT_VERSION = 2

export interface EditorStateFallback {
  project: EditorProject
  layers: EditorLayer[]
  scenes3D: Aurora3DScene[]
  assets: MediaAsset[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
  if (!raw) return clone(fallback)
  try {
    const parsed = JSON.parse(raw) as Partial<SerializedEditorState>
    if (!parsed.project || !Array.isArray(parsed.layers)) return clone(fallback)
    const fallbackScene = fallback.scenes3D[0]
    const scenes3D = Array.isArray(parsed.scenes3D) && parsed.scenes3D.length
      ? parsed.scenes3D
      : fallbackScene ? [clone(fallbackScene)] : []
    const layers = clone(parsed.layers)
    if (fallbackScene && !layers.some((layer) => layer.type === '3d-scene')) {
      const demoLayer = fallback.layers.find((layer) => layer.type === '3d-scene')
      if (demoLayer) layers.splice(Math.min(2, layers.length), 0, clone(demoLayer))
    }
    return {
      project: { ...clone(parsed.project), version: CURRENT_PROJECT_VERSION },
      layers,
      scenes3D: clone(scenes3D),
      assets: Array.isArray(parsed.assets) ? clone(parsed.assets) : clone(fallback.assets),
    }
  } catch {
    return clone(fallback)
  }
}

