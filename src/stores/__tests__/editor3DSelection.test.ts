import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createDemo3DScene } from '@/engine/scene3d/sceneFactory'
import { useEditorStore } from '../editor'

describe('3D layer selection', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens the scene referenced by the selected 3D layer', () => {
    const store = useEditorStore()
    const scene = createDemo3DScene()
    scene.id = 'scene-second'
    scene.name = 'Second Scene'
    const layer = JSON.parse(JSON.stringify(store.layers.find((item) => item.type === '3d-scene')!)) as typeof store.layers[number]
    layer.id = 'layer-second-3d'
    layer.name = 'Second 3D Layer'
    layer.sceneId = scene.id
    store.scenes3D.push(scene)
    store.layers.push(layer)
    store.selectedSceneEntityId = 'missing-entity'

    store.select3DLayer(layer.id)

    expect(store.selectedLayerId).toBe(layer.id)
    expect(store.selectedScene?.id).toBe(scene.id)
    expect(store.selectedSceneEntityId).toBe(scene.objects[0]?.id)
  })

  it('keeps the selected 3D layer when entering the workspace', () => {
    const store = useEditorStore()
    const scene = createDemo3DScene()
    scene.id = 'scene-second'
    const layer = JSON.parse(JSON.stringify(store.layers.find((item) => item.type === '3d-scene')!)) as typeof store.layers[number]
    layer.id = 'layer-second-3d'
    layer.sceneId = scene.id
    store.scenes3D.push(scene)
    store.layers.push(layer)
    store.selectedLayerId = layer.id

    store.setWorkspace('3D')

    expect(store.selectedScene?.id).toBe(scene.id)
  })

  it('renames, hides, and deletes scene entities without removing the final camera', () => {
    const store = useEditorStore()
    const scene = store.selectedScene!
    const object = scene.objects[0]!
    const onlyCamera = scene.cameras[0]!

    expect(store.rename3DEntity(object.id, 'Renamed Object')).toBe(true)
    expect(object.name).toBe('Renamed Object')
    expect(store.set3DEntityVisible(object.id, false)).toBe(true)
    expect(object.visible).toBe(false)
    expect(store.delete3DEntity(object.id)).toBe(true)
    expect(scene.objects.some((item) => item.id === object.id)).toBe(false)
    expect(store.delete3DEntity(onlyCamera.id)).toBe(false)
    expect(scene.cameras).toHaveLength(1)
  })

  it('adds an image plane and lets the selected media be changed', () => {
    const store = useEditorStore()
    const image = store.assets.find((asset) => asset.kind === 'image')!

    const plane = store.add3DImagePlane(image.id)!

    expect(plane).toMatchObject({ primitive: 'plane', assetId: image.id, castShadow: false, receiveShadow: false })
    expect(plane.material).toMatchObject({ baseColor: '#ffffff' })
    expect(store.selectedSceneEntityId).toBe(plane.id)
    expect(store.set3DObjectImage(null)).toBe(true)
    expect(plane.assetId).toBeUndefined()
  })
})
