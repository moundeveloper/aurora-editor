import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { AuroraSolidViewport } from '@/engine/rendering/AuroraSolidViewport'

describe('Aurora solid viewport', () => {
  it('temporarily replaces scene lighting with a camera-relative studio pass and restores it', () => {
    const texture = new THREE.Texture()
    const original = new THREE.MeshStandardMaterial({ color: '#080d18', map: texture, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original)
    const root = new THREE.Group()
    root.add(mesh)
    const scene = new THREE.Scene()
    const sceneLight = new THREE.DirectionalLight()
    const background = new THREE.Color('#010203')
    scene.background = background
    scene.add(root, sceneLight)
    const camera = new THREE.PerspectiveCamera()
    const solid = new AuroraSolidViewport()

    const restore = solid.apply(scene, root, camera)
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial)
    const replacement = mesh.material as THREE.MeshStandardMaterial
    expect(replacement.map).toBe(texture)
    expect(replacement.side).toBe(THREE.DoubleSide)
    expect(replacement.roughness).toBeGreaterThan(.6)
    expect(replacement.emissiveIntensity).toBe(0)
    expect(replacement.color.r).toBeGreaterThan(original.color.r)
    expect(sceneLight.visible).toBe(false)
    expect(scene.getObjectByName('Aurora Solid Studio')).toBeTruthy()
    expect(scene.background).not.toBe(background)

    restore()
    expect(mesh.material).toBe(original)
    expect(sceneLight.visible).toBe(true)
    expect(scene.getObjectByName('Aurora Solid Studio')).toBeFalsy()
    expect(scene.background).toBe(background)
    solid.dispose()
    mesh.geometry.dispose()
    original.dispose()
    texture.dispose()
  })
})
