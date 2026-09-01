import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { AuroraSolidViewport } from '@/engine/rendering/AuroraSolidViewport'

describe('Aurora solid viewport', () => {
  it('temporarily replaces lit materials with brighter unlit equivalents and restores them', () => {
    const texture = new THREE.Texture()
    const original = new THREE.MeshStandardMaterial({ color: '#080d18', map: texture, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original)
    const root = new THREE.Group()
    root.add(mesh)
    const solid = new AuroraSolidViewport()

    const restore = solid.apply(root)
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial)
    const replacement = mesh.material as THREE.MeshBasicMaterial
    expect(replacement.map).toBe(texture)
    expect(replacement.side).toBe(THREE.DoubleSide)
    expect(replacement.toneMapped).toBe(false)
    expect(replacement.color.r).toBeGreaterThan(original.color.r)

    restore()
    expect(mesh.material).toBe(original)
    solid.dispose()
    mesh.geometry.dispose()
    original.dispose()
    texture.dispose()
  })
})
