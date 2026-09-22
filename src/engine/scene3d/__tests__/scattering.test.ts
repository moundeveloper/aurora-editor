import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { scatterMatrices, syncScattering } from '../scattering'
import { create3DPath, createDemo3DScene, createPrimitiveObject } from '../sceneFactory'
describe('mesh scattering', () => {
  function fixture() {
    const definition=createPrimitiveObject('box',1),scene=createDemo3DScene(),root=new THREE.Group()
    definition.scatter={enabled:true,targetId:'target',mode:'surface',count:5000,seed:42,jitter:0,scaleVariation:0,align:false}
    scene.objects=[definition]
    const source=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial())
    const target=new THREE.Mesh(new THREE.PlaneGeometry(),source.material)
    root.add(source,target);root.updateMatrixWorld(true)
    const objects=new Map([[definition.id,source],['target',target]])
    syncScattering(root,objects,scene,0)
    const instances=root.children.find(o=>o instanceof THREE.InstancedMesh) as THREE.InstancedMesh
    return {definition,scene,root,source,target,objects,instances}
  }

  it('does no instance uploads or bounds scans when a static surface advances in time', () => {
    const {root,objects,scene,instances}=fixture()
    const write=vi.spyOn(instances,'setMatrixAt'),bounds=vi.spyOn(instances,'computeBoundingSphere')
    const version=instances.instanceMatrix.version
    for(let i=1;i<=20;i++)syncScattering(root,objects,scene,i/30)
    expect(write).not.toHaveBeenCalled();expect(bounds).not.toHaveBeenCalled()
    expect(instances.instanceMatrix.version).toBe(version)
    expect(instances.boundingBox?.isEmpty()).toBe(false)
  })

  it('invalidates cached samples after transforms, source scale, seed or geometry edits', () => {
    const {root,objects,scene,source,target,definition,instances}=fixture()
    let version=instances.instanceMatrix.version
    const changes=[()=>{target.position.x=8},()=>{source.scale.setScalar(2)},()=>{definition.scatter!.seed++},()=>{
      const positions=target.geometry.getAttribute('position') as THREE.BufferAttribute
      positions.setY(0,3);positions.needsUpdate=true
    }]
    for(const change of changes){change();root.updateMatrixWorld(true);syncScattering(root,objects,scene,0);expect(instances.instanceMatrix.version).toBe(++version)}
    const expected=scatterMatrices(source,target,definition,scene,0)
    const actual=new THREE.Matrix4()
    instances.getMatrixAt(12,actual)
    actual.elements.forEach((value,i)=>expect(value).toBeCloseTo(expected[12]!.elements[i]!,5))
    expect(instances.boundingBox?.max.x).toBeGreaterThan(8)
  })

  it('removes stale instances when a count becomes zero or the target disappears', () => {
    for(const remove of ['count','target']){
      const {root,objects,scene,definition,instances}=fixture(),dispose=vi.spyOn(instances,'dispose')
      if(remove==='count')definition.scatter!.count=0;else objects.delete('target')
      syncScattering(root,objects,scene,1)
      expect(root.children).not.toContain(instances);expect(dispose).toHaveBeenCalledTimes(1)
    }
  })

  it('caches static paths but follows animated path transforms and edited control points', () => {
    const {root,objects,scene,definition}=fixture(),path=create3DPath(1)
    scene.paths=[path];definition.scatter!.mode='path';definition.scatter!.targetId=path.id;definition.scatter!.count=8
    syncScattering(root,objects,scene,0)
    const instances=root.children.find(o=>o instanceof THREE.InstancedMesh) as THREE.InstancedMesh
    const first=new THREE.Matrix4();instances.getMatrixAt(0,first)
    const version=instances.instanceMatrix.version
    syncScattering(root,objects,scene,1)
    expect(instances.instanceMatrix.version).toBe(version)
    path.transform.position.y.animated=true
    path.transform.position.y.keyframes=[{id:'a',time:0,value:0,interpolation:'linear'},{id:'b',time:1,value:10,interpolation:'linear'}]
    syncScattering(root,objects,scene,1)
    const moved=new THREE.Matrix4();instances.getMatrixAt(0,moved)
    expect(moved.elements[13]!-first.elements[13]!).toBeCloseTo(10)
    expect(instances.instanceMatrix.version).toBe(version+1)
    path.points[0]!.position[0]+=2
    syncScattering(root,objects,scene,1);instances.getMatrixAt(0,moved)
    expect(moved.elements[12]!-first.elements[12]!).toBeCloseTo(2)
    expect(instances.instanceMatrix.version).toBe(version+2)
  })
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
