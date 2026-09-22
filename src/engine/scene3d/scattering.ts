import * as THREE from 'three'
import type { Aurora3DObject, Aurora3DScene } from '@/models/editor'
import { evaluate3DPath, pathTransformMatrix } from './pathEvaluation'

function randomSequence(seed: number) {
  let state = seed | 0
  return () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296 }
}

/** Deterministic samples from the evaluated target geometry, weighted by world-space area. */
export function scatterMatrices(source: THREE.Mesh, target: THREE.Mesh | undefined, definition: Aurora3DObject, scene: Aurora3DScene, time: number) {
  const settings = definition.scatter
  if (!settings?.enabled) return []
  const random = randomSequence(settings.seed)
  const count = Math.max(0, Math.min(5000, Math.floor(settings.count)))
  const path = scene.paths.find(item => item.id === settings.targetId)
  const triangles: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; normal: THREE.Vector3; end: number }[] = []
  let total = 0
  if (settings.mode === 'surface' && target) {
    const geometry = target.geometry, position = geometry.getAttribute('position'), index = geometry.getIndex()
    for (let i = 0; i + 2 < (index?.count ?? position.count); i += 3) {
      const vertex = (offset: number) => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(offset) : offset).applyMatrix4(target.matrixWorld)
      const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2)
      const cross = b.clone().sub(a).cross(c.clone().sub(a)), area = cross.length() / 2
      if (area < 1e-12) continue
      total += area
      triangles.push({a,b,c,normal:cross.normalize(),end:total})
    }
  }
  if (settings.mode === 'surface' ? !triangles.length : !path) return []
  const originalRotation = source.getWorldQuaternion(new THREE.Quaternion())
  const originalScale = source.getWorldScale(new THREE.Vector3())
  const matrices: THREE.Matrix4[] = []
  for (let i = 0; i < count; i++) {
    let point: THREE.Vector3, direction: THREE.Vector3
    if (settings.mode === 'path' && path) {
      const sample = evaluate3DPath(path, count < 2 ? .5 : i / (path.closed ? count : count - 1), time)
      point = sample.position; direction = sample.tangent
    } else {
      const area = random() * total
      let lo = 0, hi = triangles.length - 1
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (triangles[mid]!.end < area) lo = mid + 1; else hi = mid }
      const triangle = triangles[lo]!, u = Math.sqrt(random()), v = random()
      point = triangle.a.clone().multiplyScalar(1-u).addScaledVector(triangle.b,u*(1-v)).addScaledVector(triangle.c,u*v)
      direction = triangle.normal
    }
    const jitter = Math.max(0, settings.jitter)
    point.add(new THREE.Vector3(random()-.5,random()-.5,random()-.5).multiplyScalar(jitter))
    const rotation = settings.align ? new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), direction).multiply(originalRotation) : originalRotation
    const scale = originalScale.clone().multiplyScalar(Math.max(.001, 1 + (random()*2-1)*Math.max(0,Math.min(1,settings.scaleVariation))))
    matrices.push(new THREE.Matrix4().compose(point,rotation,scale))
  }
  return matrices
}

const scatterCache = new WeakMap<THREE.InstancedMesh, string>()

/** Surface samples only change with geometry, transforms or settings, not with the playhead. */
function scatterSignature(root: THREE.Group, source: THREE.Mesh, target: THREE.Mesh | undefined, definition: Aurora3DObject, scene: Aurora3DScene, time: number) {
  const geometry = target?.geometry
  const position = geometry?.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined
  const positionVersion = position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position?.version
  const path = definition.scatter?.mode === 'path' ? scene.paths.find(p => p.id === definition.scatter?.targetId) : undefined
  return JSON.stringify([
    definition.scatter, source.matrixWorld.elements, root.matrixWorld.elements,
    geometry?.uuid, positionVersion, geometry?.index?.version, target?.matrixWorld.elements,
    // Evaluated transforms include animation/drivers while static paths reuse their buffers too.
    path ? [path.points, path.closed, pathTransformMatrix(path.transform,time).elements] : null,
  ])
}

export function syncScattering(root: THREE.Group, objects: Map<string, THREE.Object3D>, scene: Aurora3DScene, time: number) {
  const existing = new Map(root.children.filter(item => item.userData.auroraScatter).map(item => [item.userData.auroraScatter as string,item as THREE.InstancedMesh]))
  for (const definition of scene.objects) {
    const source = objects.get(definition.id), target = objects.get(definition.scatter?.targetId ?? '')
    if (!(source instanceof THREE.Mesh) || !definition.scatter?.enabled) continue
    const targetMesh = target instanceof THREE.Mesh ? target : undefined
    const signature = scatterSignature(root,source,targetMesh,definition,scene,time)
    let instances = existing.get(definition.id)
    const count = Math.max(0, Math.min(5000, Math.floor(definition.scatter.count)))
    if (instances && (instances.count !== count || instances.geometry !== source.geometry || instances.material !== source.material)) {
      root.remove(instances); instances.dispose(); instances = undefined; existing.delete(definition.id)
    }
    const changed = !instances || scatterCache.get(instances) !== signature
    const matrices = changed ? scatterMatrices(source,targetMesh,definition,scene,time) : null
    if (matrices && !matrices.length) continue // Leave old instances in `existing` for cleanup.
    existing.delete(definition.id)
    if (!instances) {
      instances = new THREE.InstancedMesh(source.geometry,source.material,matrices!.length)
      instances.userData.auroraScatter = definition.id
      root.add(instances)
    }
    instances.visible = source.visible
    for (let parent = source.parent; parent && instances.visible; parent = parent.parent) {
      instances.visible = parent.visible
    }
    instances.castShadow = source.castShadow; instances.receiveShadow = source.receiveShadow
    if (matrices) {
      const inverseRoot = root.matrixWorld.clone().invert(), local = new THREE.Matrix4()
      matrices.forEach((matrix,index) => instances!.setMatrixAt(index,local.multiplyMatrices(inverseRoot,matrix)))
      instances.instanceMatrix.needsUpdate = true
      instances.computeBoundingSphere()
      instances.computeBoundingBox()
      scatterCache.set(instances,signature)
    }
  }
  for (const instances of existing.values()) { root.remove(instances); instances.dispose() }
}
