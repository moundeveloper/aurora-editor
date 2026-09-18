import { MOUSE } from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/** One navigation mapping for both 3D Scene and Modeling. A click is distinct from an orbit drag. */
export function configureViewportNavigation(controls:OrbitControls) {
  controls.mouseButtons.LEFT=MOUSE.ROTATE
  controls.mouseButtons.MIDDLE=MOUSE.PAN
  controls.mouseButtons.RIGHT=MOUSE.PAN
}
