import { describe, expect, it } from 'vitest'
import type { SerializedEditorState } from '../../../src/models/editor.ts'
import { createPillarRunProject } from '../showcase.ts'
import { addProjectModel, setProjectCameraLens, setProjectEnvironment, upsertProjectLight } from '../sceneMutation.ts'

function project(): SerializedEditorState {
  return createPillarRunProject('Mutation Test', 'mutation-test')
}

const SCENE = 'scene-pillar-run'

describe('camera lens mutation', () => {
  it('authors a focus pull as an editable curve', () => {
    const snapshot = project()
    const revision = snapshot.scenes3D[0]!.revision

    const { camera } = setProjectCameraLens(snapshot, {
      projectId: 'mutation-test', sceneId: SCENE, cameraId: 'camera-drone-chase',
      depthOfField: true,
      focusDistance: { keyframes: [[12, 24], [0, 3.2], [3.2, 9]].map(([time, value]) => ({ time: time!, value: value! })) },
      fStop: { value: 2 },
    })

    expect(camera.depthOfField).toBe(true)
    expect(camera.fStop?.value).toBe(2)
    expect(camera.focusDistance?.animated).toBe(true)
    // Out-of-order input is sorted, so the curve is usable without the caller ordering it.
    expect(camera.focusDistance?.keyframes.map((keyframe) => keyframe.time)).toEqual([0, 3.2, 12])
    expect(camera.focusDistance?.value).toBe(3.2)
    expect(snapshot.scenes3D[0]!.revision).toBe(revision + 1)
  })

  it('refuses a camera that does not exist, and an orthographic one', () => {
    const snapshot = project()
    expect(() => setProjectCameraLens(snapshot, { projectId: 'mutation-test', sceneId: SCENE, cameraId: 'nope' }))
      .toThrow(/Unknown camera/)

    snapshot.scenes3D[0]!.cameras[0]!.projection = 'orthographic'
    expect(() => setProjectCameraLens(snapshot, {
      projectId: 'mutation-test', sceneId: SCENE, cameraId: 'camera-drone-chase', depthOfField: true,
    })).toThrow(/orthographic/)
  })

  it('rejects a non-finite value rather than writing a broken curve', () => {
    const snapshot = project()
    expect(() => setProjectCameraLens(snapshot, {
      projectId: 'mutation-test', sceneId: SCENE, cameraId: 'camera-drone-chase', fStop: { value: Number.NaN },
    })).toThrow(/must be finite/)
  })
})

describe('light mutation', () => {
  it('adds a spot with an animated cone and an unbounded range', () => {
    const snapshot = project()

    const { light } = upsertProjectLight(snapshot, {
      projectId: 'mutation-test', sceneId: SCENE, lightId: 'probe-spot', type: 'spot',
      name: 'Probe Spot', color: '#eaf7ff', intensity: { value: 60 },
      position: [0, 8, 4], rotation: [-90, 0, 0],
      angle: { keyframes: [{ time: 0, value: 12 }, { time: 4, value: 30 }] },
      penumbra: { value: .4 },
    })

    expect(light.type).toBe('spot')
    expect(light.transform.position.y.value).toBe(8)
    expect(light.transform.rotation.x.value).toBe(-90)
    expect(light.angle?.animated).toBe(true)
    expect(light.penumbra?.value).toBe(.4)
    // An unset range must default to unlimited: a short one silently kills the light.
    expect(light.distance?.value).toBe(0)
  })

  it('updates an existing light in place without disturbing untouched channels', () => {
    const snapshot = project()
    const before = snapshot.scenes3D[0]!.lights.find((light) => light.id === 'drone-searchlight')!
    const lightCount = snapshot.scenes3D[0]!.lights.length

    const { light } = upsertProjectLight(snapshot, {
      projectId: 'mutation-test', sceneId: SCENE, lightId: 'drone-searchlight', type: 'spot',
      angle: { value: 22 },
    })

    expect(snapshot.scenes3D[0]!.lights).toHaveLength(lightCount)
    expect(light.angle?.value).toBe(22)
    expect(light.name).toBe(before.name)
    expect(light.color).toBe(before.color)
    // The flight-path animation on this light must survive a cone-only edit.
    expect(light.transform.position.z.animated).toBe(true)
    expect(light.intensity.animated).toBe(true)
  })

  it('leaves cone fields off a light that has no cone', () => {
    const snapshot = project()
    const { light } = upsertProjectLight(snapshot, {
      projectId: 'mutation-test', sceneId: SCENE, lightId: 'probe-point', type: 'point', intensity: { value: 20 },
    })

    expect(light.angle).toBeUndefined()
    expect(light.distance).toBeUndefined()
  })
})

describe('environment mutation', () => {
  it('needs a radiance asset, not just any asset', () => {
    const snapshot = project()
    snapshot.assets.push({ id: 'poster', name: 'poster.png', kind: 'image', hash: 'hash-poster' })

    expect(() => setProjectEnvironment(snapshot, { projectId: 'mutation-test', sceneId: SCENE, assetId: 'poster' }))
      .toThrow(/not an hdr/)
    expect(() => setProjectEnvironment(snapshot, { projectId: 'mutation-test', sceneId: SCENE, assetId: 'missing' }))
      .toThrow(/Unknown asset/)
  })

  it('points the scene at a map and clears it again', () => {
    const snapshot = project()
    snapshot.assets.push({ id: 'sky', name: 'canyon.hdr', kind: 'hdr', hash: 'hash-sky' })

    setProjectEnvironment(snapshot, { projectId: 'mutation-test', sceneId: SCENE, assetId: 'sky', background: true, intensity: 1.4 })
    expect(snapshot.scenes3D[0]!.environmentAssetId).toBe('sky')
    expect(snapshot.scenes3D[0]!.environmentBackground).toBe(true)
    expect(snapshot.scenes3D[0]!.environmentIntensity).toBe(1.4)

    setProjectEnvironment(snapshot, { projectId: 'mutation-test', sceneId: SCENE, assetId: null })
    expect(snapshot.scenes3D[0]!.environmentAssetId).toBeUndefined()
    // Clearing the map must not leave the scene drawing a backdrop it no longer has.
    expect(snapshot.scenes3D[0]!.environmentBackground).toBe(false)
  })
})

describe('model mutation', () => {
  it('places a glTF mesh as a model object', () => {
    const snapshot = project()
    snapshot.assets.push({ id: 'prop', name: 'beacon.glb', kind: 'model3d', hash: 'hash-prop' })

    const { object } = addProjectModel(snapshot, {
      projectId: 'mutation-test', sceneId: SCENE, assetId: 'prop', objectId: 'beacon',
      position: [2, 0, -4], scale: [1.5, 1.5, 1.5], parentId: 'drone-root',
    })

    expect(object.primitive).toBe('model')
    expect(object.assetId).toBe('prop')
    expect(object.name).toBe('beacon')
    expect(object.parentId).toBe('drone-root')
    expect(object.transform.scale.x.value).toBe(1.5)
  })

  it('refuses a non-mesh asset and a parent that is not a group', () => {
    const snapshot = project()
    snapshot.assets.push({ id: 'poster', name: 'poster.png', kind: 'image', hash: 'hash-poster' })
    snapshot.assets.push({ id: 'prop', name: 'beacon.glb', kind: 'model3d', hash: 'hash-prop' })

    expect(() => addProjectModel(snapshot, { projectId: 'mutation-test', sceneId: SCENE, assetId: 'poster' }))
      .toThrow(/not a glTF mesh/)
    expect(() => addProjectModel(snapshot, {
      projectId: 'mutation-test', sceneId: SCENE, assetId: 'prop', parentId: 'drone-body',
    })).toThrow(/not a group/)
  })
})
