import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { LinearDisplayP3ColorSpace } from 'three/addons/math/ColorSpaces.js'
import { SceneWorkingSpace, workingToDisplayMatrix } from '../sceneWorkingSpace'
import { createDemo3DScene } from '@/engine/scene3d/sceneFactory'

const settings = { ...createDemo3DScene().settings, workingColorSpace: 'linear-display-p3' as const }

describe('scene working gamut', () => {
  it('converts colors and linked ambient uniforms, and restores shared data on render failure', () => {
    const scope = new SceneWorkingSpace(), scene = new THREE.Scene()
    const material = new THREE.MeshStandardMaterial({ color: '#ff0000' })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
    scene.add(mesh, new THREE.Mesh(mesh.geometry, material))
    const ambient = new THREE.Color('#00ff00')
    material.userData.auroraLinkUniforms = { auroraAmbient: { value: ambient } }
    scene.background = material.color
    const originalColor = material.color.clone(), originalAmbient = ambient.clone()
    const originalKey = material.customProgramCacheKey, originalCompile = material.onBeforeCompile
    const working = THREE.ColorManagement.workingColorSpace
    expect(() => scope.render(scene, settings, () => {
      expect(THREE.ColorManagement.workingColorSpace).toBe(LinearDisplayP3ColorSpace)
      expect(material.color.r).toBeCloseTo(.82246, 4)
      expect(material.color.g).toBeCloseTo(.03319, 4)
      expect(ambient).not.toEqual(originalAmbient)
      expect(material.color.clone().applyMatrix3(workingToDisplayMatrix(LinearDisplayP3ColorSpace)).r).toBeCloseTo(1, 5)
      throw new Error('draw failed')
    })).toThrow('draw failed')
    expect(material.color).toEqual(originalColor)
    expect(ambient).toEqual(originalAmbient)
    expect(THREE.ColorManagement.workingColorSpace).toBe(working)
    expect(material.customProgramCacheKey).toBe(originalKey)
    expect(material.onBeforeCompile).toBe(originalCompile)
    scope.dispose()
  })

  it('converts only color maps, keeps HDR radiance, reuses conversions, and frees them with the source', () => {
    const scope = new SceneWorkingSpace(), scene = new THREE.Scene()
    const map = new THREE.DataTexture(new Uint8Array([255, 0, 0, 128]), 1, 1)
    map.colorSpace = THREE.SRGBColorSpace
    const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
    const hdr = new THREE.DataTexture(new Float32Array([4, 4, 4, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType)
    const material = new THREE.MeshStandardMaterial({ map, normalMap: normal })
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material)); scene.environment = hdr
    let converted: THREE.Texture | null = null
    scope.render(scene, settings, () => {
      converted = material.map
      expect(converted).not.toBe(map)
      expect(material.normalMap).toBe(normal)
      const pixels = (converted as THREE.DataTexture).image.data as Uint16Array
      expect(THREE.DataUtils.fromHalfFloat(pixels[0]!)).toBeCloseTo(.82246, 3)
      expect(THREE.DataUtils.fromHalfFloat(pixels[3]!)).toBeCloseTo(128 / 255, 3)
      expect(THREE.DataUtils.fromHalfFloat((scene.environment as THREE.DataTexture).image.data[0]!)).toBeCloseTo(4, 2)
    })
    expect(material.map).toBe(map); expect(scene.environment).toBe(hdr)
    scope.render(scene, settings, () => expect(material.map).toBe(converted))
    const dispose = vi.spyOn(converted!, 'dispose')
    map.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    scope.dispose()
  })

  it('does not mutate data in the default working space', () => {
    const scope = new SceneWorkingSpace(), scene = new THREE.Scene()
    const material = new THREE.MeshStandardMaterial({ color: '#f08040' })
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
    const version = material.version
    scope.render(scene, { ...settings, workingColorSpace: 'linear-srgb' }, () => expect(material.version).toBe(version))
    expect(workingToDisplayMatrix(THREE.LinearSRGBColorSpace)).toEqual(new THREE.Matrix3())
    scope.dispose()
  })
})
