import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ThreeSceneRuntimeRegistry } from '../ThreeSceneRuntime'
import { createDemo3DScene, createPrimitiveObject } from '../sceneFactory'
import type { MediaAsset } from '@/models/editor'

afterEach(() => vi.restoreAllMocks())

describe('PBR texture slots', () => {
  it('preloads maps for exports, separates color from data, and updates without rebuilding geometry', async () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture())
    const scene = createDemo3DScene()
    const object = createPrimitiveObject('box', 1)
    object.material.maps = { map: 'image', normalMap: 'image', roughnessMap: 'image', metalnessMap: 'image', emissiveMap: 'image' }
    scene.objects = [object]
    const assets: MediaAsset[] = [{ id: 'image', name: 'material.png', kind: 'image', hash: 'texture' }]
    const registry = new ThreeSceneRuntimeRegistry()
    await registry.prepareAssets([scene], assets)
    const runtime = registry.get(scene, 64, 64, 0, assets)
    const mesh = runtime.objects.get(object.id) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    const material = mesh.material
    expect(load).toHaveBeenCalledTimes(2)
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(material.emissiveMap).toBe(material.map)
    expect(material.normalMap?.colorSpace).toBe(THREE.NoColorSpace)
    expect(material.roughnessMap).toBe(material.normalMap)
    expect(material.metalnessMap).toBe(material.normalMap)
    expect(material.normalMap).not.toBe(material.map)
    const geometry = mesh.geometry
    object.material.maps = {}
    registry.get(scene, 64, 64, 0, assets)
    expect(mesh.geometry).toBe(geometry)
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'] as const) {
      expect(material[slot]).toBeNull()
    }
    registry.dispose()
  })

  it('ignores missing/non-image assets and preserves legacy image planes', async () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture())
    const scene = createDemo3DScene()
    const object = createPrimitiveObject('plane', 1)
    object.assetId = 'image'
    object.material.maps = { normalMap: 'audio', roughnessMap: 'missing' }
    scene.objects = [object]
    const assets: MediaAsset[] = [
      { id: 'image', name: 'card.png', kind: 'image', hash: 'card' },
      { id: 'audio', name: 'sound.wav', kind: 'audio', hash: 'sound' },
    ]
    const registry = new ThreeSceneRuntimeRegistry()
    await registry.prepareAssets([scene], assets)
    const material = (registry.get(scene, 64, 64, 0, assets).objects.get(object.id) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material
    expect(material.map).not.toBeNull()
    expect(material.normalMap).toBeNull()
    expect(material.roughnessMap).toBeNull()
    expect(material.depthWrite).toBe(false)
    registry.dispose()
  })
})
