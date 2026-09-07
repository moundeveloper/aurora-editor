import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { solidifyGeometry, screwGeometry } from '../shellGeometry'
import { bevelGeometry } from '../bevelGeometry'
import { booleanGeometry } from '../booleanGeometry'
import { ThreeSceneRuntimeRegistry } from '../ThreeSceneRuntime'
import { createDemo3DScene, createPrimitiveObject } from '../sceneFactory'
import { createInfluence } from '../influences'
function volume(geometry:THREE.BufferGeometry) {
  const position=geometry.getAttribute('position'),index=geometry.getIndex();let sum=0
  for(let i=0;i<(index?.count ?? position.count);i+=3) {
    const point=(offset:number)=>new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+offset):i+offset)
    sum+=point(0).dot(point(1).cross(point(2)))/6
  }
  return Math.abs(sum)
}
describe('advanced geometry influences',()=>{
  it('closes a plane shell including its boundary with positive and negative thickness',()=>{
    const plane=new THREE.PlaneGeometry(2,2)
    for(const thickness of [.25,-.25]) {
      const result=solidifyGeometry(plane,thickness)
      expect(volume(result)).toBeCloseTo(1,5)
      expect(result.getAttribute('position').count).toBe(36)
    }
    expect(plane.getAttribute('position').count).toBe(4)
  })
  it('chamfers box edges while preserving the outer dimensions',()=>{
    const cube=new THREE.BoxGeometry(2,2,2),result=bevelGeometry(cube,.2)
    expect(result).not.toBe(cube)
    expect(volume(result)).toBeLessThan(8);expect(volume(result)).toBeGreaterThan(6)
    result.computeBoundingBox()
    expect(result.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual([2,2,2])
  })
  it('sweeps an open offset profile and leaves closed input unchanged',()=>{
    const plane=new THREE.PlaneGeometry(1,2).translate(2,0,0)
    const result=screwGeometry(plane,180,1,12)
    expect(result.getAttribute('position').count).toBe(4*12*6+12)
    expect([...result.getAttribute('position').array].every(Number.isFinite)).toBe(true)
    const cube=new THREE.BoxGeometry()
    expect(screwGeometry(cube,360,0,32)).toBe(cube)
  })
  it('subtracts, unions and intersects transformed closed operands without mutation',()=>{
    const source=new THREE.BoxGeometry(2,2,2),target=new THREE.BoxGeometry(2,2,2),matrix=new THREE.Matrix4().makeTranslation(1,0,0)
    for(const [operation,expected] of [[0,4],[1,12],[2,4]])expect(volume(booleanGeometry(source,target,matrix,operation!))).toBeCloseTo(expected!,4)
    expect(volume(source)).toBeCloseTo(8);expect(volume(target)).toBeCloseTo(8)
  })
  it('invalidates a Boolean result when its target moves',()=>{
    const scene=createDemo3DScene(),source=createPrimitiveObject('box',1),target=createPrimitiveObject('box',2)
    for(const object of [source,target])for(const axis of ['x','y','z'] as const)object.transform.position[axis].value=0
    const boolean=createInfluence('boolean',1);boolean.targetId=target.id;source.influences=[boolean]
    target.transform.position.x.value=1;scene.objects=[source,target]
    const registry=new ThreeSceneRuntimeRegistry(),runtime=registry.get(scene,64,64,0,[])
    const mesh=runtime.objects.get(source.id) as THREE.Mesh
    expect(volume(mesh.geometry)).toBeCloseTo(4,4)
    target.transform.position.x.value=3
    registry.get(scene,64,64,0,[])
    expect(volume(mesh.geometry)).toBeCloseTo(8,4)
    registry.dispose()
  })
})
