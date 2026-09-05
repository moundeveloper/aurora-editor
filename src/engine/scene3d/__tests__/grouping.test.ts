import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { createDemo3DScene, createGroupObject } from '@/engine/scene3d/sceneFactory'
import { createInfluence } from '@/engine/scene3d/influences'

describe('3D object groups', () => {
  it('evaluates child transforms beneath the selected group transform', () => {
    const scene = createDemo3DScene()
    const child = scene.objects[0]!
    const group = createGroupObject(1)
    group.transform.position.x.value = 5
    child.parentId = group.id
    scene.objects.push(group)
    const registry = new ThreeSceneRuntimeRegistry()

    const runtime = registry.get(scene, 1280, 720, 0)
    const childRuntime = runtime.objects.get(child.id)!
    const groupRuntime = runtime.objects.get(group.id)!

    expect(childRuntime.parent).toBe(groupRuntime)
    expect(childRuntime.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(5)
    registry.dispose()
  })

  it('repeats a complete child hierarchy with a group array influence', () => {
    const scene = createDemo3DScene()
    const child = scene.objects[0]!
    const group = createGroupObject(1)
    const array = createInfluence('array', 1)
    array.parameters.count!.value = 3
    array.parameters.offsetX!.value = 0
    array.parameters.offsetZ!.value = -5
    group.influences.push(array)
    child.parentId = group.id
    scene.objects.push(group)
    const registry = new ThreeSceneRuntimeRegistry()

    const runtime = registry.get(scene, 1280, 720, 0)
    const runtimeGroup = runtime.objects.get(group.id)!
    const helper = runtimeGroup.children.find((object) => object.userData.auroraGroupArrayHelper)

    expect(helper?.children).toHaveLength(2)
    expect(helper?.children[0]?.matrix.elements[14]).toBeCloseTo(-5)
    expect(helper?.children[1]?.matrix.elements[14]).toBeCloseTo(-10)
    expect(helper?.children[0]?.children[0]?.userData.auroraId).toBe(child.id)
    registry.dispose()
  })
})
