import * as THREE from 'three'
import type { Scene3DSettings } from '@/models/editor'
import type { AuroraSolidViewport } from './AuroraSolidViewport'

/**
 * The non-photoreal viewport shading modes that sit beside Solid and Rendered: Wireframe, Matcap, and
 * X-ray, plus a wireframe overlay that can ride on top of any of them.
 *
 * Each pass follows the same contract as {@link AuroraSolidViewport}: it swaps materials (and, where a
 * mode is unlit, hides the scene lights) and returns a strict restoration callback. Nothing here ever
 * mutates the scene definition, so the authored look and the final render are untouched.
 */
export type ViewportShadingMode = 'rendered' | 'solid' | 'wireframe' | 'matcap' | 'xray'

interface MaterialSwap {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
}

/** A neutral studio matcap, generated once: a lit clay sphere baked into a texture. */
function createClayMatcap(): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  context.fillStyle = '#0d0f14'
  context.fillRect(0, 0, size, size)
  // Key highlight up and to the left, a cooler fill opposite, and a dark terminator at the rim.
  const key = context.createRadialGradient(size * .36, size * .32, size * .04, size * .5, size * .5, size * .52)
  key.addColorStop(0, '#f4f1ea')
  key.addColorStop(.35, '#c3c6cf')
  key.addColorStop(.7, '#7f8593')
  key.addColorStop(1, '#2b303b')
  context.fillStyle = key
  context.beginPath()
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  context.fill()
  const fill = context.createRadialGradient(size * .72, size * .74, size * .02, size * .68, size * .68, size * .4)
  fill.addColorStop(0, 'rgba(120,150,220,.5)')
  fill.addColorStop(1, 'rgba(120,150,220,0)')
  context.globalCompositeOperation = 'lighter'
  context.fillStyle = fill
  context.beginPath()
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  context.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class AuroraViewportModes {
  private readonly wireframeMaterials = new Map<THREE.Material, THREE.MeshBasicMaterial>()
  private readonly matcapMaterials = new Map<THREE.Material, THREE.MeshMatcapMaterial>()
  private readonly xrayMaterials = new Map<THREE.Material, THREE.MeshBasicMaterial>()
  private readonly overlayMaterials = new Map<THREE.Mesh, THREE.LineSegments>()
  private matcap: THREE.Texture | null = null
  private readonly neutral = new THREE.Color('#c2c7d2')
  private readonly wireColor = new THREE.Color('#9fb0e6')
  private readonly xrayColor = new THREE.Color('#8fb4ff')
  private readonly background = new THREE.Color('#1a1d25')

  /** Applies one shading pass and returns its restoration callback. */
  apply(mode: Exclude<ViewportShadingMode, 'rendered' | 'solid'>, scene: THREE.Scene, root: THREE.Object3D) {
    const swaps: MaterialSwap[] = []
    const used = new Set<THREE.Material>()
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const original = object.material
      const sources = Array.isArray(original) ? original : [original]
      const replacements = sources.map((source) => {
        used.add(source)
        return this.materialFor(mode, source)
      })
      swaps.push({ mesh: object, original })
      object.material = Array.isArray(original) ? replacements : replacements[0]!
    })
    this.prune(mode, used)

    // Wireframe and matcap are unlit — the value comes from the material, not the scene — so the
    // authored lights are muted for the pass. X-ray keeps them off too; its look is purely additive.
    const hiddenLights: THREE.Light[] = []
    scene.traverse((object) => {
      if (object instanceof THREE.Light && object.visible) {
        object.visible = false
        hiddenLights.push(object)
      }
    })

    const originalBackground = scene.background
    scene.background = this.background
    return () => {
      swaps.forEach(({ mesh, original }) => { mesh.material = original })
      hiddenLights.forEach((light) => { light.visible = true })
      scene.background = originalBackground
    }
  }

  /** Adds a wireframe overlay on top of whatever pass is active; the callback removes it. */
  applyWireOverlay(root: THREE.Object3D) {
    const added: THREE.LineSegments[] = []
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return
      let overlay = this.overlayMaterials.get(object)
      if (!overlay) {
        const material = new THREE.LineBasicMaterial({ color: '#0c0e13', transparent: true, opacity: .32, depthTest: true })
        overlay = new THREE.LineSegments(new THREE.WireframeGeometry(object.geometry), material)
        overlay.userData.editorOnly = true
        overlay.userData.sourceGeometry = object.geometry.uuid
        this.overlayMaterials.set(object, overlay)
      } else if (overlay.userData.sourceGeometry !== object.geometry.uuid) {
        // The source geometry only changes when influences or deformation rebuild it, so the costly
        // wireframe extraction runs then and not on every frame.
        overlay.geometry.dispose()
        overlay.geometry = new THREE.WireframeGeometry(object.geometry)
        overlay.userData.sourceGeometry = object.geometry.uuid
      }
      object.add(overlay)
      added.push(overlay)
    })
    return () => added.forEach((overlay) => overlay.removeFromParent())
  }

  private materialFor(mode: Exclude<ViewportShadingMode, 'rendered' | 'solid'>, source: THREE.Material) {
    if (mode === 'wireframe') return this.wireframeFor(source)
    if (mode === 'matcap') return this.matcapFor(source)
    return this.xrayFor(source)
  }

  private wireframeFor(source: THREE.Material) {
    let material = this.wireframeMaterials.get(source)
    if (!material) {
      material = new THREE.MeshBasicMaterial({ wireframe: true, toneMapped: false })
      material.color.copy(this.wireColor)
      this.wireframeMaterials.set(source, material)
    }
    material.side = source.side
    material.visible = source.visible
    return material
  }

  private matcapFor(source: THREE.Material) {
    if (!this.matcap) this.matcap = createClayMatcap()
    let material = this.matcapMaterials.get(source)
    if (!material) {
      material = new THREE.MeshMatcapMaterial({ matcap: this.matcap })
      this.matcapMaterials.set(source, material)
    }
    const display = source as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null }
    material.color.copy(display.color ?? this.neutral).lerp(this.neutral, .35)
    const nextMap = display.map ?? null
    if (material.map !== nextMap || material.side !== source.side) {
      material.map = nextMap
      material.side = source.side
      material.needsUpdate = true
    }
    material.visible = source.visible
    return material
  }

  private xrayFor(source: THREE.Material) {
    let material = this.xrayMaterials.get(source)
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: .16,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      material.color.copy(this.xrayColor)
      this.xrayMaterials.set(source, material)
    }
    material.visible = source.visible
    return material
  }

  private prune(mode: Exclude<ViewportShadingMode, 'rendered' | 'solid'>, used: Set<THREE.Material>) {
    const bank = mode === 'wireframe' ? this.wireframeMaterials : mode === 'matcap' ? this.matcapMaterials : this.xrayMaterials
    bank.forEach((material, source) => {
      if (used.has(source)) return
      material.dispose()
      bank.delete(source)
    })
  }

  dispose() {
    this.wireframeMaterials.forEach((material) => material.dispose())
    this.matcapMaterials.forEach((material) => material.dispose())
    this.xrayMaterials.forEach((material) => material.dispose())
    this.overlayMaterials.forEach((overlay) => {
      overlay.removeFromParent()
      overlay.geometry.dispose()
      ;(overlay.material as THREE.Material).dispose()
    })
    this.wireframeMaterials.clear()
    this.matcapMaterials.clear()
    this.xrayMaterials.clear()
    this.overlayMaterials.clear()
    this.matcap?.dispose()
    this.matcap = null
  }
}

export interface ShadingPassResult {
  /** Render settings to feed the pipeline for this mode. */
  settings: Scene3DSettings
  /** Undo every material/light swap this pass made. Always call it in a `finally`. */
  restore: () => void
  /** Whether the renderer's shadow map should be on for this mode. */
  shadowsEnabled: boolean
}

/**
 * Applies the active viewport shading mode to a scene and returns the render settings plus a strict
 * restore. Shared by the 3D workspace and the camera preview so both honour the same mode selection.
 */
export function beginViewportShadingPass(params: {
  mode: ViewportShadingMode
  wireOverlay: boolean
  scene: THREE.Scene
  root: THREE.Object3D
  camera: THREE.Camera
  baseSettings: Scene3DSettings
  solidViewport: AuroraSolidViewport
  viewportModes: AuroraViewportModes
}): ShadingPassResult {
  const { mode, wireOverlay, scene, root, camera, baseSettings, solidViewport, viewportModes } = params
  let restoreMaterials: (() => void) | null = null
  let settings = baseSettings
  if (mode === 'solid') {
    restoreMaterials = solidViewport.apply(scene, root, camera)
    settings = { ...baseSettings, shadows: false, ambientOcclusion: true, ambientOcclusionIntensity: .8, ambientOcclusionRadius: .22, quality: 'preview' }
  } else if (mode !== 'rendered') {
    restoreMaterials = viewportModes.apply(mode, scene, root)
    // Unlit modes get no shadows or AO — both read scene lighting or depth these passes do not honour.
    settings = { ...baseSettings, shadows: false, ambientOcclusion: false, quality: 'preview' }
  }
  const removeWireOverlay = wireOverlay ? viewportModes.applyWireOverlay(root) : null
  return {
    settings,
    restore: () => { removeWireOverlay?.(); restoreMaterials?.() },
    shadowsEnabled: mode === 'rendered' && baseSettings.shadows,
  }
}
