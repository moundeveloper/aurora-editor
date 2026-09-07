import { Body, Box, ContactMaterial, Material, Plane, Sphere, Vec3, World } from 'cannon-es'
import * as THREE from 'three'
import type { Aurora3DObject, Aurora3DScene, Keyframe } from '@/models/editor'
import { pathTransformComponents } from './pathEvaluation'
import { bindNumericScope } from '@/engine/animation/propertyScope'

export interface PhysicsBakeOptions { start: number; end: number; frameRate: number; gravity: number; ground: number; signal?: AbortSignal; progress?: (value: number) => void }
export interface BakedBody { id: string; position: Record<'x'|'y'|'z', Keyframe<number>[]>; rotation: Record<'x'|'y'|'z', Keyframe<number>[]> }
export function supportsRigidBody(object: Aurora3DObject) { return object.type === 'mesh' && !object.locked && !object.parentId && (object.primitive === 'box' || object.primitive === 'sphere') }

/** Fixed substeps produce editable transforms. Nothing in the authored scene changes until apply. */
export async function bakeRigidBodies(scene: Aurora3DScene, options: PhysicsBakeOptions) {
  bindNumericScope(scene)
  const {start,end,frameRate} = options
  if (!Number.isFinite(start + end + frameRate) || start < 0 || end <= start || frameRate < 1 || frameRate > 240) throw new Error('Invalid bake range or frame rate.')
  const frames = Math.ceil((end-start)*frameRate)
  if (frames > 3600) throw new Error('Bake at most 3,600 frames at a time.')
  const definitions = scene.objects.filter(object => object.rigidBody?.enabled && supportsRigidBody(object))
  if (definitions.length > 64) throw new Error('Bake at most 64 rigid bodies at a time.')
  if (!definitions.some(object => object.rigidBody?.mode === 'dynamic')) throw new Error('Enable a dynamic body before baking.')
  const world = new World({gravity:new Vec3(0,options.gravity,0),allowSleep:true})
  const groundMaterial = new Material({friction:.4,restitution:.2})
  const ground = new Body({mass:0,shape:new Plane(),material:groundMaterial})
  ground.position.y = options.ground; ground.quaternion.setFromEuler(-Math.PI/2,0,0)
  world.addBody(ground)
  const bodies = definitions.map(object => {
    const settings = object.rigidBody!, pose = pathTransformComponents(object.transform,start)
    const scale = pose.scale.clone().set(Math.abs(pose.scale.x),Math.abs(pose.scale.y),Math.abs(pose.scale.z)).max(new THREE.Vector3(.001,.001,.001))
    const material = new Material({friction:Math.max(0,settings.friction),restitution:Math.max(0,Math.min(1,settings.restitution))})
    const body = new Body({mass:settings.mode === 'static' ? 0 : Math.max(.001,settings.mass),material,
      shape:object.primitive === 'sphere' ? new Sphere(1.15*Math.max(scale.x,scale.y,scale.z)) : new Box(new Vec3(scale.x,scale.y,scale.z))})
    body.position.set(pose.position.x,pose.position.y,pose.position.z)
    body.quaternion.setFromEuler(pose.rotation.x,pose.rotation.y,pose.rotation.z,'XYZ')
    body.velocity.set(...settings.velocity); body.angularVelocity.set(...settings.angularVelocity)
    world.addContactMaterial(new ContactMaterial(material,groundMaterial,{friction:settings.friction,restitution:settings.restitution}))
    world.addBody(body)
    return {object,body,result:{id:object.id,position:{x:[],y:[],z:[]},rotation:{x:[],y:[],z:[]}} as BakedBody,previous:new THREE.Vector3()}
  })
  const substeps = Math.max(1,Math.ceil(120/frameRate))
  for (let frame = 0; frame <= frames; frame++) {
    if (options.signal?.aborted) throw new DOMException('Physics bake cancelled','AbortError')
    const time = Math.min(end,start+frame/frameRate)
    if (frame) { const delta = time - Math.min(end,start+(frame-1)/frameRate); for(let step=0;step<substeps;step++) world.step(delta/substeps) }
    for (const {object,body,result,previous} of bodies) {
      if (object.rigidBody!.mode === 'static') continue
      const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w),'XYZ')
      for (const axis of ['x','y','z'] as const) {
        let angle = THREE.MathUtils.radToDeg(rotation[axis])
        if (frame) angle += 360*Math.round((previous[axis]-angle)/360)
        previous[axis] = angle
        result.position[axis].push({id:crypto.randomUUID(),time,value:body.position[axis],interpolation:'linear'})
        result.rotation[axis].push({id:crypto.randomUUID(),time,value:angle,interpolation:'linear'})
      }
    }
    if (frame % 30 === 0) { options.progress?.(frame/frames); await new Promise(resolve => setTimeout(resolve,0)) }
  }
  options.progress?.(1)
  return bodies.filter(item => item.object.rigidBody!.mode === 'dynamic').map(item => item.result)
}

export function applyPhysicsBake(scene: Aurora3DScene, bodies: BakedBody[], start: number, end: number) {
  for (const result of bodies) {
    const object = scene.objects.find(item => item.id === result.id)
    if (!object) continue
    for (const group of ['position','rotation'] as const) for (const axis of ['x','y','z'] as const) {
      const channel = object.transform[group][axis]
      channel.keyframes = [...channel.keyframes.filter(key => key.time < start || key.time > end),...result[group][axis]].sort((a,b) => a.time-b.time)
      channel.animated = true
      if (channel.driver) channel.driver.enabled = false
      for (const modifier of channel.modifiers ?? []) modifier.enabled = false
    }
  }
}
