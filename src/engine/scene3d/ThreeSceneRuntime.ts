import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { evaluate3DPath } from '@/engine/scene3d/pathEvaluation'
import { applyInfluences, influenceSignature } from '@/engine/scene3d/influences'
import { deformRig } from '@/engine/rig/rigMesh'
import { bonePoseMatrices, rigIsActive, rigPoseSignature, rigRestSignature } from '@/engine/rig/skeleton'
import { mediaUrl } from '@/services/mediaLibrary'
import type { Aurora3DObject, Aurora3DScene, AuroraCamera, AuroraLight, AuroraRig, MediaAsset, Transform3D } from '@/models/editor'

export interface Scene3DRuntime {
  sceneId: string
  revision: number
  scene: THREE.Scene
  root: THREE.Group
  objects: Map<string, THREE.Object3D>
  cameras: Map<string, THREE.Camera>
  lights: Map<string, THREE.Light>
}

function applyTransform(target: THREE.Object3D, transform: Transform3D, time: number) {
  target.position.set(
    evaluateNumericProperty(transform.position.x, time),
    evaluateNumericProperty(transform.position.y, time),
    evaluateNumericProperty(transform.position.z, time),
  )
  target.rotation.set(
    THREE.MathUtils.degToRad(evaluateNumericProperty(transform.rotation.x, time)),
    THREE.MathUtils.degToRad(evaluateNumericProperty(transform.rotation.y, time)),
    THREE.MathUtils.degToRad(evaluateNumericProperty(transform.rotation.z, time)),
  )
  target.scale.set(
    evaluateNumericProperty(transform.scale.x, time),
    evaluateNumericProperty(transform.scale.y, time),
    evaluateNumericProperty(transform.scale.z, time),
  )
}

function imageAssetFor(object: Aurora3DObject, assets: Map<string, MediaAsset>) {
  const asset = object.assetId ? assets.get(object.assetId) : undefined
  return asset?.kind === 'image' || asset?.kind === 'texture' ? asset : undefined
}

function imageUrl(asset: MediaAsset | undefined) {
  return asset?.hash ? mediaUrl(asset.hash) : asset?.thumbnail
}

function imageAspect(asset: MediaAsset | undefined) {
  const match = asset?.dimensions?.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return 1
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : 1
}

/** Half-extents of an image plane, shared by the geometry it builds and the editor handles drawn on it. */
export function planeHalfExtents(object: Aurora3DObject, assets: Map<string, MediaAsset>) {
  const aspect = imageAspect(imageAssetFor(object, assets))
  return { halfWidth: (aspect >= 1 ? 2 : 2 * aspect) / 2, halfHeight: (aspect >= 1 ? 2 / aspect : 2) / 2 }
}

function makeGeometry(object: Aurora3DObject, assets: Map<string, MediaAsset>): THREE.BufferGeometry {
  if (object.primitive === 'sphere') return new THREE.SphereGeometry(1.15, 48, 32)
  if (object.primitive === 'plane') {
    const { halfWidth, halfHeight } = planeHalfExtents(object, assets)
    return new THREE.PlaneGeometry(halfWidth * 2, halfHeight * 2)
  }
  return new THREE.BoxGeometry(2, 2, 2, 2, 2, 2)
}

function makeObject(definition: Aurora3DObject, assets: Map<string, MediaAsset>): THREE.Object3D {
  if (definition.type !== 'mesh') return new THREE.Group()
  const material = new THREE.MeshStandardMaterial({
    color: definition.material.baseColor,
    emissive: definition.material.emissive,
    transparent: true,
  })
  const mesh = new THREE.Mesh(makeGeometry(definition, assets), material)
  mesh.castShadow = definition.castShadow
  mesh.receiveShadow = definition.receiveShadow
  return mesh
}

function makeCamera(definition: AuroraCamera, aspect: number): THREE.Camera {
  if (definition.projection === 'orthographic') {
    const height = 6
    return new THREE.OrthographicCamera(-height * aspect, height * aspect, height, -height, definition.near, definition.far)
  }
  return new THREE.PerspectiveCamera(definition.fov.value, aspect, definition.near, definition.far)
}

function makeLight(definition: AuroraLight): THREE.Light {
  if (definition.type === 'ambient') return new THREE.AmbientLight(definition.color, definition.intensity.value)
  if (definition.type === 'point') return new THREE.PointLight(definition.color, definition.intensity.value, 0, 2)
  return new THREE.DirectionalLight(definition.color, definition.intensity.value)
}

/**
 * Builds the plane a rig bends, as a grid the skeleton has already deformed.
 *
 * The rig's own square runs from -1 to 1, so the same skeleton fits any plane: only the half-extents
 * change. Normals stay flat because a rigged plane is still a flat card, however far it is bent.
 *
 * The rig mesh carries image-style UVs with V growing downward, which is what the 2D renderer wants.
 * Three's own plane counts V upward, so V is flipped here — without it the rigged plane would show
 * its texture upside down the moment the first bone appeared.
 */
function makeRiggedPlaneGeometry(definition: Aurora3DObject, rig: AuroraRig, assets: Map<string, MediaAsset>, time: number) {
  const { halfWidth, halfHeight } = planeHalfExtents(definition, assets)
  const { mesh, positions } = deformRig(rig, bonePoseMatrices(rig, time), time)
  const count = mesh.points.length
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    position[index * 3] = positions[index * 2]! * halfWidth
    position[index * 3 + 1] = positions[index * 2 + 1]! * halfHeight
    normal[index * 3 + 2] = 1
  }
  const uv = new Float32Array(count * 2)
  for (let index = 0; index < count; index += 1) {
    uv[index * 2] = mesh.uvs[index * 2]!
    uv[index * 2 + 1] = 1 - mesh.uvs[index * 2 + 1]!
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices.slice(), 1))
  return geometry
}

/**
 * Rebuilds geometry only when what drives it actually changes, keeping the untouched primitive on
 * the mesh so every rebuild starts from the same source.
 *
 * A rigged plane is generated wholesale from the skeleton's grid, so it takes over from the
 * influence stack rather than stacking on top of it: an influence chain expects to reshape the
 * primitive, and there is no primitive left once the rig has replaced it.
 */
function syncGeometry(mesh: THREE.Mesh, definition: Aurora3DObject, rig: AuroraRig | undefined, assets: Map<string, MediaAsset>, time: number) {
  const rigged = definition.primitive === 'plane' && rigIsActive(rig)
  const signature = rigged
    ? `rig:${rigRestSignature(rig)}#${rigPoseSignature(rig, time)}`
    : `influence:${influenceSignature(definition.influences, time)}`
  if (mesh.userData.geometrySignature === signature) return
  const base = (mesh.userData.baseGeometry as THREE.BufferGeometry | undefined) ?? mesh.geometry
  mesh.userData.baseGeometry = base
  const next = rigged && rig
    ? makeRiggedPlaneGeometry(definition, rig, assets, time)
    : applyInfluences(base, definition.influences, time)
  if (mesh.geometry !== base && mesh.geometry !== next) mesh.geometry.dispose()
  mesh.geometry = next
  mesh.userData.geometrySignature = signature
}

function entityWorldPosition(runtime: Scene3DRuntime, entityId: string) {
  const target = runtime.objects.get(entityId) ?? runtime.lights.get(entityId) ?? runtime.cameras.get(entityId)
  return target ? target.getWorldPosition(new THREE.Vector3()) : null
}

/** Right / up / backwards basis around the direction of travel, used to place the constraint offset. */
function pathTravelFrame(tangent: THREE.Vector3) {
  const forward = tangent.clone().normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0))
  if (right.lengthSq() < 0.000001) right.crossVectors(forward, new THREE.Vector3(0, 0, 1))
  right.normalize()
  return { forward, right, up: new THREE.Vector3().crossVectors(right, forward).normalize() }
}

/**
 * Drives a constrained camera from its path instead of its own transform: the position always comes
 * from the curve, while the orientation either follows the tangent or stays locked on a target entity.
 * The offset is applied before aiming, so a look-at target stays dead centre however far the camera
 * is pushed off the curve.
 */
function applyCameraPathConstraint(runtime: Scene3DRuntime, camera: THREE.Camera, definition: AuroraCamera, scene: Aurora3DScene, time: number) {
  const constraint = definition.pathConstraint
  const path = constraint ? scene.paths?.find((item) => item.id === constraint.pathId) : undefined
  if (!constraint || !path) return false
  const { position, tangent } = evaluate3DPath(path, evaluateNumericProperty(constraint.progress, time), time)
  const { forward, right, up } = pathTravelFrame(tangent)
  if (constraint.offset) {
    position
      .addScaledVector(right, evaluateNumericProperty(constraint.offset.x, time))
      .addScaledVector(up, evaluateNumericProperty(constraint.offset.y, time))
      .addScaledVector(forward, -evaluateNumericProperty(constraint.offset.z, time))
  }
  const target = constraint.orientation === 'look-at' && constraint.lookAtEntityId
    ? entityWorldPosition(runtime, constraint.lookAtEntityId)
    : null
  camera.position.copy(position)
  camera.up.set(0, 1, 0)
  camera.lookAt(target ?? position.clone().add(forward))
  const bank = THREE.MathUtils.degToRad(evaluateNumericProperty(constraint.bank, time))
  if (bank) camera.rotateZ(bank)
  camera.updateMatrixWorld(true)
  return true
}

/** Follows an object's evaluated world transform, with offsets authored in the object's local axes. */
function applyCameraObjectConstraint(runtime: Scene3DRuntime, camera: THREE.Camera, definition: AuroraCamera, time: number) {
  const constraint = definition.objectConstraint
  const target = constraint ? runtime.objects.get(constraint.objectId) : undefined
  if (!constraint || !target) return false

  const targetPosition = target.getWorldPosition(new THREE.Vector3())
  const targetQuaternion = target.getWorldQuaternion(new THREE.Quaternion())
  const localOffset = new THREE.Vector3(
    evaluateNumericProperty(constraint.positionOffset.x, time),
    evaluateNumericProperty(constraint.positionOffset.y, time),
    evaluateNumericProperty(constraint.positionOffset.z, time),
  ).applyQuaternion(targetQuaternion)
  const rotationOffset = new THREE.Euler(
    THREE.MathUtils.degToRad(evaluateNumericProperty(constraint.rotationOffset.x, time)),
    THREE.MathUtils.degToRad(evaluateNumericProperty(constraint.rotationOffset.y, time)),
    THREE.MathUtils.degToRad(evaluateNumericProperty(constraint.rotationOffset.z, time)),
    'XYZ',
  )

  camera.position.copy(targetPosition).add(localOffset)
  if (constraint.orientation === 'look-at') {
    const lookTarget = constraint.lookAtEntityId
      ? entityWorldPosition(runtime, constraint.lookAtEntityId) ?? targetPosition
      : targetPosition
    camera.up.set(0, 1, 0)
    camera.lookAt(lookTarget)
    camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(rotationOffset))
  } else {
    camera.quaternion.copy(targetQuaternion).multiply(new THREE.Quaternion().setFromEuler(rotationOffset))
  }
  camera.updateMatrixWorld(true)
  return true
}

export class ThreeSceneRuntimeRegistry {
  private runtimes = new Map<string, Scene3DRuntime>()
  private texturePromises = new Map<string, Promise<THREE.Texture | null>>()
  private textures = new Map<string, THREE.Texture>()
  private disposed = false

  constructor(private readonly onInvalidate?: () => void) {}

  get(sceneDefinition: Aurora3DScene, width: number, height: number, time: number, assets: readonly MediaAsset[] = [], rigs: readonly AuroraRig[] = []): Scene3DRuntime {
    this.disposed = false
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
    const rigMap = new Map(rigs.map((rig) => [rig.id, rig]))
    let runtime = this.runtimes.get(sceneDefinition.id)
    if (!runtime || runtime.revision !== sceneDefinition.revision) {
      if (runtime) this.disposeRuntime(runtime)
      runtime = this.create(sceneDefinition, width / Math.max(1, height), assetMap)
      this.runtimes.set(sceneDefinition.id, runtime)
    }
    this.update(runtime, sceneDefinition, width / Math.max(1, height), time, assetMap, rigMap)
    return runtime
  }

  /** Preloads image-plane maps so offline/export renders do not emit a blank first frame. */
  async prepareAssets(sceneDefinitions: readonly Aurora3DScene[], assets: readonly MediaAsset[]) {
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
    const urls = new Set(sceneDefinitions.flatMap((scene) => scene.objects.flatMap((object) => {
      const url = imageUrl(imageAssetFor(object, assetMap))
      return object.primitive === 'plane' && url ? [url] : []
    })))
    await Promise.all([...urls].map((url) => this.ensureTexture(url)))
  }

  private ensureTexture(url: string) {
    const existing = this.texturePromises.get(url)
    if (existing) return existing
    const loading = new THREE.TextureLoader().loadAsync(url).then((texture) => {
      if (this.disposed) {
        texture.dispose()
        return null
      }
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.needsUpdate = true
      this.textures.set(url, texture)
      return texture
    }).catch(() => null)
    this.texturePromises.set(url, loading)
    return loading
  }

  private syncImageMap(material: THREE.MeshStandardMaterial, definition: Aurora3DObject, assets: Map<string, MediaAsset>) {
    const url = definition.primitive === 'plane' ? imageUrl(imageAssetFor(definition, assets)) : undefined
    if (material.userData.auroraImageUrl === url) {
      const ready = url ? this.textures.get(url) : undefined
      if (ready && material.map !== ready) {
        material.map = ready
        material.needsUpdate = true
      }
      return
    }

    material.userData.auroraImageUrl = url
    material.map = url ? this.textures.get(url) ?? null : null
    material.side = url ? THREE.DoubleSide : THREE.FrontSide
    // Alpha blending preserves soft edges; skipping depth writes stops invisible texels occluding
    // geometry behind the card. alphaTest discards fully transparent pixels in shadow/depth passes.
    material.depthWrite = !url
    material.alphaTest = url ? .001 : 0
    material.needsUpdate = true
    if (!url || material.map) return
    void this.ensureTexture(url).then((texture) => {
      if (!texture || material.userData.auroraImageUrl !== url) return
      material.map = texture
      material.needsUpdate = true
      this.onInvalidate?.()
    })
  }

  private create(definition: Aurora3DScene, aspect: number, assets: Map<string, MediaAsset>): Scene3DRuntime {
    const scene = new THREE.Scene()
    const root = new THREE.Group()
    root.name = definition.name
    scene.add(root)
    const runtime: Scene3DRuntime = {
      sceneId: definition.id,
      revision: definition.revision,
      scene,
      root,
      objects: new Map(),
      cameras: new Map(),
      lights: new Map(),
    }
    definition.objects.forEach((item) => {
      const object = makeObject(item, assets)
      object.name = item.name
      object.userData.auroraId = item.id
      runtime.objects.set(item.id, object)
    })
    definition.objects.forEach((item) => {
      const object = runtime.objects.get(item.id)
      const parent = item.parentId ? runtime.objects.get(item.parentId) : root
      if (object) (parent ?? root).add(object)
    })
    definition.cameras.forEach((item) => {
      const camera = makeCamera(item, aspect)
      camera.name = item.name
      camera.userData.auroraId = item.id
      runtime.cameras.set(item.id, camera)
      root.add(camera)
    })
    definition.lights.forEach((item) => {
      const light = makeLight(item)
      light.name = item.name
      light.userData.auroraId = item.id
      runtime.lights.set(item.id, light)
      root.add(light)
      if (light instanceof THREE.DirectionalLight) root.add(light.target)
    })
    return runtime
  }

  private update(runtime: Scene3DRuntime, definition: Aurora3DScene, aspect: number, time: number, assets: Map<string, MediaAsset>, rigs: Map<string, AuroraRig> = new Map()) {
    runtime.revision = definition.revision
    runtime.scene.background = definition.settings.backgroundColor ? new THREE.Color(definition.settings.backgroundColor) : null
    definition.objects.forEach((item) => {
      const object = runtime.objects.get(item.id)
      if (!object) return
      object.visible = item.visible
      applyTransform(object, item.transform, time)
      if (object instanceof THREE.Mesh) syncGeometry(object, item, item.rigId ? rigs.get(item.rigId) : undefined, assets, time)
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
        this.syncImageMap(object.material, item, assets)
        object.material.color.set(item.material.baseColor)
        object.material.emissive.set(item.material.emissive)
        object.material.opacity = evaluateNumericProperty(item.material.opacity, time)
        object.material.metalness = evaluateNumericProperty(item.material.metalness, time)
        object.material.roughness = evaluateNumericProperty(item.material.roughness, time)
        object.material.emissiveIntensity = evaluateNumericProperty(item.material.emissiveIntensity, time)
        object.material.needsUpdate = true
      }
    })
    runtime.root.updateMatrixWorld(true)
    definition.cameras.forEach((item) => {
      const camera = runtime.cameras.get(item.id)
      if (!camera) return
      camera.visible = item.visible
      applyTransform(camera, item.transform, time)
      if (!applyCameraObjectConstraint(runtime, camera, item, time)) applyCameraPathConstraint(runtime, camera, item, definition, time)
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = aspect
        camera.fov = evaluateNumericProperty(item.fov, time)
        camera.near = item.near
        camera.far = item.far
        camera.updateProjectionMatrix()
      } else if (camera instanceof THREE.OrthographicCamera) {
        const height = 6
        camera.left = -height * aspect
        camera.right = height * aspect
        camera.top = height
        camera.bottom = -height
        camera.near = item.near
        camera.far = item.far
        camera.updateProjectionMatrix()
      }
    })
    definition.lights.forEach((item) => {
      const light = runtime.lights.get(item.id)
      if (!light) return
      light.visible = item.visible
      light.color.set(item.color)
      light.intensity = evaluateNumericProperty(item.intensity, time)
      applyTransform(light, item.transform, time)
      if ('castShadow' in light) light.castShadow = item.castShadow
      if (light instanceof THREE.DirectionalLight) {
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(light.quaternion)
        light.target.position.copy(light.position).add(direction)
        light.target.updateMatrixWorld(true)
      }
    })
  }

  disposeScene(sceneId: string) {
    const runtime = this.runtimes.get(sceneId)
    if (!runtime) return
    this.disposeRuntime(runtime)
    this.runtimes.delete(sceneId)
  }

  dispose() {
    this.disposed = true
    this.runtimes.forEach((runtime) => this.disposeRuntime(runtime))
    this.runtimes.clear()
    this.textures.forEach((texture) => texture.dispose())
    this.textures.clear()
    this.texturePromises.clear()
  }

  private disposeRuntime(runtime: Scene3DRuntime) {
    runtime.scene.traverse((object) => {
      let candidate: THREE.Object3D | null = object
      while (candidate) {
        if (candidate.userData.editorOnly) return
        candidate = candidate.parent
      }
      if (!(object instanceof THREE.Mesh)) return
      const base = object.userData.baseGeometry as THREE.BufferGeometry | undefined
      if (base && base !== object.geometry) base.dispose()
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => material.dispose())
    })
    runtime.scene.clear()
  }
}
