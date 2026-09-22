import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { cachedSceneBounds } from '../sceneBoundsCache'

describe('shadow bounds cache',()=>{
  it('reuses static bounds and invalidates parent transforms and added/removed objects',()=>{
    const root=new THREE.Group(),parent=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2))
    root.add(parent);parent.add(mesh);root.updateMatrixWorld(true)
    const first=cachedSceneBounds(root)
    expect(cachedSceneBounds(root)).toBe(first)
    parent.position.x=5;root.updateMatrixWorld(true)
    const moved=cachedSceneBounds(root);expect(moved).not.toBe(first);expect(moved.min.x).toBe(4)
    const second=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));second.position.x=-8;root.add(second);root.updateMatrixWorld(true)
    expect(cachedSceneBounds(root).min.x).toBe(-9)
    second.removeFromParent();root.updateMatrixWorld(true)
    expect(cachedSceneBounds(root).min.x).toBe(4)
  })
  it('refreshes cached local bounds on in-place geometry edits and replacement',()=>{
    const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));root.add(mesh);root.updateMatrixWorld(true)
    cachedSceneBounds(root)
    const positions=mesh.geometry.getAttribute('position');positions.setX(0,8);positions.needsUpdate=true
    expect(cachedSceneBounds(root).max.x).toBe(8)
    mesh.geometry=new THREE.BoxGeometry(4,4,4)
    expect(cachedSceneBounds(root).max.x).toBe(2)
  })
  it('tracks instance transforms and count without refitting static instance buffers',()=>{
    const root=new THREE.Group(),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial(),2)
    mesh.setMatrixAt(0,new THREE.Matrix4());mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(8,0,0));mesh.instanceMatrix.needsUpdate=true
    root.add(mesh);root.updateMatrixWorld(true)
    const first=cachedSceneBounds(root);expect(first.max.x).toBe(9);expect(cachedSceneBounds(root)).toBe(first)
    mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(12,0,0));mesh.instanceMatrix.needsUpdate=true
    expect(cachedSceneBounds(root).max.x).toBe(13)
    mesh.count=1;expect(cachedSceneBounds(root).max.x).toBe(1)
  })
})
