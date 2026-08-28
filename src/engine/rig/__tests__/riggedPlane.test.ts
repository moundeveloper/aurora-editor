import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createEmpty3DScene, createPrimitiveObject } from '@/engine/scene3d/sceneFactory'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { createRig, createRigBone } from '@/engine/rig/rigFactory'
import type { AuroraRig } from '@/models/editor'

function planeScene(rig?: AuroraRig) {
  const scene = createEmpty3DScene('Rig test')
  const plane = createPrimitiveObject('plane', 1)
  if (rig) plane.rigId = rig.id
  scene.objects = [plane]
  return { scene, plane }
}

/** Reads the UV of the vertex furthest up the plane, which is what a flipped texture gives away. */
function topEdgeV(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute('position')
  const uv = mesh.geometry.getAttribute('uv')
  let best = 0
  for (let index = 1; index < position.count; index += 1) {
    if (position.getY(index) > position.getY(best)) best = index
  }
  return uv.getY(best)
}

describe('rigged image planes', () => {
  it('keeps the texture the right way up once a bone is added', () => {
    const registry = new ThreeSceneRuntimeRegistry()
    const plain = planeScene()
    const plainMesh = registry.get(plain.scene, 640, 360, 0).objects.get(plain.plane.id) as THREE.Mesh
    const plainV = topEdgeV(plainMesh)

    const rig = createRig('Leaf')
    rig.bones = [createRigBone(1, { x: 0, y: -.8, angle: 90, length: 1 })]
    const rigged = planeScene(rig)
    const riggedMesh = registry.get(rigged.scene, 640, 360, 0, [], [rig]).objects.get(rigged.plane.id) as THREE.Mesh

    expect(riggedMesh.geometry.getAttribute('position').count).toBeGreaterThan(4)
    expect(topEdgeV(riggedMesh)).toBeCloseTo(plainV)
    registry.dispose()
  })

  it('matches the plain plane exactly while the rig is unposed', () => {
    const registry = new ThreeSceneRuntimeRegistry()
    const rig = createRig('Leaf')
    rig.bones = [createRigBone(1, { x: 0, y: -.8, angle: 90, length: 1, falloff: 3 })]
    const { scene, plane } = planeScene(rig)
    const mesh = registry.get(scene, 640, 360, 0, [], [rig]).objects.get(plane.id) as THREE.Mesh
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox!
    expect([box.min.x, box.min.y, box.max.x, box.max.y]).toEqual([-1, -1, 1, 1])
    registry.dispose()
  })

  it('drops back to the plain plane when the rig is detached', () => {
    const registry = new ThreeSceneRuntimeRegistry()
    const rig = createRig('Leaf')
    rig.bones = [createRigBone(1)]
    const { scene, plane } = planeScene(rig)
    expect((registry.get(scene, 640, 360, 0, [], [rig]).objects.get(plane.id) as THREE.Mesh).geometry.getAttribute('position').count).toBeGreaterThan(4)
    delete plane.rigId
    expect((registry.get(scene, 640, 360, 0, [], [rig]).objects.get(plane.id) as THREE.Mesh).geometry.getAttribute('position').count).toBe(4)
    registry.dispose()
  })
})
