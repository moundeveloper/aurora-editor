import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import type { AuroraCamera } from '@/models/editor'

export interface CameraLens {
  /** Distance to the sharp plane, in scene units. */
  focus: number
  /** Bokeh growth per scene unit of defocus, in UV. */
  aperture: number
  /** Largest bokeh circle the pass may draw, as a fraction of the frame. */
  maxBlur: number
}

/**
 * Bokeh diameter at full defocus, as a fraction of the frame. The f-number is what a viewer reads as
 * depth of field, so it drives this directly. The range is calibrated against the shader: below about
 * 0.008 the circle is under two pixels at preview size and reads as nothing at all, and above 0.05 it
 * dissolves the frame, so a wide-open lens sits at the top of that window and f/22 near the bottom.
 */
function bokehCeiling(fStop: number) {
  return Math.max(.004, Math.min(.05, .075 / fStop))
}

/**
 * Bokeh parameters for a camera, in the units Three's BokehShader expects.
 *
 * The shader blurs by `clamp((focus + viewZ) * aperture, -maxBlur, maxBlur)` — linear in defocus
 * distance, where a real lens is hyperbolic in it. That rules out a thin-lens derivation: feeding one
 * in produces an aperture two orders of magnitude above the clamp, so every out-of-focus depth
 * saturates to the same circle and the focus distance stops mattering at all. This is calibrated
 * against the shader instead, with each term named for what it controls:
 *
 * - `maxBlur` is the bokeh size at full defocus, and carries the f-number.
 * - `aperture` is expressed as the distance over which the circle grows to that ceiling. One focus
 *   distance is a natural scale for it, widened by the field of view so a long lens goes shallow and
 *   a wide-angle stays deep, which is the one part of lens behaviour worth keeping.
 */
export function cameraLensAtTime(camera: AuroraCamera, time: number): CameraLens | null {
  // Depth of field is a property of a lens, and an orthographic projection has no lens to model.
  if (!camera.depthOfField || camera.projection !== 'perspective') return null
  if (!camera.focusDistance || !camera.fStop) return null
  const focus = Math.max(.01, evaluateNumericProperty(camera.focusDistance, time))
  const fStop = Math.max(1, evaluateNumericProperty(camera.fStop, time))
  const fovRadians = Math.max(.01, evaluateNumericProperty(camera.fov, time)) * Math.PI / 180
  const maxBlur = bokehCeiling(fStop)
  const rampDistance = Math.max(.25, focus * 2 * Math.tan(fovRadians / 2))
  return { focus, aperture: maxBlur / rampDistance, maxBlur }
}
