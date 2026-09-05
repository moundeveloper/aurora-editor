import { reactive } from 'vue'
import type { ViewportShadingMode } from '@/engine/rendering/AuroraViewportModes'

/**
 * Viewport shading is session state shared between the 3D workspace and the camera preview, so the
 * preview renders in whatever mode the viewport is set to. It is deliberately outside project
 * serialization and editor history: it describes how you are looking, not what the scene is.
 */
const state = reactive<{ mode: ViewportShadingMode; wireOverlay: boolean }>({
  mode: 'rendered',
  wireOverlay: false,
})

export function useViewportShading() {
  return state
}
