import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { scatterMatrices, syncScattering } from '../scattering'
import { createDemo3DScene, createPrimitiveObject } from '../sceneFactory'
describe('mesh scattering', () => {
  it('samples transformed triangle surfaces deterministically and varies with the seed', () => {
    const definition = createPrimitiveObject('box', 1), scene = createDemo3DScene()
    definition.scatter = {enabled:true,targetId:'target',mode:'surface',count:20,seed:42,jitter:0,scaleVariation:0,align:true}
    const source = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial())
    const target = new THREE.Mesh(new THREE.PlaneGeometry(2,2),source.material)
    target.position.set(10,0,4); target.updateMatrixWorld(true)
    const matrices = scatterMatrices(source,target,definition,scene,0)
    expect(matrices).toEqual(scatterMatrices(source,target,definition,scene,0))
    for (const matrix of matrices) {
      const point = new THREE.Vector3().setFromMatrixPosition(matrix)
      expect(point.x).toBeGreaterThanOrEqual(9); expect(point.x).toBeLessThanOrEqual(11)
      expect(point.z).toBeCloseTo(4)
    }
    definition.scatter.seed++
    expect(matrices).not.toEqual(scatterMatrices(source,target,definition,scene,0))
  })
  it('shares resources and removes instances without disposing source geometry', () => {
    const definition = createPrimitiveObject('box',1), scene = createDemo3DScene(), root = new THREE.Group()
    definition.scatter = {enabled:true,targetId:'target',mode:'surface',count:3,seed:1,jitter:0,scaleVariation:0,align:false}
    scene.objects = [definition]
    const source = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial())
    const target = new THREE.Mesh(new THREE.PlaneGeometry(),source.material)
    const objects = new Map([[definition.id,source],['target',target]])
    root.add(source,target); root.updateMatrixWorld(true)
    const dispose = vi.spyOn(source.geometry,'dispose')
    syncScattering(root,objects,scene,0)
    const instances = root.children.find(item => item instanceof THREE.InstancedMesh) as THREE.InstancedMesh
    expect(instances.count).toBe(3); expect(instances.geometry).toBe(source.geometry)
    const parent = new THREE.Group()
    root.add(parent); parent.add(source); parent.visible = false
    syncScattering(root,objects,scene,1)
    expect(instances.visible).toBe(false)
    parent.visible = true
    syncScattering(root,objects,scene,1)
    expect(instances.visible).toBe(true)
    definition.scatter.enabled = false
    syncScattering(root,objects,scene,1)
    expect(root.children).not.toContain(instances); expect(dispose).not.toHaveBeenCalled()
  })
})
