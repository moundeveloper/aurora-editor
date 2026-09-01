import * as THREE from 'three'

interface MaterialSwap {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
}

/**
 * Blender-style Solid viewport materials. They ignore scene lighting, shadows, and emission while
 * retaining texture alpha, object hue, and depth, so dark or badly lit entities remain editable.
 */
export class AuroraSolidViewport {
  private readonly materials = new Map<THREE.Material, THREE.MeshBasicMaterial>()
  private readonly liftColor = new THREE.Color('#b8c1d8')

  apply(root: THREE.Object3D) {
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
    this.materials.forEach((material, source) => {
      if (used.has(source)) return
      material.dispose()
      this.materials.delete(source)
    })
    return () => swaps.forEach(({ mesh, original }) => { mesh.material = original })
  }

  private materialFor(source: THREE.Material) {
    let material = this.materials.get(source)
    if (!material) {
      material = new THREE.MeshBasicMaterial()
      material.name = `Solid · ${source.name || source.uuid}`
      material.toneMapped = false
      this.materials.set(source, material)
    }
    const sourceWithColor = source as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null }
    material.color.copy(sourceWithColor.color ?? new THREE.Color('#7d879d')).lerp(this.liftColor, .32)
    const nextMap = sourceWithColor.map ?? null
    const shaderStateChanged = material.map !== nextMap
      || material.side !== source.side
      || material.alphaTest !== source.alphaTest
      || material.transparent !== source.transparent
    material.map = nextMap
    material.side = source.side
    // Solid mode is an authoring aid: material opacity cannot make an otherwise visible entity vanish.
    material.opacity = 1
    material.transparent = source.transparent
    material.alphaTest = source.alphaTest
    material.depthTest = source.depthTest
    material.depthWrite = source.depthWrite
    material.visible = source.visible
    if (shaderStateChanged) material.needsUpdate = true
    return material
  }

  dispose() {
    this.materials.forEach((material) => material.dispose())
    this.materials.clear()
  }
}
