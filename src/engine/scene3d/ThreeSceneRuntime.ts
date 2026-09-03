import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { evaluate3DPath } from '@/engine/scene3d/pathEvaluation'
import { applyInfluences, influenceSignature, linearArrayCopies } from '@/engine/scene3d/influences'
import { deformRig } from '@/engine/rig/rigMesh'
import { bonePoseMatrices, rigIsActive, rigPoseSignature, rigRestSignature } from '@/engine/rig/skeleton'
import { mediaUrl } from '@/services/mediaLibrary'
import type { Aurora3DObject, Aurora3DScene, AuroraCamera, AuroraLight, AuroraRig, MediaAsset, Transform3D } from '@/models/editor'

/**
 * Blender's default world grey, in linear radiance. A scene with no radiance map still lights from
 * a uniform world there, which is what stops a surface going black once the camera leaves the
 * specular highlight.
 */
export const NEUTRAL_WORLD_RADIANCE = .05

export interface Scene3DRuntime {
  sceneId: string
  revision: number
  structureKey: string
  scene: THREE.Scene
  root: THREE.Group
  objects: Map<string, THREE.Object3D>
  cameras: Map<string, THREE.Camera>
  lights: Map<string, THREE.Light>
}

/** Value edits must not rebuild a complete Three scene. Only topology changes earn a new runtime. */
function sceneStructureKey(definition: Aurora3DScene, assets: Map<string, MediaAsset>) {
  const objects = definition.objects.map((object) => [
    object.id, object.type, object.primitive, object.parentId ?? '', object.assetId ?? '',
    object.assetId ? assets.get(object.assetId)?.dimensions ?? '' : '',
  ].join(':')).join('|')
  const cameras = definition.cameras.map((camera) => `${camera.id}:${camera.projection}`).join('|')
  const lights = definition.lights.map((light) => `${light.id}:${light.type}`).join('|')
  return `${objects}#${cameras}#${lights}`
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

/** The mesh file a model object points at, if it is still present in the library. */
export function modelAssetFor(object: Aurora3DObject, assets: Map<string, MediaAsset>) {
  const asset = object.primitive === 'model' && object.assetId ? assets.get(object.assetId) : undefined
  return asset?.kind === 'model3d' && asset.hash ? asset : undefined
}

/** The environment map an authored scene points at, if it is still present in the library. */
export function environmentAssetFor(scene: Aurora3DScene, assets: Map<string, MediaAsset>) {
  const asset = scene.environmentAssetId ? assets.get(scene.environmentAssetId) : undefined
  return asset?.kind === 'hdr' && asset.hash ? asset : undefined
}

/**
 * Which decoder a radiance file needs. Both formats carry values above 1, which is the whole point
 * of lighting from one, and each needs its own loader — the shared TextureLoader reads neither.
 */
export function environmentDecoderFor(fileName: string): 'rgbe' | 'exr' | null {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  if (extension === 'hdr') return 'rgbe'
  if (extension === 'exr') return 'exr'
  return null
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
  // A model is a host for an imported subtree. It builds no geometry of its own, which keeps the
  // file's own materials and node hierarchy intact instead of flattening them into one mesh.
  if (definition.primitive === 'model') return new THREE.Group()
  if (definition.type !== 'mesh') return new THREE.Group()
  const material = new THREE.MeshStandardMaterial({
    color: definition.material.baseColor,
    emissive: definition.material.emissive,
    transparent: true,
    // An image card has no physical thickness. It must remain visible while the editor camera
    // orbits behind it, including before its texture has finished resolving.
    side: definition.primitive === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
  })
  const mesh = new THREE.Mesh(makeGeometry(definition, assets), material)
  // Rig and influence deformation can move a card beyond stale CPU bounds. Image planes are cheap
  // enough that testing them in the depth pass is safer than incorrectly dropping the whole card.
  mesh.frustumCulled = definition.primitive !== 'plane'
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
  if (definition.type === 'spot') {
    return new THREE.SpotLight(
      definition.color,
      definition.intensity.value,
      definition.distance?.value ?? 0,
      THREE.MathUtils.degToRad(definition.angle?.value ?? 32),
      definition.penumbra?.value ?? .25,
      2,
    )
  }
  if (definition.type === 'point') return new THREE.PointLight(definition.color, definition.intensity.value, 0, 2)
  return new THREE.DirectionalLight(definition.color, definition.intensity.value)
}

function setShadowMapSize(shadow: THREE.LightShadow<THREE.Camera>, requestedSize: number) {
  const size = Math.pow(2, Math.round(Math.log2(Math.max(256, Math.min(4096, requestedSize)))))
  if (shadow.mapSize.width === size && shadow.mapSize.height === size) return
  shadow.map?.dispose()
  shadow.map = null
  shadow.mapSize.set(size, size)
  shadow.needsUpdate = true
}

/** Fits the shadow volume to authored geometry instead of Three's tiny default camera. */
function configureShadow(light: THREE.Light, scene: Aurora3DScene, bounds: THREE.Box3) {
  if (!(light instanceof THREE.DirectionalLight) && !(light instanceof THREE.PointLight) && !(light instanceof THREE.SpotLight)) return
  setShadowMapSize(light.shadow, scene.settings.shadowMapSize)
  const sphere = bounds.isEmpty()
    ? new THREE.Sphere(new THREE.Vector3(), 10)
    : bounds.getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(8, Math.min(80, sphere.radius))
  light.shadow.bias = -0.0002
  light.shadow.normalBias = Math.max(.015, radius * .0015)
  light.shadow.radius = 2
  light.shadow.camera.near = .1
  light.shadow.camera.far = Math.max(50, radius * 5)
  if (light instanceof THREE.DirectionalLight) {
    const camera = light.shadow.camera
    camera.left = -radius
    camera.right = radius
    camera.top = radius
    camera.bottom = -radius
  }
  light.shadow.camera.updateProjectionMatrix()
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

const GROUP_ARRAY_HELPER = 'aurora-group-array-helper'

/** Clones only authored descendants, never editor handles or another runtime-generated array. */
function cloneAuthoredSubtree(runtime: Scene3DRuntime, childrenByParent: Map<string, Aurora3DObject[]>, objectId: string): THREE.Object3D | null {
  const source = runtime.objects.get(objectId)
  if (!source) return null
  const clone = source.clone(false)
  clone.userData = { ...source.userData, auroraGroupArrayClone: true }
  ;(childrenByParent.get(objectId) ?? []).forEach((child) => {
    const nested = cloneAuthoredSubtree(runtime, childrenByParent, child.id)
    if (nested) clone.add(nested)
  })
  return clone
}

function syncArrayClone(runtime: Scene3DRuntime, clone: THREE.Object3D) {
  const sourceId = clone.userData.auroraId as string | undefined
  const source = sourceId ? runtime.objects.get(sourceId) : undefined
  if (source) {
    clone.position.copy(source.position)
    clone.quaternion.copy(source.quaternion)
    clone.scale.copy(source.scale)
    clone.visible = source.visible
    if (clone instanceof THREE.Mesh && source instanceof THREE.Mesh) {
      clone.geometry = source.geometry
      clone.material = source.material
      clone.castShadow = source.castShadow
      clone.receiveShadow = source.receiveShadow
    }
  }
  clone.children.forEach((child) => syncArrayClone(runtime, child))
}

/**
 * Linear arrays on transform-only groups repeat the authored child hierarchy. Geometry and
 * materials stay shared, while every clone mirrors the source's evaluated local transform.
 */
function syncGroupArrays(runtime: Scene3DRuntime, definition: Aurora3DScene, time: number) {
  const childrenByParent = new Map<string, Aurora3DObject[]>()
  definition.objects.forEach((object) => {
    if (!object.parentId) return
    const children = childrenByParent.get(object.parentId) ?? []
    children.push(object)
    childrenByParent.set(object.parentId, children)
  })
  definition.objects.filter((object) => object.type === 'group').forEach((groupDefinition) => {
    const group = runtime.objects.get(groupDefinition.id)
    if (!group) return
    const influence = groupDefinition.influences?.find((item) => item.enabled && item.type === 'array')
    const copies = influence ? linearArrayCopies(influence, time).slice(1) : []
    let helper = group.children.find((child) => child.name === GROUP_ARRAY_HELPER)
    if (!copies.length) {
      helper?.removeFromParent()
      return
    }
    const childDefinitions = childrenByParent.get(groupDefinition.id) ?? []
    const structureSignature = `${copies.length}:${childDefinitions.map((child) => child.id).join(',')}`
    if (!helper || helper.userData.structureSignature !== structureSignature) {
      helper?.removeFromParent()
      helper = new THREE.Group()
      helper.name = GROUP_ARRAY_HELPER
      helper.userData.structureSignature = structureSignature
      helper.userData.auroraGroupArrayHelper = true
      copies.forEach(() => {
        const copyRoot = new THREE.Group()
        copyRoot.matrixAutoUpdate = false
        childDefinitions.forEach((child) => {
          const clone = cloneAuthoredSubtree(runtime, childrenByParent, child.id)
          if (clone) copyRoot.add(clone)
        })
        helper!.add(copyRoot)
      })
      group.add(helper)
    }
    copies.forEach((copy, index) => {
      const copyRoot = helper!.children[index]!
      copyRoot.matrix.copy(copy.matrix)
      copyRoot.matrixWorldNeedsUpdate = true
      copyRoot.children.forEach((child) => syncArrayClone(runtime, child))
    })
  })
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
  private environmentPromises = new Map<string, Promise<THREE.Texture | null>>()
  private environments = new Map<string, THREE.Texture>()
  private neutralWorld: THREE.DataTexture | null = null
  private modelPromises = new Map<string, Promise<THREE.Object3D | null>>()
  private models = new Map<string, THREE.Object3D>()
  private disposed = false

  constructor(private readonly onInvalidate?: () => void) {}

  get(sceneDefinition: Aurora3DScene, width: number, height: number, time: number, assets: readonly MediaAsset[] = [], rigs: readonly AuroraRig[] = []): Scene3DRuntime {
    this.disposed = false
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
    const rigMap = new Map(rigs.map((rig) => [rig.id, rig]))
    const structureKey = sceneStructureKey(sceneDefinition, assetMap)
    let runtime = this.runtimes.get(sceneDefinition.id)
    if (!runtime || runtime.structureKey !== structureKey) {
      if (runtime) this.disposeRuntime(runtime)
      runtime = this.create(sceneDefinition, width / Math.max(1, height), assetMap, structureKey)
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

  /**
   * Loads a radiance map once per URL. The decoders are imported on demand so a project that never
   * lights from an environment never pays for them.
   */
  private ensureEnvironment(url: string, decoder: 'rgbe' | 'exr') {
    const existing = this.environmentPromises.get(url)
    if (existing) return existing
    const loading = (async () => {
      const Loader = decoder === 'exr'
        ? (await import('three/addons/loaders/EXRLoader.js')).EXRLoader
        : (await import('three/addons/loaders/HDRLoader.js')).HDRLoader
      const texture = await new Loader().loadAsync(url)
      if (this.disposed) {
        texture.dispose()
        return null
      }
      // Three builds the filtered probe from an equirectangular map itself, so no PMREM pass, and
      // therefore no renderer, is needed here.
      texture.mapping = THREE.EquirectangularReflectionMapping
      texture.needsUpdate = true
      this.environments.set(url, texture)
      return texture
    })().catch(() => null)
    this.environmentPromises.set(url, loading)
    return loading
  }

  /**
   * The stand-in for a scene that lights from no radiance map.
   *
   * An AmbientLight cannot fill this role: Three feeds it into indirect diffuse only, so it adds
   * nothing to the specular term and every glossy surface still falls to black as soon as the
   * camera leaves the highlight. A probe is what carries ambient specular, so the fallback has to
   * be one — a uniform equirectangular map, which the renderer filters into a probe exactly as it
   * does an authored HDR.
   *
   * The size is not free to shrink to the one texel a constant would need: Three derives the
   * filtered probe's mip chain from the source dimensions, and anything under roughly 64x32
   * degenerates into a probe that lights nothing at all.
   */
  private neutralWorldProbe() {
    if (this.neutralWorld) return this.neutralWorld
    const width = 64
    const height = 32
    const data = new Float32Array(width * height * 4)
    for (let texel = 0; texel < width * height; texel += 1) {
      data[texel * 4] = NEUTRAL_WORLD_RADIANCE
      data[texel * 4 + 1] = NEUTRAL_WORLD_RADIANCE
      data[texel * 4 + 2] = NEUTRAL_WORLD_RADIANCE
      data[texel * 4 + 3] = 1
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
    texture.mapping = THREE.EquirectangularReflectionMapping
    // The texels are radiance already, so they must not be decoded on the way in.
    texture.colorSpace = THREE.NoColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    this.neutralWorld = texture
    return texture
  }

  /**
   * Loads a glTF once per URL and hands out clones. Geometry and materials stay shared between
   * instances, so twenty copies of a prop cost one parse; SkeletonUtils does the cloning because a
   * plain Object3D.clone detaches a skinned mesh from its skeleton.
   */
  private ensureModel(url: string) {
    const existing = this.modelPromises.get(url)
    if (existing) return existing
    const loading = (async () => {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
      const gltf = await new GLTFLoader().loadAsync(url)
      if (this.disposed) return null
      this.models.set(url, gltf.scene)
      return gltf.scene
    })().catch(() => null)
    this.modelPromises.set(url, loading)
    return loading
  }

  private async instantiateModel(url: string) {
    const source = this.models.get(url) ?? await this.ensureModel(url)
    if (!source) return null
    const { clone } = await import('three/addons/utils/SkeletonUtils.js')
    const instance = clone(source)
    // Shared geometry and materials must survive a runtime teardown, so every cloned node is marked
    // for the disposer to step over.
    instance.traverse((node) => { node.userData.auroraModelClone = true })
    return instance
  }

  /** Keeps a model host pointed at its authored file, and applies the object's own render flags. */
  private syncModel(host: THREE.Object3D, definition: Aurora3DObject, assets: Map<string, MediaAsset>, environmentIntensity: number) {
    const asset = modelAssetFor(definition, assets)
    const url = asset?.hash ? mediaUrl(asset.hash) : undefined
    if (host.userData.auroraModelUrl !== url) {
      host.userData.auroraModelUrl = url
      host.children.filter((child) => child.userData.auroraModelClone).forEach((child) => child.removeFromParent())
      if (url) {
        void this.instantiateModel(url).then((instance) => {
          if (!instance || host.userData.auroraModelUrl !== url) return
          host.add(instance)
          this.onInvalidate?.()
        })
      }
    }
    host.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.castShadow = definition.castShadow
      node.receiveShadow = definition.receiveShadow
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) material.envMapIntensity = environmentIntensity
      })
    })
  }

  /** Applies the authored environment map, falling back to a neutral world probe without one. */
  private syncEnvironment(runtime: Scene3DRuntime, definition: Aurora3DScene, assets: Map<string, MediaAsset>) {
    const scene = runtime.scene
    const color = definition.settings.backgroundColor ? new THREE.Color(definition.settings.backgroundColor) : null
    const asset = environmentAssetFor(definition, assets)
    const decoder = asset ? environmentDecoderFor(asset.name) : null
    const url = asset?.hash && decoder ? mediaUrl(asset.hash) : undefined
    scene.environmentIntensity = definition.environmentIntensity
    scene.backgroundIntensity = definition.environmentIntensity
    if (!url || !decoder) {
      // A background colour is a backdrop, not a light, so it cannot be the fallback. Zero
      // intensity is the one case that means no environment light at all.
      scene.environment = definition.environmentIntensity > 0 ? this.neutralWorldProbe() : null
      scene.background = color
      delete scene.userData.auroraEnvironmentUrl
      return
    }
    const ready = this.environments.get(url) ?? null
    scene.environment = ready
    scene.background = definition.environmentBackground && ready ? ready : color
    if (scene.userData.auroraEnvironmentUrl === url) return
    scene.userData.auroraEnvironmentUrl = url
    if (ready) return
    void this.ensureEnvironment(url, decoder).then((texture) => {
      if (!texture || scene.userData.auroraEnvironmentUrl !== url) return
      this.onInvalidate?.()
    })
  }

  private syncImageMap(material: THREE.MeshStandardMaterial, definition: Aurora3DObject, assets: Map<string, MediaAsset>) {
    const url = definition.primitive === 'plane' ? imageUrl(imageAssetFor(definition, assets)) : undefined
    const nextSide = definition.primitive === 'plane' ? THREE.DoubleSide : THREE.FrontSide
    const imagePlane = Boolean(url)
    const renderStateChanged = material.side !== nextSide
      || material.depthWrite === imagePlane
      || material.alphaTest !== (imagePlane ? .001 : 0)
      || material.polygonOffset !== imagePlane
    material.side = nextSide
    material.depthWrite = !imagePlane
    material.alphaTest = imagePlane ? .001 : 0
    // Prevent a card mounted directly on a wall from losing patches to z-fighting at grazing angles.
    material.polygonOffset = imagePlane
    material.polygonOffsetFactor = imagePlane ? -1 : 0
    material.polygonOffsetUnits = imagePlane ? -2 : 0
    if (renderStateChanged) material.needsUpdate = true
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
    // Alpha blending preserves soft edges; skipping depth writes stops invisible texels occluding
    // geometry behind the card. alphaTest discards fully transparent pixels in shadow/depth passes.
    material.needsUpdate = true
    if (!url || material.map) return
    void this.ensureTexture(url).then((texture) => {
      if (!texture || material.userData.auroraImageUrl !== url) return
      material.map = texture
      material.needsUpdate = true
      this.onInvalidate?.()
    })
  }

  private create(definition: Aurora3DScene, aspect: number, assets: Map<string, MediaAsset>, structureKey: string): Scene3DRuntime {
    const scene = new THREE.Scene()
    const root = new THREE.Group()
    root.name = definition.name
    scene.add(root)
    const runtime: Scene3DRuntime = {
      sceneId: definition.id,
      revision: definition.revision,
      structureKey,
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
      if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) root.add(light.target)
    })
    return runtime
  }

  private update(runtime: Scene3DRuntime, definition: Aurora3DScene, aspect: number, time: number, assets: Map<string, MediaAsset>, rigs: Map<string, AuroraRig> = new Map()) {
    runtime.revision = definition.revision
    this.syncEnvironment(runtime, definition, assets)
    definition.objects.forEach((item) => {
      const object = runtime.objects.get(item.id)
      if (!object) return
      object.visible = item.visible
      applyTransform(object, item.transform, time)
      if (item.primitive === 'model') this.syncModel(object, item, assets, definition.environmentIntensity)
      if (object instanceof THREE.Mesh) syncGeometry(object, item, item.rigId ? rigs.get(item.rigId) : undefined, assets, time)
      if (object instanceof THREE.Mesh) {
        object.castShadow = item.castShadow
        object.receiveShadow = item.receiveShadow
      }
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
        this.syncImageMap(object.material, item, assets)
        object.material.color.set(item.material.baseColor)
        object.material.emissive.set(item.material.emissive)
        object.material.opacity = evaluateNumericProperty(item.material.opacity, time)
        object.material.metalness = evaluateNumericProperty(item.material.metalness, time)
        object.material.roughness = evaluateNumericProperty(item.material.roughness, time)
        object.material.emissiveIntensity = evaluateNumericProperty(item.material.emissiveIntensity, time)
        object.material.envMapIntensity = definition.environmentIntensity
      }
    })
    syncGroupArrays(runtime, definition, time)
    runtime.root.updateMatrixWorld(true)
    const sceneBounds = new THREE.Box3().setFromObject(runtime.root)
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
      const environmentScale = light instanceof THREE.AmbientLight ? definition.environmentIntensity : 1
      light.intensity = evaluateNumericProperty(item.intensity, time) * environmentScale
      applyTransform(light, item.transform, time)
      if ('castShadow' in light) light.castShadow = item.castShadow
      if (light instanceof THREE.SpotLight) {
        light.angle = THREE.MathUtils.degToRad(item.angle ? evaluateNumericProperty(item.angle, time) : 32)
        light.distance = item.distance ? evaluateNumericProperty(item.distance, time) : 0
        light.penumbra = item.penumbra ? evaluateNumericProperty(item.penumbra, time) : .25
      }
      if (item.castShadow) configureShadow(light, definition, sceneBounds)
      if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
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
    this.environments.forEach((texture) => texture.dispose())
    this.environments.clear()
    this.environmentPromises.clear()
    this.neutralWorld?.dispose()
    this.neutralWorld = null
    this.models.forEach((model) => model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      node.geometry.dispose()
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((material) => material.dispose())
    }))
    this.models.clear()
    this.modelPromises.clear()
  }

  private disposeRuntime(runtime: Scene3DRuntime) {
    runtime.scene.traverse((object) => {
      let candidate: THREE.Object3D | null = object
      while (candidate) {
        if (candidate.userData.editorOnly) return
        candidate = candidate.parent
      }
      if (!(object instanceof THREE.Mesh)) return
      if (object.userData.auroraGroupArrayClone) return
      if (object.userData.auroraModelClone) return
      const base = object.userData.baseGeometry as THREE.BufferGeometry | undefined
      if (base && base !== object.geometry) base.dispose()
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => material.dispose())
    })
    runtime.scene.clear()
  }
}
