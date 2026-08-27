import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { create3DPath, createCameraPathConstraint, createDemo3DScene, numericProperty } from '@/engine/scene3d/sceneFactory'
import { evaluate3DPath, sampleLocalPath } from '@/engine/scene3d/pathEvaluation'
import { appendPathPoint, insertPathPoint, movePathHandle, movePathPoint, setPathPointMode } from '@/engine/scene3d/pathEditing'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { CURRENT_PROJECT_VERSION, deserializeEditorState } from '@/engine/project/serialization'
import { createDemoNodeGraph } from '@/engine/nodes/nodeGraph'
import type { Aurora3DPathPoint, EditorLayer, EditorProject, SerializedEditorState } from '@/models/editor'

const project: EditorProject = {
  id: 'path-project', name: 'Paths', width: 1920, height: 1080, frameRate: 30,
  duration: 18, backgroundColor: '#000000', updatedAt: 0, version: CURRENT_PROJECT_VERSION,
}

const layers: EditorLayer[] = [{
  id: 'scene-layer', name: 'Scene', type: '3d-scene', sceneId: 'scene-aurora-3d', start: 0, duration: 18,
  color: '#88f', visible: true, locked: false, muted: false, expanded: false, effects: [],
  transform: {
    x: numericProperty('x', 960), y: numericProperty('y', 540), scaleX: numericProperty('sx', 100),
    scaleY: numericProperty('sy', 100), rotation: numericProperty('rotation', 0), opacity: numericProperty('opacity', 100),
  },
}]

const fallbackState = (): SerializedEditorState => {
  const graph = createDemoNodeGraph()
  return { project, layers, scenes3D: [createDemo3DScene()], assets: [], nodes: graph.nodes, nodeConnections: graph.connections }
}

const smoothPoint = (): Aurora3DPathPoint => ({
  id: 'point', position: [0, 0, 0], handleIn: [-1, 0, 0], handleOut: [1, 0, 0], mode: 'smooth',
})

describe('3D Bézier paths', () => {
  it('evaluates the curve endpoints and tangent in the local space of the path', () => {
    const path = create3DPath(1)
    const start = evaluate3DPath(path, 0, 0)
    const end = evaluate3DPath(path, 1, 0)
    expect(start.position.toArray()).toEqual(path.points[0]!.position.map((value) => expect.closeTo(value, 5)))
    expect(end.position.toArray()).toEqual(path.points.at(-1)!.position.map((value) => expect.closeTo(value, 5)))

    const outgoing = new THREE.Vector3(...path.points[0]!.handleOut).sub(new THREE.Vector3(...path.points[0]!.position)).normalize()
    expect(start.tangent.angleTo(outgoing)).toBeLessThan(.2)
  })

  it('offsets the sampled curve by the animated path transform', () => {
    const path = create3DPath(1)
    path.transform.position.y.animated = true
    path.transform.position.y.keyframes = [
      { id: 'a', time: 0, value: 0, interpolation: 'linear' },
      { id: 'b', time: 10, value: 10, interpolation: 'linear' },
    ]
    const rest = evaluate3DPath(path, 0, 0)
    const lifted = evaluate3DPath(path, 0, 5)
    expect(lifted.position.y - rest.position.y).toBeCloseTo(5)
  })

  it('splits a segment without changing the shape of the curve', () => {
    const path = create3DPath(1)
    const [from, to] = [path.points[0]!, path.points[1]!]
    const original = new THREE.CubicBezierCurve3(
      new THREE.Vector3(...from.position), new THREE.Vector3(...from.handleOut),
      new THREE.Vector3(...to.handleIn), new THREE.Vector3(...to.position),
    ).getPoint(.5)

    const inserted = insertPathPoint(path, 0)
    expect(path.points).toHaveLength(4)
    expect(inserted!.position[0]).toBeCloseTo(original.x)
    expect(inserted!.position[1]).toBeCloseTo(original.y)
    expect(inserted!.position[2]).toBeCloseTo(original.z)
    expect(sampleLocalPath(path).length).toBeGreaterThan(0)
  })

  it('carries handles with the anchor and mirrors the opposite handle on smooth points', () => {
    const moved = smoothPoint()
    movePathPoint(moved, [2, 0, 0])
    expect(moved.handleIn).toEqual([1, 0, 0])
    expect(moved.handleOut).toEqual([3, 0, 0])

    const mirrored = smoothPoint()
    movePathHandle(mirrored, 'handleOut', [0, 2, 0])
    expect(mirrored.handleIn[0]).toBeCloseTo(0)
    expect(mirrored.handleIn[1]).toBeCloseTo(-1)

    const corner = smoothPoint()
    corner.mode = 'corner'
    movePathHandle(corner, 'handleOut', [0, 2, 0])
    expect(corner.handleIn).toEqual([-1, 0, 0])
  })

  it('collapses handles onto the anchor for corner points and rebuilds them for smooth points', () => {
    const path = create3DPath(1)
    setPathPointMode(path, path.points[1]!.id, 'corner')
    expect(path.points[1]!.handleIn).toEqual(path.points[1]!.position)
    expect(path.points[1]!.handleOut).toEqual(path.points[1]!.position)

    setPathPointMode(path, path.points[1]!.id, 'smooth')
    expect(path.points[1]!.handleIn).not.toEqual(path.points[1]!.position)
    expect(appendPathPoint(path)).not.toBeNull()
    expect(path.points).toHaveLength(4)
  })

  it('drives a constrained camera along the path tangent and locks it onto a look-at target', () => {
    const scene = createDemo3DScene()
    const path = create3DPath(1)
    scene.paths.push(path)
    const cameraDefinition = scene.cameras[0]!
    cameraDefinition.pathConstraint = createCameraPathConstraint(cameraDefinition.id, path.id)

    const registry = new ThreeSceneRuntimeRegistry()
    const runtime = registry.get(scene, 1280, 720, 0)
    const camera = runtime.cameras.get(cameraDefinition.id)!
    const start = evaluate3DPath(path, 0, 0)
    expect(camera.position.distanceTo(start.position)).toBeCloseTo(0)
    expect(camera.getWorldDirection(new THREE.Vector3()).angleTo(start.tangent)).toBeCloseTo(0)

    cameraDefinition.pathConstraint.orientation = 'look-at'
    cameraDefinition.pathConstraint.lookAtEntityId = 'object-aurora-cube'
    cameraDefinition.pathConstraint.progress.value = .5
    registry.get(scene, 1280, 720, 0)
    const cube = runtime.objects.get('object-aurora-cube')!.getWorldPosition(new THREE.Vector3())
    const toCube = cube.sub(camera.position).normalize()
    expect(camera.position.distanceTo(evaluate3DPath(path, .5, 0).position)).toBeCloseTo(0)
    expect(camera.getWorldDirection(new THREE.Vector3()).angleTo(toCube)).toBeCloseTo(0)
    registry.dispose()
  })

  it('offsets the camera in the travel frame while keeping the look-at target centred', () => {
    const scene = createDemo3DScene()
    const path = create3DPath(1)
    scene.paths.push(path)
    const cameraDefinition = scene.cameras[0]!
    const constraint = createCameraPathConstraint(cameraDefinition.id, path.id)
    cameraDefinition.pathConstraint = constraint
    constraint.progress.value = .5

    const registry = new ThreeSceneRuntimeRegistry()
    const onCurve = registry.get(scene, 1280, 720, 0).cameras.get(cameraDefinition.id)!.position.clone()

    constraint.offset.y.value = 2
    const camera = registry.get(scene, 1280, 720, 0).cameras.get(cameraDefinition.id)!
    expect(camera.position.distanceTo(onCurve)).toBeCloseTo(2)
    expect(camera.position.y - onCurve.y).toBeGreaterThan(1.9)

    constraint.offset.x.value = 1.5
    constraint.offset.z.value = 3
    constraint.orientation = 'look-at'
    constraint.lookAtEntityId = 'object-aurora-cube'
    const runtime = registry.get(scene, 1280, 720, 0)
    const shifted = runtime.cameras.get(cameraDefinition.id)!
    const cube = runtime.objects.get('object-aurora-cube')!.getWorldPosition(new THREE.Vector3())
    expect(shifted.position.distanceTo(evaluate3DPath(path, .5, 0).position)).toBeGreaterThan(1)
    expect(shifted.getWorldDirection(new THREE.Vector3()).angleTo(cube.clone().sub(shifted.position).normalize())).toBeCloseTo(0)
    registry.dispose()
  })

  it('keeps the offset animatable so it can be keyed over time', () => {
    const scene = createDemo3DScene()
    const path = create3DPath(1)
    scene.paths.push(path)
    const camera = scene.cameras[0]!
    camera.pathConstraint = createCameraPathConstraint(camera.id, path.id)
    camera.pathConstraint.offset.y.animated = true
    camera.pathConstraint.offset.y.keyframes = [
      { id: 'low', time: 0, value: 0, interpolation: 'linear' },
      { id: 'high', time: 10, value: 10, interpolation: 'linear' },
    ]
    const registry = new ThreeSceneRuntimeRegistry()
    const onCurve = evaluate3DPath(path, 0, 0).position
    const atStart = registry.get(scene, 1280, 720, 0).cameras.get(camera.id)!.position.clone()
    const atFive = registry.get(scene, 1280, 720, 5).cameras.get(camera.id)!.position.clone()
    expect(atStart.distanceTo(onCurve)).toBeCloseTo(0)
    expect(atFive.distanceTo(onCurve)).toBeCloseTo(5)
    expect(atFive.y).toBeGreaterThan(atStart.y)
    registry.dispose()
  })

  it('backfills the paths array and drops constraints that point at a missing path', () => {
    const legacyScene = JSON.parse(JSON.stringify(createDemo3DScene())) as Record<string, unknown> & { cameras: Array<Record<string, unknown>> }
    delete legacyScene.paths
    legacyScene.cameras[0]!.pathConstraint = { pathId: 'deleted-path', orientation: 'tangent', progress: numericProperty('legacy-progress', .25) }
    const restored = deserializeEditorState(
      JSON.stringify({ project, layers, scenes3D: [legacyScene], assets: [] }),
      fallbackState(),
    )
    expect(restored.scenes3D[0]?.paths).toEqual([])
    expect(restored.scenes3D[0]?.cameras[0]?.pathConstraint).toBeUndefined()
  })

  it('keeps a valid constraint and backfills its missing bank channel', () => {
    const scene = JSON.parse(JSON.stringify(createDemo3DScene())) as ReturnType<typeof createDemo3DScene>
    const path = create3DPath(1)
    scene.paths = [path]
    scene.cameras[0]!.pathConstraint = { pathId: path.id, orientation: 'look-at', progress: numericProperty('progress', .25) } as never
    const restored = deserializeEditorState(
      JSON.stringify({ project, layers, scenes3D: [scene], assets: [] }),
      fallbackState(),
    )
    const constraint = restored.scenes3D[0]?.cameras[0]?.pathConstraint
    expect(constraint?.pathId).toBe(path.id)
    expect(constraint?.progress.value).toBe(.25)
    expect(constraint?.bank.value).toBe(0)
    expect([constraint?.offset.x.value, constraint?.offset.y.value, constraint?.offset.z.value]).toEqual([0, 0, 0])
  })
})
