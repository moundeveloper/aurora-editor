import { describe, expect, it } from 'vitest'
import { cameraIdAtTime, normalizeCameraCuts } from '../cameraCuts'
import { createDemo3DScene } from '../sceneFactory'

describe('camera cuts', () => {
  it('keeps each camera active until the next cut', () => {
    const scene = createDemo3DScene()
    const firstCamera = scene.cameras[0]!
    const secondCamera = { ...structuredClone(firstCamera), id: 'camera-b', name: 'Camera B' }
    scene.cameras.push(secondCamera)
    scene.cameraCuts = [
      { id: 'cut-a', cameraId: firstCamera.id, time: 0 },
      { id: 'cut-b', cameraId: secondCamera.id, time: 5 },
    ]

    expect(cameraIdAtTime(scene, 4.999)).toBe(firstCamera.id)
    expect(cameraIdAtTime(scene, 5)).toBe(secondCamera.id)
    expect(cameraIdAtTime(scene, 12)).toBe(secondCamera.id)
  })

  it('repairs projects saved before camera cuts existed', () => {
    const scene = createDemo3DScene()
    scene.cameraCuts = undefined as never

    const cuts = normalizeCameraCuts(scene)

    expect(cuts).toEqual([{ id: `camera-cut-${scene.id}-0`, cameraId: scene.activeCameraId, time: 0 }])
  })

  it('drops missing cameras and restores a valid first cut at zero', () => {
    const scene = createDemo3DScene()
    const cameraId = scene.cameras[0]!.id

    const cuts = normalizeCameraCuts(scene, [
      { id: 'missing', cameraId: 'deleted-camera', time: 1 },
      { id: 'later', cameraId, time: 3 },
    ])

    expect(cuts).toEqual([
      { id: `camera-cut-${scene.id}-0`, cameraId, time: 0 },
      { id: 'later', cameraId, time: 3 },
    ])
  })
})
