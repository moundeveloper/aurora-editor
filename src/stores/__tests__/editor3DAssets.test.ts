import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../editor'
import type { MediaAsset } from '@/models/editor'

const RADIANCE: MediaAsset = { id: 'env-1', name: 'studio.hdr', kind: 'hdr', hash: 'hash-env' }
const MESH: MediaAsset = { id: 'mesh-1', name: 'drone.glb', kind: 'model3d', hash: 'hash-mesh' }
const IMAGE: MediaAsset = { id: 'img-1', name: 'poster.png', kind: 'image', hash: 'hash-img' }

describe('3D environment maps', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('points the scene at a radiance map and refuses anything that is not one', () => {
    const store = useEditorStore()
    store.assets.push(RADIANCE, IMAGE)
    const scene = store.selectedScene!

    expect(store.set3DEnvironmentMap('img-1')).toBe(false)
    expect(store.set3DEnvironmentMap('missing')).toBe(false)
    expect(scene.environmentAssetId).toBeUndefined()

    expect(store.set3DEnvironmentMap('env-1')).toBe(true)
    expect(scene.environmentAssetId).toBe('env-1')
  })

  it('only offers the map as a backdrop while a map is actually set', () => {
    const store = useEditorStore()
    store.assets.push(RADIANCE)
    const scene = store.selectedScene!

    expect(store.set3DEnvironmentBackground(true)).toBe(false)

    store.set3DEnvironmentMap('env-1')
    expect(store.set3DEnvironmentBackground(true)).toBe(true)
    expect(scene.environmentBackground).toBe(true)

    // Clearing the map must not leave the scene drawing a backdrop it no longer has.
    store.set3DEnvironmentMap(null)
    expect(scene.environmentAssetId).toBeUndefined()
    expect(scene.environmentBackground).toBe(false)
  })
})

describe('3D imported meshes', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('needs a mesh in the library before it will place one', () => {
    const store = useEditorStore()
    expect(store.add3DModel()).toBeNull()

    store.assets.push(MESH)
    const object = store.add3DModel()!

    expect(object.primitive).toBe('model')
    expect(object.assetId).toBe('mesh-1')
    expect(object.name).toBe('drone')
    expect(store.selectedSceneEntityId).toBe(object.id)
  })

  it('keeps the PBR sliders and the influence stack away from an imported subtree', () => {
    const store = useEditorStore()
    store.assets.push(MESH)
    const object = store.add3DModel()!
    const roughness = object.material.roughness.value

    // The file carries its own materials and geometry, so neither path can reach it.
    store.set3DObjectMaterial('roughness', .1)
    expect(object.material.roughness.value).toBe(roughness)
    expect(store.add3DInfluence('displace')).toBeNull()
    expect(store.add3DInfluence('array')).toBeNull()
    expect(object.influences).toHaveLength(0)
  })

  it('swaps the chosen file and refuses a non-mesh asset', () => {
    const store = useEditorStore()
    store.assets.push(MESH, IMAGE, { id: 'mesh-2', name: 'gate.glb', kind: 'model3d', hash: 'hash-gate' })
    const object = store.add3DModel('mesh-1')!

    expect(store.set3DObjectModel('img-1')).toBe(false)
    expect(object.assetId).toBe('mesh-1')

    expect(store.set3DObjectModel('mesh-2')).toBe(true)
    expect(object.assetId).toBe('mesh-2')

    expect(store.set3DObjectModel(null)).toBe(true)
    expect(object.assetId).toBeUndefined()
  })
})

describe('3D camera lens', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('switches on depth of field with keyframeable focus and aperture', () => {
    const store = useEditorStore()
    const scene = store.selectedScene!
    const camera = scene.cameras[0]!
    store.selectSceneEntity(scene.id, camera.id)

    expect(store.set3DCameraDepthOfField(true)).toBe(true)
    expect(camera.depthOfField).toBe(true)
    expect(camera.focusDistance?.value).toBe(8)
    expect(camera.fStop?.value).toBe(2.8)

    store.set3DCameraLens('focusDistance', -5)
    store.set3DCameraLens('fStop', 40)
    expect(camera.focusDistance?.value).toBe(.01)
    expect(camera.fStop?.value).toBe(22)

    store.toggle3DKeyframe(camera.focusDistance!.id)
    store.toggle3DKeyframe(camera.fStop!.id)
    expect(camera.focusDistance?.animated).toBe(true)
    expect(camera.fStop?.keyframes).toHaveLength(1)
  })
})
