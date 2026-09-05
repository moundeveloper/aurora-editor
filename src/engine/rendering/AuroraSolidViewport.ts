import * as THREE from 'three'

interface MaterialSwap {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
}

/**
 * A compact Workbench-style viewport pass: scene lights and shader-node-like PBR response are
 * replaced by a stable camera-relative studio rig, rough material colors, and screen-space cavity.
 * Nothing here changes the scene definition or the final render.
 */
export class AuroraSolidViewport {
  private readonly materials = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  private readonly neutral = new THREE.Color('#aeb4c0')
  private readonly background = new THREE.Color('#272b35')
  private readonly studio = new THREE.Group()

  constructor() {
    this.studio.name = 'Aurora Solid Studio'
    this.studio.userData.editorOnly = true

    // A low constant fill keeps every face readable; the directional trio supplies the normal-
    // based value changes that make form legible without consulting any authored scene light.
    const sky = new THREE.AmbientLight('#657086', .72)
    const key = this.directional('#fff4df', 2.75, [-3.5, 4.5, 4], [0, 0, -3])
    const fill = this.directional('#9dbbff', 1.15, [4, 1.5, 2], [0, 0, -3])
    const rim = this.directional('#d7e4ff', .72, [1, 3, -5], [0, 0, -1])
    this.studio.add(sky, key.light, key.target, fill.light, fill.target, rim.light, rim.target)
  }

  /** Applies the temporary studio pass and returns a strict restoration callback. */
  apply(scene: THREE.Scene, root: THREE.Object3D, camera: THREE.Camera) {
    const swaps: MaterialSwap[] = []
    const used = new Set<THREE.Material>()
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const original = object.material
      const sources = Array.isArray(original) ? original : [original]
      const replacements = sources.map((source) => {
        used.add(source)
        return this.materialFor(source)
      })
      swaps.push({ mesh: object, original })
      object.material = Array.isArray(original) ? replacements : replacements[0]!
    })
    this.pruneMaterials(used)

    const hiddenLights: THREE.Light[] = []
    scene.traverse((object) => {
      if (object instanceof THREE.Light && !object.userData.auroraSolidStudio && object.visible) {
        object.visible = false
        hiddenLights.push(object)
      }
    })
    this.studio.traverse((object) => { object.userData.auroraSolidStudio = true })
    this.studio.position.copy(camera.getWorldPosition(new THREE.Vector3()))
    this.studio.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()))
    scene.add(this.studio)
    this.studio.updateMatrixWorld(true)

    const originalBackground = scene.background
    scene.background = this.background
    return () => {
      swaps.forEach(({ mesh, original }) => { mesh.material = original })
      hiddenLights.forEach((light) => { light.visible = true })
      scene.background = originalBackground
      this.studio.removeFromParent()
    }
  }

  private directional(color: THREE.ColorRepresentation, intensity: number, position: [number, number, number], targetPosition: [number, number, number]) {
    const light = new THREE.DirectionalLight(color, intensity)
    const target = light.target
    light.position.set(...position)
    target.position.set(...targetPosition)
    light.castShadow = false
    light.userData.auroraSolidStudio = true
    target.userData.auroraSolidStudio = true
    return { light, target }
  }

  private materialFor(source: THREE.Material) {
    let material = this.materials.get(source)
    if (!material) {
      material = new THREE.MeshStandardMaterial()
      material.name = `Solid · ${source.name || source.uuid}`
      material.toneMapped = true
      this.materials.set(source, material)
    }
    const display = source as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null }
    material.color.copy(display.color ?? this.neutral).lerp(this.neutral, .12)
    const nextMap = display.map ?? null
    const nextTransparent = Boolean(nextMap && source.transparent)
    const shaderStateChanged = material.map !== nextMap
      || material.side !== source.side
      || material.alphaTest !== source.alphaTest
      || material.transparent !== nextTransparent
    material.map = nextMap
    material.side = source.side
    material.alphaTest = source.alphaTest
    material.transparent = nextTransparent
    material.opacity = 1
    material.depthTest = source.depthTest
    material.depthWrite = source.depthWrite
    material.visible = source.visible
    material.metalness = .04
    material.roughness = .68
    material.emissive.set(0x000000)
    material.emissiveIntensity = 0
    if (shaderStateChanged) material.needsUpdate = true
    return material
  }

  private pruneMaterials(used: Set<THREE.Material>) {
    this.materials.forEach((material, source) => {
      if (used.has(source)) return
      material.dispose()
      this.materials.delete(source)
    })
  }

  dispose() {
    this.studio.removeFromParent()
    this.materials.forEach((material) => material.dispose())
    this.materials.clear()
  }
}
