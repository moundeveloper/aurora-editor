import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyInfluences, createInfluence, influenceSignature, INFLUENCE_TYPES } from '@/engine/scene3d/influences'
import { createDemo3DScene } from '@/engine/scene3d/sceneFactory'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import type { AuroraInfluence } from '@/models/editor'

const box = () => new THREE.BoxGeometry(2, 2, 2)
const vertices = (geometry: THREE.BufferGeometry) => geometry.getAttribute('position').count

function withParameters(influence: AuroraInfluence, values: Record<string, number>) {
  Object.entries(values).forEach(([key, value]) => { influence.parameters[key]!.value = value })
  return influence
}

describe('influences', () => {
  it('leaves the source geometry untouched when the stack is empty or disabled', () => {
    const source = box()
    expect(applyInfluences(source, [], 0)).toBe(source)
    const disabled = createInfluence('twist', 1)
    disabled.enabled = false
    expect(applyInfluences(source, [disabled], 0)).toBe(source)
  })

  it('repeats geometry with the array influence and honours the count', () => {
    const source = box()
    const influence = withParameters(createInfluence('array', 1), { count: 4, offsetX: 3 })
    const result = applyInfluences(source, [influence], 0)
    expect(vertices(result)).toBe(vertices(source) * 4)
    result.computeBoundingBox()
    expect(result.boundingBox!.max.x).toBeCloseTo(10)
    expect(vertices(source)).toBe(vertices(box()))
  })

  it('mirrors across the chosen axes and keeps the original half', () => {
    const source = box()
    const influence = withParameters(createInfluence('mirror', 1), { axisX: 1, axisY: 0, axisZ: 0 })
    const result = applyInfluences(source, [influence], 0)
    expect(vertices(result)).toBe(vertices(source.clone().toNonIndexed()) * 2)
    const untouched = applyInfluences(source, [withParameters(createInfluence('mirror', 1), { axisX: 0, axisY: 0, axisZ: 0 })], 0)
    expect(untouched).toBe(source)
  })

  it('splits every triangle into four per subdivision level', () => {
    const source = box()
    const baseTriangles = vertices(source.clone().toNonIndexed()) / 3
    const level2 = applyInfluences(source, [withParameters(createInfluence('subdivide', 1), { level: 2 })], 0)
    expect(vertices(level2) / 3).toBe(baseTriangles * 16)
  })

  it('displaces and twists vertices deterministically', () => {
    const source = box()
    const displaced = applyInfluences(source, [withParameters(createInfluence('displace', 1), { amount: .4, scale: 2, seed: 3 })], 0)
    const again = applyInfluences(source, [withParameters(createInfluence('displace', 1), { amount: .4, scale: 2, seed: 3 })], 0)
    expect(displaced.getAttribute('position').getX(5)).toBeCloseTo(again.getAttribute('position').getX(5))
    expect(displaced.getAttribute('position').getX(5)).not.toBeCloseTo(source.clone().toNonIndexed().getAttribute('position').getX(5))

    const twisted = applyInfluences(source, [withParameters(createInfluence('twist', 1), { angle: 90, height: 2 })], 0)
    const position = twisted.getAttribute('position')
    let rotated = false
    for (let index = 0; index < position.count; index += 1) {
      if (Math.abs(position.getY(index)) > 0.5 && Math.abs(position.getZ(index)) > 0.001) rotated = true
    }
    expect(rotated).toBe(true)
  })

  it('evaluates the stack in order so reordering changes the result', () => {
    const source = box()
    const array = withParameters(createInfluence('array', 1), { count: 2, offsetX: 4 })
    const mirror = withParameters(createInfluence('mirror', 1), { axisX: 1, axisY: 0, axisZ: 0 })
    const arrayFirst = applyInfluences(source, [array, mirror], 0)
    const mirrorFirst = applyInfluences(source, [mirror, array], 0)
    arrayFirst.computeBoundingBox()
    mirrorFirst.computeBoundingBox()
    expect(arrayFirst.boundingBox!.min.x).not.toBeCloseTo(mirrorFirst.boundingBox!.min.x)
  })

  it('changes its signature only when an evaluated parameter changes', () => {
    const influence = withParameters(createInfluence('array', 1), { count: 3 })
    const base = influenceSignature([influence], 0)
    expect(influenceSignature([influence], 4)).toBe(base)
    influence.parameters.count!.animated = true
    influence.parameters.count!.keyframes = [
      { id: 'a', time: 0, value: 3, interpolation: 'linear' },
      { id: 'b', time: 10, value: 9, interpolation: 'linear' },
    ]
    expect(influenceSignature([influence], 5)).not.toBe(base)
    influence.enabled = false
    expect(influenceSignature([influence], 5)).toContain(':off')
  })

  it('defines parameters for every registered influence type', () => {
    INFLUENCE_TYPES.forEach((type) => {
      const influence = createInfluence(type, 1)
      expect(Object.keys(influence.parameters).length).toBeGreaterThan(0)
      expect(applyInfluences(box(), [influence], 0).getAttribute('position').count).toBeGreaterThan(0)
    })
  })

  it('rebuilds runtime geometry from the untouched primitive when the stack changes', () => {
    const scene = createDemo3DScene()
    const cube = scene.objects[0]!
    const registry = new ThreeSceneRuntimeRegistry()
    const plain = registry.get(scene, 1280, 720, 0).objects.get(cube.id) as THREE.Mesh
    const baseCount = vertices(plain.geometry)

    cube.influences.push(withParameters(createInfluence('array', 1), { count: 3, offsetX: 3 }))
    const arrayed = registry.get(scene, 1280, 720, 0).objects.get(cube.id) as THREE.Mesh
    expect(vertices(arrayed.geometry)).toBe(baseCount * 3)

    cube.influences = []
    const restored = registry.get(scene, 1280, 720, 0).objects.get(cube.id) as THREE.Mesh
    expect(vertices(restored.geometry)).toBe(baseCount)
    registry.dispose()
  })
})
