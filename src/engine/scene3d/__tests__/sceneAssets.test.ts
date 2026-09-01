import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ThreeSceneRuntimeRegistry, environmentAssetFor, environmentDecoderFor, modelAssetFor,
} from '@/engine/scene3d/ThreeSceneRuntime'
import { createDemo3DScene, createPrimitiveObject } from '@/engine/scene3d/sceneFactory'
import type { Aurora3DScene, MediaAsset } from '@/models/editor'

function asset(overrides: Partial<MediaAsset> & Pick<MediaAsset, 'id' | 'name' | 'kind'>): MediaAsset {
  return { hash: `hash-${overrides.id}`, ...overrides }
}

function assetMap(...items: MediaAsset[]) {
  return new Map(items.map((item) => [item.id, item]))
}

describe('environment maps', () => {
  it('picks a decoder per radiance format and refuses anything else', () => {
    expect(environmentDecoderFor('studio.hdr')).toBe('rgbe')
    expect(environmentDecoderFor('STUDIO.HDR')).toBe('rgbe')
    expect(environmentDecoderFor('bay.exr')).toBe('exr')
    expect(environmentDecoderFor('poster.png')).toBeNull()
    expect(environmentDecoderFor('no-extension')).toBeNull()
  })

  it('resolves only an hdr asset that still has bytes in the vault', () => {
    const scene = createDemo3DScene()
    const radiance = asset({ id: 'env', name: 'studio.hdr', kind: 'hdr' })
    const image = asset({ id: 'img', name: 'poster.png', kind: 'image' })

    scene.environmentAssetId = 'env'
    expect(environmentAssetFor(scene, assetMap(radiance, image))?.id).toBe('env')

    scene.environmentAssetId = 'img'
    expect(environmentAssetFor(scene, assetMap(radiance, image))).toBeUndefined()

    scene.environmentAssetId = 'missing'
    expect(environmentAssetFor(scene, assetMap(radiance))).toBeUndefined()

    scene.environmentAssetId = 'env'
    expect(environmentAssetFor(scene, assetMap(asset({ id: 'env', name: 'studio.hdr', kind: 'hdr', hash: undefined })))).toBeUndefined()
  })

  it('drives scene environment strength and keeps the flat background without a map', () => {
    const scene = createDemo3DScene()
    scene.environmentIntensity = .6
    scene.settings.backgroundColor = '#101820'
    const registry = new ThreeSceneRuntimeRegistry()

    const runtime = registry.get(scene, 640, 360, 0)

    expect(runtime.scene.environment).toBeNull()
    expect(runtime.scene.environmentIntensity).toBeCloseTo(.6)
    expect((runtime.scene.background as THREE.Color).getHexString()).toBe('101820')
    registry.dispose()
  })

  it('keeps the flat background while an authored map is still loading', () => {
    const scene = createDemo3DScene()
    scene.environmentAssetId = 'env'
    scene.environmentBackground = true
    scene.settings.backgroundColor = '#101820'
    const registry = new ThreeSceneRuntimeRegistry()

    const runtime = registry.get(scene, 640, 360, 0, [asset({ id: 'env', name: 'studio.hdr', kind: 'hdr' })])

    // The decode is asynchronous, so the frame before it lands must still be renderable.
    expect(runtime.scene.environment).toBeNull()
    expect((runtime.scene.background as THREE.Color).getHexString()).toBe('101820')
    expect(runtime.scene.userData.auroraEnvironmentUrl).toContain('hash-env')
    registry.dispose()
  })
})

describe('imported meshes', () => {
  function sceneWithModel(): { scene: Aurora3DScene; objectId: string } {
    const scene = createDemo3DScene()
    const object = createPrimitiveObject('model', 1)
    object.assetId = 'mesh'
    object.castShadow = true
    object.receiveShadow = true
    scene.objects.push(object)
    return { scene, objectId: object.id }
  }

  it('resolves only a model asset that still has bytes in the vault', () => {
    const { scene } = sceneWithModel()
    const object = scene.objects.at(-1)!
    const mesh = asset({ id: 'mesh', name: 'drone.glb', kind: 'model3d' })

    expect(modelAssetFor(object, assetMap(mesh))?.id).toBe('mesh')
    expect(modelAssetFor(object, assetMap(asset({ id: 'mesh', name: 'drone.glb', kind: 'image' })))).toBeUndefined()
    expect(modelAssetFor({ ...object, primitive: 'box' }, assetMap(mesh))).toBeUndefined()
  })

  it('hosts an imported subtree instead of building a primitive', () => {
    const { scene, objectId } = sceneWithModel()
    const registry = new ThreeSceneRuntimeRegistry()

    const runtime = registry.get(scene, 640, 360, 0, [asset({ id: 'mesh', name: 'drone.glb', kind: 'model3d' })])
    const host = runtime.objects.get(objectId)!

    // A model must not fall through to the box geometry the other primitives share.
    expect(host).not.toBeInstanceOf(THREE.Mesh)
    expect(host.userData.auroraModelUrl).toContain('hash-mesh')
    registry.dispose()
  })

  it('rebuilds the runtime when the chosen file changes', () => {
    const { scene, objectId } = sceneWithModel()
    const assets = [
      asset({ id: 'mesh', name: 'drone.glb', kind: 'model3d' }),
      asset({ id: 'other', name: 'gate.glb', kind: 'model3d' }),
    ]
    const registry = new ThreeSceneRuntimeRegistry()
    const first = registry.get(scene, 640, 360, 0, assets)
    const firstKey = first.structureKey

    scene.objects.find((object) => object.id === objectId)!.assetId = 'other'
    const second = registry.get(scene, 640, 360, 0, assets)

    expect(second.structureKey).not.toBe(firstKey)
    expect(second.objects.get(objectId)!.userData.auroraModelUrl).toContain('hash-other')
    registry.dispose()
  })
})
