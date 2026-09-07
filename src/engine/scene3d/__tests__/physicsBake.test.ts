import { describe, expect, it } from 'vitest'
import { bakeRigidBodies, applyPhysicsBake } from '../physicsBake'
import { createDemo3DScene, createPrimitiveObject } from '../sceneFactory'
describe('rigid body bake', () => {
  function fixture() {
    const scene = createDemo3DScene(), object = createPrimitiveObject('sphere',1)
    object.transform.position.x.value = 0; object.transform.position.y.value = 5; object.transform.position.z.value = 0
    object.rigidBody = {enabled:true,mode:'dynamic',mass:1,restitution:0,friction:.4,velocity:[0,0,0],angularVelocity:[0,0,0]}
    scene.objects = [object]
    return {scene,object}
  }
  const options = {start:0,end:2,frameRate:30,gravity:-9.81,ground:0}
  it('falls onto a collider deterministically without mutating authored channels', async () => {
    const {scene,object} = fixture()
    const result = await bakeRigidBodies(scene,options), again = await bakeRigidBodies(scene,options)
    const values = result[0]!.position.y.map(key => key.value)
    expect(values).toEqual(again[0]!.position.y.map(key => key.value))
    expect(values[0]).toBe(5); expect(values[10]!).toBeLessThan(5)
    expect(values.at(-1)).toBeCloseTo(1.15,1)
    expect(object.transform.position.y.keyframes).toEqual([])
    applyPhysicsBake(scene,result,0,2)
    expect(object.transform.position.y.animated).toBe(true)
    expect(object.transform.position.y.keyframes).toHaveLength(61)
  })
  it('cancels before changing the scene and rejects excessive ranges', async () => {
    const {scene,object} = fixture(), controller = new AbortController()
    controller.abort()
    await expect(bakeRigidBodies(scene,{...options,signal:controller.signal})).rejects.toThrow('cancelled')
    expect(object.transform.position.y.keyframes).toHaveLength(0)
    await expect(bakeRigidBodies(scene,{...options,end:1000})).rejects.toThrow('3,600')
  })
})
