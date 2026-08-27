import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import type { Aurora3DObject, Aurora3DScene, AuroraCamera, AuroraLight, Transform3D } from '@/models/editor'

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

function makeGeometry(object: Aurora3DObject): THREE.BufferGeometry {
  if (object.primitive === 'sphere') return new THREE.SphereGeometry(1.15, 48, 32)
  if (object.primitive === 'plane') return new THREE.PlaneGeometry(2, 2)
  return new THREE.BoxGeometry(2, 2, 2, 2, 2, 2)
}

function makeObject(definition: Aurora3DObject): THREE.Object3D {
  if (definition.type !== 'mesh') return new THREE.Group()
  const material = new THREE.MeshStandardMaterial({
    color: definition.material.baseColor,
    emissive: definition.material.emissive,
    transparent: true,
  })
  const mesh = new THREE.Mesh(makeGeometry(definition), material)
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

export class ThreeSceneRuntimeRegistry {
  private runtimes = new Map<string, Scene3DRuntime>()

  get(sceneDefinition: Aurora3DScene, width: number, height: number, time: number): Scene3DRuntime {
    let runtime = this.runtimes.get(sceneDefinition.id)
    if (!runtime || runtime.revision !== sceneDefinition.revision) {
      if (runtime) this.disposeRuntime(runtime)
      runtime = this.create(sceneDefinition, width / Math.max(1, height))
      this.runtimes.set(sceneDefinition.id, runtime)
    }
    this.update(runtime, sceneDefinition, width / Math.max(1, height), time)
    return runtime
  }

  private create(definition: Aurora3DScene, aspect: number): Scene3DRuntime {
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
      const object = makeObject(item)
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

  private update(runtime: Scene3DRuntime, definition: Aurora3DScene, aspect: number, time: number) {
    runtime.revision = definition.revision
    runtime.scene.background = definition.settings.backgroundColor ? new THREE.Color(definition.settings.backgroundColor) : null
    definition.objects.forEach((item) => {
      const object = runtime.objects.get(item.id)
      if (!object) return
      object.visible = item.visible
      applyTransform(object, item.transform, time)
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
        object.material.color.set(item.material.baseColor)
        object.material.emissive.set(item.material.emissive)
        object.material.opacity = evaluateNumericProperty(item.material.opacity, time)
        object.material.metalness = evaluateNumericProperty(item.material.metalness, time)
        object.material.roughness = evaluateNumericProperty(item.material.roughness, time)
        object.material.emissiveIntensity = evaluateNumericProperty(item.material.emissiveIntensity, time)
        object.material.needsUpdate = true
      }
    })
    definition.cameras.forEach((item) => {
      const camera = runtime.cameras.get(item.id)
      if (!camera) return
      applyTransform(camera, item.transform, time)
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
    this.runtimes.forEach((runtime) => this.disposeRuntime(runtime))
    this.runtimes.clear()
  }

  private disposeRuntime(runtime: Scene3DRuntime) {
    runtime.scene.traverse((object) => {
      let candidate: THREE.Object3D | null = object
      while (candidate) {
        if (candidate.userData.editorOnly) return
        candidate = candidate.parent
      }
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        Object.values(material).forEach((value) => {
          if (value instanceof THREE.Texture) value.dispose()
        })
        material.dispose()
      })
    })
    runtime.scene.clear()
  }
}
