import { describe, expect, it } from 'vitest'
import { evaluateNumericProperty } from '../../../src/engine/animation/evaluateProperty.ts'
import { evaluateNodeGraph } from '../../../src/engine/nodes/evaluateGraph.ts'
import { deserializeEditorState } from '../../../src/engine/project/serialization.ts'
import { createNeonSingularityProject, createPillarRunProject } from '../showcase.ts'

describe('MCP Neon Singularity authoring', () => {
  it('creates an editable hybrid project with meaningful animation', () => {
    const snapshot = createNeonSingularityProject('Protocol Premiere')
    const restored = deserializeEditorState(JSON.stringify(snapshot), snapshot)
    const animatedProperties = JSON.stringify(restored).match(/"animated":true/g)?.length ?? 0

    expect(restored.project.name).toBe('Protocol Premiere')
    expect(restored.layers.some((layer) => layer.type === 'cluster' && layer.children?.length === 3)).toBe(true)
    expect(restored.scenes3D[0]?.objects).toHaveLength(4)
    expect(restored.scenes3D[0]?.settings).toMatchObject({
      shadowMapSize: 2048,
      ambientOcclusion: true,
      ambientOcclusionIntensity: 1.15,
    })
    expect(restored.scenes3D[0]?.objects.filter((object) => object.castShadow)).toHaveLength(1)
    expect(restored.scenes3D[0]?.cameras[0]?.pathConstraint?.orientation).toBe('look-at')
    expect(restored.nodes.some((node) => node.kind === 'glow')).toBe(true)
    expect(restored.nodeConnections).toHaveLength(10)
    expect(animatedProperties).toBeGreaterThan(20)
    expect(evaluateNodeGraph(restored.nodes, restored.nodeConnections)?.map((pass) => pass.layerId)).toEqual([
      'layer-cosmic-backdrop', 'layer-neon-scene', 'layer-orbital-hud',
      'layer-core-flare', 'layer-core-flare', 'layer-subtitle', 'layer-hero-title',
    ])
    expect(evaluateNodeGraph(restored.nodes, restored.nodeConnections)?.filter((pass) => pass.layerId === 'layer-neon-scene')).toHaveLength(1)
  })

  it('moves the hero camera and pulses the singularity over the composition', () => {
    const snapshot = createNeonSingularityProject()
    const scene = snapshot.scenes3D[0]!
    const cameraProgress = scene.cameras[0]!.pathConstraint!.progress
    const coreScale = scene.objects.find((object) => object.id === 'singularity-core')!.transform.scale.x

    expect(evaluateNumericProperty(cameraProgress, 0)).toBeCloseTo(0)
    expect(evaluateNumericProperty(cameraProgress, 6)).toBeCloseTo(.5)
    expect(evaluateNumericProperty(cameraProgress, 12)).toBeCloseTo(1)
    expect(evaluateNumericProperty(coreScale, 1.5)).toBeGreaterThan(evaluateNumericProperty(coreScale, 0))
  })
})

describe('MCP Pillar Run authoring', () => {
  it('builds a complex environment, modular drone, and editable chase animation', () => {
    const snapshot = createPillarRunProject('Flight Test', 'pillar-run-test')
    const scene = snapshot.scenes3D[0]!
    const drone = scene.objects.find((object) => object.id === 'drone-root')!

    expect(snapshot.project.name).toBe('Flight Test')
    expect(scene.name).toBe('Neon Canyon Pillar Run')
    expect(scene.objects.length).toBeGreaterThanOrEqual(30)
    expect(scene.objects.filter((object) => object.name.includes('Pillar'))).toHaveLength(12)
    expect(scene.objects.find((object) => object.id === 'runway-floor')).toMatchObject({ castShadow: false, receiveShadow: true })
    expect(scene.objects.filter((object) => object.name.includes('Pillar') && object.receiveShadow)).toHaveLength(12)
    expect(scene.objects.filter((object) => object.name.includes('Pillar')).every((object) => object.material.emissiveIntensity.value < .1)).toBe(true)
    expect(scene.objects.find((object) => object.id === 'drone-body')?.material.emissiveIntensity.value).toBe(0)
    expect(scene.objects.find((object) => object.id === 'drone-core')?.material.emissiveIntensity.value).toBeGreaterThan(4)
    expect(scene.objects.find((object) => object.id === 'gate-beacon-0')?.material.emissiveIntensity.value).toBeGreaterThan(3)
    expect(scene.objects.filter((object) => object.parentId === drone.id).length).toBeGreaterThanOrEqual(10)
    expect(scene.lights).toHaveLength(7)
    expect(scene.lights.filter((light) => light.type === 'point')).toHaveLength(4)
    expect(scene.lights.find((light) => light.id === 'pillar-moon')).toMatchObject({ castShadow: true, color: '#d7e6ff' })
    expect(scene.settings).toMatchObject({ shadowMapSize: 2048, ambientOcclusionIntensity: 1.08, ambientOcclusionRadius: .42 })
    expect(scene.cameras[0]?.pathConstraint?.lookAtEntityId).toBe(drone.id)
    expect(scene.paths[0]?.points).toHaveLength(6)
    expect(evaluateNumericProperty(drone.transform.position.z, 0)).toBeCloseTo(10)
    expect(evaluateNumericProperty(drone.transform.position.z, 12)).toBeCloseTo(-22)
  })
})
