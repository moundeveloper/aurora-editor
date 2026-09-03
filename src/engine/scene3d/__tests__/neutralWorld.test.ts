import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { NEUTRAL_WORLD_RADIANCE, ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { createStarter3DScene } from '@/engine/scene3d/sceneFactory'

/**
 * A scene with no radiance map still has to light like Blender's default world, whose uniform grey
 * is what keeps a surface off pure black once the camera leaves the specular highlight. Three's
 * AmbientLight cannot supply that: it reaches indirect diffuse only and adds nothing to the
 * specular term, so the fallback has to be a probe.
 */
describe('neutral world probe', () => {
  it('lights a scene that has no radiance map', () => {
    const registry = new ThreeSceneRuntimeRegistry()
    const scene = createStarter3DScene('World')

    const runtime = registry.get(scene, 640, 360, 0)

    const environment = runtime.scene.environment
    expect(environment).toBeInstanceOf(THREE.DataTexture)
    expect(environment?.mapping).toBe(THREE.EquirectangularReflectionMapping)
    expect(runtime.scene.environmentIntensity).toBe(scene.environmentIntensity)
    registry.dispose()
  })

  /**
   * Three derives the filtered probe's mip chain from the source dimensions. A probe carrying one
   * constant invites shrinking the texture to a couple of texels, and under roughly 64x32 the
   * filtered result lights nothing at all — silently, with a fully black scene as the only symptom.
   */
  it('keeps the probe large enough for Three to filter into a working mip chain', () => {
    const registry = new ThreeSceneRuntimeRegistry()
    const runtime = registry.get(createStarter3DScene('World'), 640, 360, 0)

    const image = (runtime.scene.environment as THREE.DataTexture).image as { width: number; height: number }
    expect(image.width).toBeGreaterThanOrEqual(64)
    expect(image.height).toBeGreaterThanOrEqual(32)
    registry.dispose()
  })

  it('carries neutral grey radiance that no colour-space decode will touch', () => {
    const registry = new ThreeSceneRuntimeRegistry()
    const runtime = registry.get(createStarter3DScene('World'), 640, 360, 0)

    const texture = runtime.scene.environment as THREE.DataTexture
    const texels = (texture.image as { data: Float32Array }).data
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    // Float32 storage, so the constant only round-trips to single precision.
    expect(texels[0]).toBeCloseTo(NEUTRAL_WORLD_RADIANCE, 6)
    expect(texels[1]).toBeCloseTo(NEUTRAL_WORLD_RADIANCE, 6)
    expect(texels[2]).toBeCloseTo(NEUTRAL_WORLD_RADIANCE, 6)
    expect(texels[3]).toBe(1)
    registry.dispose()
  })

  it('stands down when the author turns environment light off', () => {
    const registry = new ThreeSceneRuntimeRegistry()
    const scene = createStarter3DScene('World')
    scene.environmentIntensity = 0

    const runtime = registry.get(scene, 640, 360, 0)

    expect(runtime.scene.environment).toBeNull()
    registry.dispose()
  })

  it('reuses one probe across scenes and releases it on dispose', () => {
    const registry = new ThreeSceneRuntimeRegistry()
    const first = registry.get(createStarter3DScene('First'), 640, 360, 0)
    const second = registry.get(createStarter3DScene('Second'), 640, 360, 0)

    expect(first.scene.environment).toBe(second.scene.environment)

    const probe = first.scene.environment as THREE.DataTexture
    let disposed = false
    probe.addEventListener('dispose', () => { disposed = true })
    registry.dispose()
    expect(disposed).toBe(true)

    // A registry keeps working after a dispose, so the next scene must get a probe of its own.
    const revived = registry.get(createStarter3DScene('Revived'), 640, 360, 0)
    expect(revived.scene.environment).not.toBeNull()
    expect(revived.scene.environment).not.toBe(probe)
    registry.dispose()
  })
})
