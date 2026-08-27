import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { createRenderPlan, HYBRID_ALPHA_CONTRACT, resolveRenderSize } from '@/engine/rendering/contracts'
import { createDemo3DScene } from '@/engine/scene3d/sceneFactory'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import { CURRENT_PROJECT_VERSION, deserializeEditorState, serializeEditorState } from '@/engine/project/serialization'
import type { EditorLayer, EditorProject, SerializedEditorState } from '@/models/editor'

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

const layers: EditorLayer[] = [
  { id: 'title', name: 'Title', type: 'text', start: 0, duration: 18, color: '#fff', visible: true, locked: false, muted: false, expanded: false, transform: transform('title'), effects: [] },
  { id: 'scene-layer', name: 'Scene', type: '3d-scene', sceneId: 'scene-aurora-3d', start: 0, duration: 18, color: '#88f', visible: true, locked: false, muted: false, expanded: false, transform: transform('scene'), effects: [] },
]

describe('hybrid project architecture', () => {
  it('round-trips serialized 3D metadata without runtime Three objects', () => {
    const state: SerializedEditorState = { project, layers, scenes3D: [createDemo3DScene()], assets: [] }
    const json = serializeEditorState(state)
    const restored = deserializeEditorState(json, state)
    expect(restored.project.version).toBe(CURRENT_PROJECT_VERSION)
    expect(restored.scenes3D[0]?.objects[0]?.name).toBe('Aurora Cube')
    expect(json).not.toContain('Object3D')
    expect(json).not.toContain('MeshStandardMaterial')
  })

  it('migrates a version-one project with the demo 3D scene and layer', () => {
    const fallback: SerializedEditorState = { project, layers, scenes3D: [createDemo3DScene()], assets: [] }
    const legacy = JSON.stringify({ project: { ...project, version: 1 }, layers: [layers[0]] })
    const restored = deserializeEditorState(legacy, fallback)
    expect(restored.project.version).toBe(CURRENT_PROJECT_VERSION)
    expect(restored.scenes3D).toHaveLength(1)
    expect(restored.layers.some((layer) => layer.type === '3d-scene')).toBe(true)
  })

  it('centers the untouched legacy demo camera without overwriting a customized camera', () => {
    const fallback: SerializedEditorState = { project, layers, scenes3D: [createDemo3DScene()], assets: [] }
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
})
