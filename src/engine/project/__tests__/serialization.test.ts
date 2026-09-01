import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { setNumericPropertyAtTime, toggleNumericKeyframe } from '@/engine/animation/editNumericProperty'
import { createRenderPlan, HYBRID_ALPHA_CONTRACT, resolveRenderSize } from '@/engine/rendering/contracts'
import { createDemo3DScene, createPrimitiveObject } from '@/engine/scene3d/sceneFactory'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { CURRENT_PROJECT_VERSION, deserializeEditorState, serializeEditorState } from '@/engine/project/serialization'
import { createDemoNodeGraph } from '@/engine/nodes/nodeGraph'
import { createRig, createRigBone } from '@/engine/rig/rigFactory'
import { AuroraProjectDatabase } from '@/engine/project/AuroraProjectDatabase'
import type { EditorLayer, EditorProject, Scene3DSettings, SerializedEditorState } from '@/models/editor'

const project: EditorProject = {
  id: 'test-project', name: 'Test', width: 1920, height: 1080, frameRate: 30,
  duration: 18, backgroundColor: '#000000', updatedAt: 0, version: CURRENT_PROJECT_VERSION,
}

function transform(prefix: string): EditorLayer['transform'] {
  const property = (suffix: string, value: number) => ({ id: `${prefix}-${suffix}`, value, animated: false, keyframes: [] })
  return {
    x: property('x', 960), y: property('y', 540), scaleX: property('sx', 100), scaleY: property('sy', 100),
    rotation: property('rotation', 0), opacity: property('opacity', 100),
  }
}

const createDemoNodeGraph2 = () => {
  const graph = createDemoNodeGraph()
  return { nodes: graph.nodes, nodeConnections: graph.connections }
}

const layers: EditorLayer[] = [
  { id: 'title', name: 'Title', type: 'text', start: 0, duration: 18, color: '#fff', visible: true, locked: false, muted: false, expanded: false, transform: transform('title'), effects: [] },
  { id: 'scene-layer', name: 'Scene', type: '3d-scene', sceneId: 'scene-aurora-3d', start: 0, duration: 18, color: '#88f', visible: true, locked: false, muted: false, expanded: false, transform: transform('scene'), effects: [] },
]

describe('hybrid project architecture', () => {
  it('round-trips serialized 3D metadata without runtime Three objects', () => {
    const state: SerializedEditorState = { project, layers, scenes3D: [createDemo3DScene()], assets: [], ...createDemoNodeGraph2() }
    const json = serializeEditorState(state)
    const restored = deserializeEditorState(json, state)
    expect(restored.project.version).toBe(CURRENT_PROJECT_VERSION)
    expect(restored.scenes3D[0]?.objects[0]?.name).toBe('Aurora Cube')
    expect(json).not.toContain('Object3D')
    expect(json).not.toContain('MeshStandardMaterial')
  })

  it('preserves an intentionally empty current project', () => {
    const fallback: SerializedEditorState = { project, layers, scenes3D: [createDemo3DScene()], assets: [], ...createDemoNodeGraph2() }
    const graph = createDemoNodeGraph([])
    const empty: SerializedEditorState = { project, layers: [], scenes3D: [], assets: [], nodes: graph.nodes, nodeConnections: graph.connections }

    const restored = deserializeEditorState(serializeEditorState(empty), fallback)

    expect(restored.layers).toEqual([])
    expect(restored.scenes3D).toEqual([])
    expect(restored.nodes.map((node) => node.kind)).toEqual(['output'])
  })

  it('migrates a version-one project with the demo 3D scene and layer', () => {
    const fallback: SerializedEditorState = { project, layers, scenes3D: [createDemo3DScene()], assets: [], ...createDemoNodeGraph2() }
    const legacy = JSON.stringify({ project: { ...project, version: 1 }, layers: [layers[0]] })
    const restored = deserializeEditorState(legacy, fallback)
    expect(restored.project.version).toBe(CURRENT_PROJECT_VERSION)
    expect(restored.scenes3D).toHaveLength(1)
    expect(restored.layers.some((layer) => layer.type === '3d-scene')).toBe(true)
  })

  it('centers the untouched legacy demo camera without overwriting a customized camera', () => {
    const fallback: SerializedEditorState = { project, layers, scenes3D: [createDemo3DScene()], assets: [], ...createDemoNodeGraph2() }
    const legacyScene = createDemo3DScene()
    const legacyCamera = legacyScene.cameras[0]!
    legacyCamera.transform.position.x.value = 4.8
    legacyCamera.transform.position.y.value = 3.2
    legacyCamera.transform.position.z.value = 6.2
    legacyCamera.transform.rotation.x.value = -22.4
    legacyCamera.transform.rotation.y.value = 37.8
    const legacy = JSON.stringify({ project: { ...project, version: 2 }, layers, scenes3D: [legacyScene], assets: [] })
    const restored = deserializeEditorState(legacy, fallback)
    expect(restored.scenes3D[0]?.cameras[0]?.transform.position.x.value).toBe(0)
    expect(restored.scenes3D[0]?.cameras[0]?.transform.position.z.value).toBe(7)
    expect(restored.scenes3D[0]?.lights.find((light) => light.id === 'light-key')?.transform.rotation.x.value).toBeCloseTo(-54.4623)

    legacyCamera.transform.position.x.value = 5
    const customized = deserializeEditorState(JSON.stringify({ project: { ...project, version: 2 }, layers, scenes3D: [legacyScene], assets: [] }), fallback)
    expect(customized.scenes3D[0]?.cameras[0]?.transform.position.x.value).toBe(5)
  })

  it('evaluates the demo object from absolute Aurora time deterministically', () => {
    const channel = createDemo3DScene().objects[0]!.transform.rotation.y
    expect(evaluateNumericProperty(channel, 9)).toBe(180)
    expect(evaluateNumericProperty(channel, 9)).toBe(180)
  })

  it('keys changed 3D numeric channels without keying untouched animated values', () => {
    const property = { id: 'rotation-y', value: 0, animated: true, keyframes: [
      { id: 'start', time: 0, value: 0, interpolation: 'linear' as const },
      { id: 'end', time: 10, value: 10, interpolation: 'linear' as const },
    ] }
    expect(setNumericPropertyAtTime(property, 5, 5, 30, { autoKey: false }).changed).toBe(false)
    expect(property.keyframes).toHaveLength(2)
    const result = setNumericPropertyAtTime(property, 7, 5, 30, { autoKey: false })
    expect(result.changed).toBe(true)
    expect(property.keyframes.find((keyframe) => keyframe.id === result.keyframeId)).toMatchObject({ time: 5, value: 7 })
  })

  it('toggles and auto-creates 3D numeric keyframes at the playhead', () => {
    const property = { id: 'position-x', value: 2, animated: false, keyframes: [] as Array<{ id: string; time: number; value: number; interpolation: 'bezier' }> }
    const toggledId = toggleNumericKeyframe(property, 3, 30)
    expect(property).toMatchObject({ animated: true })
    expect(property.keyframes[0]).toMatchObject({ id: toggledId, time: 3, value: 2 })
    toggleNumericKeyframe(property, 3, 30)
    expect(property).toMatchObject({ animated: false, keyframes: [] })
    const result = setNumericPropertyAtTime(property, 8, 4, 30, { autoKey: true })
    expect(property.keyframes.find((keyframe) => keyframe.id === result.keyframeId)).toMatchObject({ time: 4, value: 8 })
  })

  it('builds and updates disposable Three runtime objects from serialized state', () => {
    const scene = createDemo3DScene()
    const registry = new ThreeSceneRuntimeRegistry()
    const runtime = registry.get(scene, 1280, 720, 9)
    expect(runtime.objects.get('object-aurora-cube')?.rotation.y).toBeCloseTo(Math.PI)
    expect(runtime.cameras.get('camera-main')).toMatchObject({ aspect: 1280 / 720 })
    const camera = runtime.cameras.get('camera-main')!
    const direction = camera.getWorldDirection(new THREE.Vector3())
    const directionToOrigin = camera.position.clone().negate().normalize()
    expect(direction.angleTo(directionToOrigin)).toBeCloseTo(0)
    const keyLight = runtime.lights.get('light-key') as THREE.DirectionalLight
    const lightDirection = keyLight.target.position.clone().sub(keyLight.position).normalize()
    expect(lightDirection.angleTo(keyLight.position.clone().negate().normalize())).toBeCloseTo(0)
    registry.dispose()
  })

  it('reconciles 3D value edits without destroying the runtime scene', () => {
    const scene = createDemo3DScene()
    const registry = new ThreeSceneRuntimeRegistry()
    const first = registry.get(scene, 1280, 720, 0)
    const cube = first.objects.get('object-aurora-cube')

    scene.objects[0]!.transform.position.x.value = 4
    scene.revision += 1
    const valueEdit = registry.get(scene, 1280, 720, 0)
    expect(valueEdit).toBe(first)
    expect(valueEdit.objects.get('object-aurora-cube')).toBe(cube)
    expect(cube?.position.x).toBe(4)

    scene.objects.push(createPrimitiveObject('sphere', 3))
    scene.revision += 1
    const topologyEdit = registry.get(scene, 1280, 720, 0)
    expect(topologyEdit).not.toBe(first)
    expect(topologyEdit.objects.size).toBe(3)
    registry.dispose()
  })

  it('keeps image planes visible from either side and outside stale deformation bounds', () => {
    const scene = createDemo3DScene()
    const imagePlane = createPrimitiveObject('plane', scene.objects.length + 1)
    scene.objects.push(imagePlane)
    const registry = new ThreeSceneRuntimeRegistry()
    const runtime = registry.get(scene, 1280, 720, 0)
    const mesh = runtime.objects.get(imagePlane.id) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>

    expect(mesh.material.side).toBe(THREE.DoubleSide)
    expect(mesh.frustumCulled).toBe(false)
    registry.dispose()
  })

  it('fits authored shadow maps to the scene and applies environment lighting', () => {
    const scene = createDemo3DScene()
    scene.settings.shadowMapSize = 2048
    scene.environmentIntensity = 1.5
    const registry = new ThreeSceneRuntimeRegistry()
    const runtime = registry.get(scene, 1280, 720, 0)
    const key = runtime.lights.get('light-key') as THREE.DirectionalLight
    const ambient = runtime.lights.get('light-ambient') as THREE.AmbientLight
    const material = (runtime.objects.get('object-aurora-cube') as THREE.Mesh).material as THREE.MeshStandardMaterial

    expect(key.shadow.mapSize.width).toBe(2048)
    expect(key.shadow.camera.right - key.shadow.camera.left).toBeGreaterThan(10)
    expect(key.shadow.normalBias).toBeGreaterThan(0)
    expect(ambient.intensity).toBeCloseTo(.7 * 1.5)
    expect(material.envMapIntensity).toBeCloseTo(1.5)
    registry.dispose()
  })

  it('backfills GTAO settings when an older project is loaded', () => {
    const fallback: SerializedEditorState = { project, layers, scenes3D: [createDemo3DScene()], assets: [], ...createDemoNodeGraph2() }
    const legacy = JSON.parse(serializeEditorState(fallback)) as SerializedEditorState
    const legacySettings = legacy.scenes3D[0]!.settings as Partial<Scene3DSettings>
    delete legacySettings.ambientOcclusion
    delete legacySettings.ambientOcclusionIntensity
    delete legacySettings.ambientOcclusionRadius

    const restored = deserializeEditorState(JSON.stringify(legacy), fallback)
    expect(restored.scenes3D[0]?.settings).toMatchObject({
      ambientOcclusion: true,
      ambientOcclusionIntensity: 1,
      ambientOcclusionRadius: .35,
    })
  })

  it('keeps bottom-to-top backend ordering in the render plan', () => {
    const plan = createRenderPlan({ project, layers, scenes3D: [createDemo3DScene()], time: 4, width: 1280, height: 720, quality: 'preview' })
    expect(plan.passes.map((pass) => [pass.layerId, pass.backend])).toEqual([
      ['scene-layer', 'three-webgl'],
      ['title', 'pixi-webgl'],
    ])
  })

  it('locks alpha/color conventions and deterministic quality resizing', () => {
    expect(HYBRID_ALPHA_CONTRACT).toMatchObject({ alpha: true, premultipliedAlpha: true, sceneClearAlpha: 0, colorSpace: 'srgb' })
    expect(resolveRenderSize(1920, 1080, 'draft')).toEqual({ width: 960, height: 540 })
    expect(resolveRenderSize(1920, 1080, 'full')).toEqual({ width: 1920, height: 1080 })
  })

  it('stores ordered project aggregates and 3D transforms in structured IndexedDB tables', async () => {
    const database = new AuroraProjectDatabase(`aurora-test-${crypto.randomUUID()}`)
    const scene = createDemo3DScene()
    scene.objects[0]!.transform.position.x.value = 3.75
    scene.cameras[0]!.transform.rotation.y.value = 22
    const state: SerializedEditorState = { project, layers, scenes3D: [scene], assets: [], ...createDemoNodeGraph2() }
    await database.saveSnapshot(state)
    const restored = await database.loadActiveSnapshot()
    expect(restored?.layers.map((layer) => layer.id)).toEqual(layers.map((layer) => layer.id))
    expect(restored?.scenes3D[0]?.objects[0]?.transform.position.x.value).toBe(3.75)
    expect(restored?.scenes3D[0]?.cameras[0]?.transform.rotation.y.value).toBe(22)
    expect(await database.projects.count()).toBe(1)
    expect(await database.layers.count()).toBe(layers.length)
    expect(await database.scenes3D.count()).toBe(1)
    expect((await database.listProjects()).map((item) => item.id)).toEqual([project.id])
    await database.delete()
  })
})

describe('rig persistence', () => {
  const riggedState = () => {
    const rig = createRig('Leaf')
    rig.bones = [createRigBone(1, { x: 0, y: -.6, angle: 90, length: .8 })]
    rig.bones[0]!.rotation.value = 12
    const image: EditorLayer = {
      id: 'leaf', name: 'Leaf', type: 'image', rigId: rig.id, start: 0, duration: 4, color: '#8f8',
      visible: true, locked: false, muted: false, expanded: false, transform: transform('leaf'), effects: [],
    }
    return { project, layers: [image], scenes3D: [], assets: [], rigs: [rig], ...createDemoNodeGraph2() } as SerializedEditorState
  }

  it('round-trips rigs and the layers attached to them', () => {
    const state = riggedState()
    const restored = deserializeEditorState(serializeEditorState(state), { project, layers, scenes3D: [], assets: [] })
    expect(restored.rigs).toHaveLength(1)
    expect(restored.rigs[0]!.bones[0]!.rotation.value).toBe(12)
    expect(restored.layers[0]!.rigId).toBe(restored.rigs[0]!.id)
  })

  it('releases a layer whose rig did not survive the file', () => {
    const state = riggedState()
    const withoutRigs = JSON.parse(serializeEditorState(state)) as SerializedEditorState
    withoutRigs.rigs = []
    const restored = deserializeEditorState(JSON.stringify(withoutRigs), { project, layers, scenes3D: [], assets: [] })
    expect(restored.layers[0]!.rigId).toBeUndefined()
  })

  it('repairs a rig saved with a broken bone', () => {
    const state = riggedState()
    const raw = JSON.parse(serializeEditorState(state)) as Record<string, unknown>
    const rigs = raw.rigs as Array<Record<string, unknown>>
    rigs[0]!.columns = 4000
    const bones = rigs[0]!.bones as Array<Record<string, unknown>>
    bones[0]!.length = Number.NaN
    bones[0]!.parentId = 'a-bone-that-never-existed'
    delete bones[0]!.stretch
    const restored = deserializeEditorState(JSON.stringify(raw), { project, layers, scenes3D: [], assets: [] })
    const bone = restored.rigs[0]!.bones[0]!
    expect(restored.rigs[0]!.columns).toBe(64)
    expect(bone.length).toBe(.5)
    expect(bone.parentId).toBeUndefined()
    expect(bone.stretch.value).toBe(1)
  })

  it('carries the environment map and camera lens through a save and reload', () => {
    const scene = createDemo3DScene()
    scene.environmentAssetId = 'env-1'
    scene.environmentBackground = true
    const camera = scene.cameras[0]!
    camera.depthOfField = true
    const state: SerializedEditorState = {
      project, layers: [], scenes3D: [scene], assets: [], nodes: [], nodeConnections: [], rigs: [],
    }

    const restored = deserializeEditorState(serializeEditorState(state), state).scenes3D[0]!

    expect(restored.environmentAssetId).toBe('env-1')
    expect(restored.environmentBackground).toBe(true)
    expect(restored.cameras[0]?.depthOfField).toBe(true)
  })

  it('backfills lens defaults on every camera, constrained or not', () => {
    const scene = createDemo3DScene()
    // The demo camera has no constraint, which is the path the normaliser returns early from.
    const camera = scene.cameras[0]!
    delete camera.focusDistance
    delete camera.fStop
    delete camera.depthOfField
    scene.environmentBackground = undefined
    scene.environmentAssetId = ''
    const state: SerializedEditorState = {
      project, layers: [], scenes3D: [scene], assets: [], nodes: [], nodeConnections: [], rigs: [],
    }

    const restored = deserializeEditorState(serializeEditorState(state), state).scenes3D[0]!

    expect(restored.cameras[0]?.focusDistance?.value).toBe(8)
    expect(restored.cameras[0]?.fStop?.value).toBe(2.8)
    // Off by default: an existing project must not suddenly render with a blurred lens.
    expect(restored.cameras[0]?.depthOfField).toBe(false)
    expect(restored.environmentAssetId).toBeUndefined()
    expect(restored.environmentBackground).toBe(false)
  })
})
