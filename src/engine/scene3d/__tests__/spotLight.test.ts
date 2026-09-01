import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { aimRotationDegrees, createDemo3DScene, numericProperty } from '@/engine/scene3d/sceneFactory'
import { CURRENT_PROJECT_VERSION, deserializeEditorState, serializeEditorState } from '@/engine/project/serialization'
import type { AuroraLight, SerializedEditorState } from '@/models/editor'

function spotLight(): AuroraLight {
  return {
    id: 'spot-1',
    name: 'Spot',
    visible: true,
    type: 'spot',
    color: '#ffffff',
    intensity: numericProperty('spot-1-intensity', 80),
    angle: numericProperty('spot-1-angle', 20),
    distance: numericProperty('spot-1-distance', 12),
    penumbra: numericProperty('spot-1-penumbra', .4),
    transform: {
      position: { x: numericProperty('spot-1-px', 0), y: numericProperty('spot-1-py', 6), z: numericProperty('spot-1-pz', 0) },
      rotation: { x: numericProperty('spot-1-rx', -90), y: numericProperty('spot-1-ry', 0), z: numericProperty('spot-1-rz', 0) },
      scale: { x: numericProperty('spot-1-sx', 1), y: numericProperty('spot-1-sy', 1), z: numericProperty('spot-1-sz', 1) },
    },
    castShadow: true,
  }
}

describe('spot lights', () => {
  it('builds a Three spotlight with the authored cone and aims it along local -Z', () => {
    const scene = createDemo3DScene()
    scene.lights.push(spotLight())
    const registry = new ThreeSceneRuntimeRegistry()

    const runtime = registry.get(scene, 1280, 720, 0)
    const light = runtime.lights.get('spot-1')

    expect(light).toBeInstanceOf(THREE.SpotLight)
    const spot = light as THREE.SpotLight
    expect(spot.angle).toBeCloseTo(THREE.MathUtils.degToRad(20))
    expect(spot.distance).toBeCloseTo(12)
    expect(spot.penumbra).toBeCloseTo(.4)
    expect(spot.castShadow).toBe(true)
    // -90° about X points the cone straight down, so the aim target sits below the light.
    expect(spot.target.position.y).toBeCloseTo(5)
    registry.dispose()
  })

  it('evaluates animated cone channels at the sampled time', () => {
    const scene = createDemo3DScene()
    const light = spotLight()
    light.angle!.animated = true
    light.angle!.keyframes = [
      { id: 'k1', time: 0, value: 10, interpolation: 'linear' },
      { id: 'k2', time: 2, value: 50, interpolation: 'linear' },
    ]
    scene.lights.push(light)
    const registry = new ThreeSceneRuntimeRegistry()

    const spot = registry.get(scene, 1280, 720, 1).lights.get('spot-1') as THREE.SpotLight

    expect(spot.angle).toBeCloseTo(THREE.MathUtils.degToRad(30))
    registry.dispose()
  })

  it('backfills cone channels for spots authored before they existed', () => {
    const scene = createDemo3DScene()
    const light = spotLight()
    delete light.angle
    delete light.distance
    delete light.penumbra
    scene.lights.push(light)
    const state: SerializedEditorState = {
      project: { id: 'p', name: 'Project', width: 1920, height: 1080, fps: 30, duration: 5, background: '#000000', format: 'landscape', workspace: '3d', version: CURRENT_PROJECT_VERSION },
      layers: [],
      scenes3D: [scene],
      assets: [],
      nodes: [],
      nodeConnections: [],
      rigs: [],
    }

    const restored = deserializeEditorState(serializeEditorState(state), state)
      .scenes3D[0]!.lights.find((item) => item.id === 'spot-1')!

    expect(restored.angle?.value).toBe(32)
    expect(restored.distance?.value).toBe(0)
    expect(restored.penumbra?.value).toBe(.25)
  })

  it('treats a zero range as an unbounded beam', () => {
    const scene = createDemo3DScene()
    const light = spotLight()
    light.distance!.value = 0
    scene.lights.push(light)
    const registry = new ThreeSceneRuntimeRegistry()

    const spot = registry.get(scene, 1280, 720, 0).lights.get('spot-1') as THREE.SpotLight

    // Three cuts a spot's contribution to exactly zero past a finite distance, so a range shorter
    // than the throw makes the light invisible no matter how high its intensity goes.
    expect(spot.distance).toBe(0)
    registry.dispose()
  })

  it('aims a light at a target without rolling it about its own beam', () => {
    const [rotationX, rotationY, rotationZ] = aimRotationDegrees([4, 7, 5], [0, 0, 0])

    expect(rotationZ).toBe(0)
    const beam = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rotationX),
      THREE.MathUtils.degToRad(rotationY),
      THREE.MathUtils.degToRad(rotationZ),
      'XYZ',
    ))
    expect(beam.angleTo(new THREE.Vector3(-4, -7, -5).normalize())).toBeCloseTo(0)
  })
})
