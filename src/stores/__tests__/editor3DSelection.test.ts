import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
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

  it('groups several objects under one transform-only scene entity', () => {
    const store = useEditorStore()
    const scene = store.selectedScene!
    const first = scene.objects[0]!
    const second = store.add3DPrimitive('sphere')!
    const firstWorldX = first.transform.position.x.value
    const secondWorldX = second.transform.position.x.value

    const group = store.add3DGroup([first.id, second.id])!

    expect(group.type).toBe('group')
    expect(first.parentId).toBe(group.id)
    expect(second.parentId).toBe(group.id)
    expect(store.selectedSceneEntityId).toBe(group.id)
    expect(store.selectedSceneEntity?.value.id).toBe(group.id)
    expect(group.transform.position.x.value + first.transform.position.x.value).toBe(firstWorldX)
    expect(group.transform.position.x.value + second.transform.position.x.value).toBe(secondWorldX)
    expect(store.add3DInfluence('array')?.type).toBe('array')
    expect(store.add3DInfluence('displace')).toBeNull()

    group.transform.position.x.value += 2
    expect(store.ungroup3DObject(group.id)).toBe(true)
    expect(scene.objects.some((object) => object.id === group.id)).toBe(false)
    expect(first.parentId).toBeUndefined()
    expect(second.parentId).toBeUndefined()
    expect(first.transform.position.x.value).toBeCloseTo(firstWorldX + 2)
    expect(second.transform.position.x.value).toBeCloseTo(secondWorldX + 2)
  })

  it('adds a spot light with an editable, keyframeable cone', () => {
    const store = useEditorStore()

    const light = store.add3DLight('spot')!

    expect(light.type).toBe('spot')
    expect(light.angle?.value).toBe(32)
    expect(light.distance?.value).toBe(0)
    expect(light.penumbra?.value).toBe(.25)
    expect(store.selectedSceneEntityId).toBe(light.id)

    store.set3DLightCone('angle', 140)
    store.set3DLightCone('distance', -4)
    store.set3DLightCone('penumbra', 2)
    expect(light.angle?.value).toBe(89)
    expect(light.distance?.value).toBe(0)
    expect(light.penumbra?.value).toBe(1)

    // Keyframing resolves through the selected entity's animatable channel list, so a successful
    // toggle proves the cone properties are reachable from the timeline and curve editor.
    store.toggle3DKeyframe(light.angle!.id)
    store.toggle3DKeyframe(light.distance!.id)
    store.toggle3DKeyframe(light.penumbra!.id)
    expect(light.angle?.animated).toBe(true)
    expect(light.distance?.keyframes).toHaveLength(1)
    expect(light.penumbra?.keyframes).toHaveLength(1)
  })

  it('aims a new spot light at the authored content instead of past it', () => {
    const store = useEditorStore()
    const scene = store.selectedScene!

    const light = store.add3DLight('spot')!

    // The renderer drives the beam from local -Z, so the transform rotation decides what gets lit.
    const beam = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(light.transform.rotation.x.value),
      THREE.MathUtils.degToRad(light.transform.rotation.y.value),
      THREE.MathUtils.degToRad(light.transform.rotation.z.value),
      'XYZ',
    ))
    const origin = new THREE.Vector3(
      light.transform.position.x.value,
      light.transform.position.y.value,
      light.transform.position.z.value,
    )
    const coneAngle = THREE.MathUtils.degToRad(light.angle!.value)

    scene.objects.forEach((object) => {
      const toObject = new THREE.Vector3(
        object.transform.position.x.value,
        object.transform.position.y.value,
        object.transform.position.z.value,
      ).sub(origin)
      expect(toObject.normalize().angleTo(beam)).toBeLessThan(coneAngle)
    })
  })
})
