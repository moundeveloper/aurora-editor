import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { configureSceneColor, VIEW_TRANSFORMS } from '../colorManagement'
import { createDemo3DScene } from '@/engine/scene3d/sceneFactory'

describe('scene display transforms', () => {
  it('switches between scene settings without leaking exposure or view transforms', () => {
    const renderer = {} as THREE.WebGLRenderer
    const settings = createDemo3DScene().settings
    for (const view of Object.keys(VIEW_TRANSFORMS) as (keyof typeof VIEW_TRANSFORMS)[]) {
      configureSceneColor(renderer, { ...settings, viewTransform: view, exposureStops: 2 })
      expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace)
      expect(renderer.toneMapping).toBe(VIEW_TRANSFORMS[view])
      expect(renderer.toneMappingExposure).toBe(4)
    }
    configureSceneColor(renderer, { ...settings, viewTransform: undefined, exposureStops: undefined })
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping)
    expect(renderer.toneMappingExposure).toBe(1)
  })
  it('bounds invalid exposure from imported projects', () => {
    const renderer = {} as THREE.WebGLRenderer, settings = createDemo3DScene().settings
    for (const [input, expected] of [[NaN, 1], [Infinity, 1], [100, 1024], [-100, 1 / 1024]]) {
      configureSceneColor(renderer, { ...settings, exposureStops: input })
      expect(renderer.toneMappingExposure).toBe(expected)
    }
  })
})
