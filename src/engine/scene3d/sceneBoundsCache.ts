import * as THREE from 'three'

const boundsCache = new WeakMap<THREE.Object3D, { signature: unknown[]; bounds: THREE.Box3 }>()
const geometryVersions = new WeakMap<THREE.BufferGeometry, unknown[]>()
const instanceVersions = new WeakMap<THREE.InstancedMesh, unknown[]>()
const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && b.every((value, index) => value === a[index])
function version(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) {
  return attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.version : attribute?.version
}

/** Call after evaluating world matrices. Only geometry/instance/transform changes refit shadows. */
export function cachedSceneBounds(root: THREE.Object3D): THREE.Box3 {
  const signature: unknown[] = []
  let deforming = false
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.geometry) return
    if (object instanceof THREE.SkinnedMesh || mesh.morphTargetInfluences?.length) deforming = true
    const geometry = mesh.geometry, position = geometry.getAttribute('position')
    const geometryVersion = [position, version(position), geometry.index, geometry.index?.version]
    if (!same(geometryVersions.get(geometry), geometryVersion)) {
      // Buffer edits can retain the same geometry identity and a stale local bounding box.
      if (geometry.boundingBox) geometry.computeBoundingBox()
      geometryVersions.set(geometry, geometryVersion)
    }
    signature.push(object.id, geometry, ...geometryVersion, ...object.matrixWorld.elements)
    if (object instanceof THREE.InstancedMesh) {
      signature.push(object.count, object.instanceMatrix, object.instanceMatrix.version)
      const instanceVersion = [geometry, ...geometryVersion, object.count, object.instanceMatrix, object.instanceMatrix.version]
      if (!same(instanceVersions.get(object), instanceVersion)) {
        object.computeBoundingBox()
        instanceVersions.set(object, instanceVersion)
      }
    }
  })
  const cached = boundsCache.get(root)
  if (!deforming && cached && same(cached.signature, signature)) return cached.bounds
  const bounds = new THREE.Box3().setFromObject(root)
  boundsCache.set(root, { signature, bounds })
  return bounds
}
