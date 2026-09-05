import { describe, expect, it } from 'vitest'
import { cameraLensAtTime } from '@/engine/scene3d/cameraLens'
import { createDemo3DScene, numericProperty } from '@/engine/scene3d/sceneFactory'
import type { AuroraCamera } from '@/models/editor'

function lensCamera(overrides: Partial<AuroraCamera> = {}): AuroraCamera {
  const camera = createDemo3DScene().cameras[0]!
  camera.depthOfField = true
  camera.focusDistance = numericProperty('focus', 8)
  camera.fStop = numericProperty('f-stop', 2.8)
  camera.fov = numericProperty('fov', 50)
  return Object.assign(camera, overrides)
}

describe('camera lens', () => {
  it('stands down unless depth of field is switched on', () => {
    expect(cameraLensAtTime(lensCamera({ depthOfField: false }), 0)).toBeNull()
  })

  it('stands down for an orthographic camera, which has no lens to defocus', () => {
    expect(cameraLensAtTime(lensCamera({ projection: 'orthographic' }), 0)).toBeNull()
  })

  it('stands down for a camera authored before the lens existed', () => {
    const camera = lensCamera()
    delete camera.focusDistance
    expect(cameraLensAtTime(camera, 0)).toBeNull()
  })

  it('opening the aperture blurs faster and allows a bigger bokeh circle', () => {
    const wide = cameraLensAtTime(lensCamera({ fStop: numericProperty('f-stop', 1.4) }), 0)!
    const stoppedDown = cameraLensAtTime(lensCamera({ fStop: numericProperty('f-stop', 16) }), 0)!

    expect(wide.aperture).toBeGreaterThan(stoppedDown.aperture)
    expect(wide.maxBlur).toBeGreaterThan(stoppedDown.maxBlur)
  })

  it('keeps the bokeh circle inside the range the shader can actually show', () => {
    // Under about .008 the circle is sub-pixel at preview size; over .05 it dissolves the frame.
    const widest = cameraLensAtTime(lensCamera({ fStop: numericProperty('f-stop', 1) }), 0)!
    const narrowest = cameraLensAtTime(lensCamera({ fStop: numericProperty('f-stop', 22) }), 0)!

    expect(widest.maxBlur).toBeLessThanOrEqual(.05)
    expect(narrowest.maxBlur).toBeGreaterThanOrEqual(.004)
  })

  it('reaches the bokeh ceiling exactly one ramp distance out of focus', () => {
    const lens = cameraLensAtTime(lensCamera(), 0)!
    const rampDistance = 8 * 2 * Math.tan(25 * Math.PI / 180)

    // The shader multiplies defocus by aperture and clamps, so the ramp is where the two meet.
    expect(lens.aperture * rampDistance).toBeCloseTo(lens.maxBlur)
  })

  it('focusing further away deepens the field', () => {
    const near = cameraLensAtTime(lensCamera({ focusDistance: numericProperty('focus', 4) }), 0)!
    const far = cameraLensAtTime(lensCamera({ focusDistance: numericProperty('focus', 8) }), 0)!

    // Same ceiling, twice the distance to reach it: doubling the focus distance halves the ramp.
    expect(far.maxBlur).toBeCloseTo(near.maxBlur)
    expect(near.aperture / far.aperture).toBeCloseTo(2)
  })

  it('a wider field of view blurs less, because the same defocus covers fewer pixels', () => {
    const wideAngle = cameraLensAtTime(lensCamera({ fov: numericProperty('fov', 90) }), 0)!
    const telephoto = cameraLensAtTime(lensCamera({ fov: numericProperty('fov', 20) }), 0)!

    expect(telephoto.aperture).toBeGreaterThan(wideAngle.aperture)
  })

  it('samples animated focus at the requested time', () => {
    const camera = lensCamera()
    camera.focusDistance!.animated = true
    camera.focusDistance!.keyframes = [
      { id: 'k1', time: 0, value: 4, interpolation: 'linear' },
      { id: 'k2', time: 2, value: 12, interpolation: 'linear' },
    ]

    expect(cameraLensAtTime(camera, 1)!.focus).toBeCloseTo(8)
  })
})
