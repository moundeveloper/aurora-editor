import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import type { Scene3DSettings } from '@/models/editor'

export type AuroraScenePipelineOutput = 'screen' | 'texture'

interface PipelineState {
  composer: EffectComposer
  renderPass: RenderPass
  gtaoPass: GTAOPass
  outputPass: OutputPass
  perspective: boolean
}

/**
 * One persistent post-process chain per render surface. Beauty, shadows, and GTAO share the same
 * scene/camera and render targets; only dimensions or camera projection rebuild GPU resources.
 */
export class AuroraSceneRenderPipeline {
  private state: PipelineState | null = null
  private width = 0
  private height = 0
  private sampleCount = 0

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: Scene3DSettings,
    width: number,
    height: number,
    output: AuroraScenePipelineOutput,
  ): THREE.Texture | null {
    const state = this.ensureState(scene, camera, width, height)
    state.renderPass.scene = scene
    state.renderPass.camera = camera
    state.gtaoPass.scene = scene
    state.gtaoPass.camera = camera
    // Intermediate passes stay linear. Texture output is tagged only after the final OutputPass so
    // the hybrid compositor decodes it exactly once on the way back to the sRGB drawing buffer.
    state.composer.renderTarget1.texture.colorSpace = THREE.NoColorSpace
    state.composer.renderTarget2.texture.colorSpace = THREE.NoColorSpace

    const aoEnabled = settings.ambientOcclusion && settings.quality !== 'draft'
    state.gtaoPass.enabled = aoEnabled
    if (aoEnabled) {
      const samples = settings.quality === 'full' ? 16 : 8
      if (samples !== this.sampleCount) {
        state.gtaoPass.updateGtaoMaterial({ samples })
        state.gtaoPass.updatePdMaterial({ samples, rings: settings.quality === 'full' ? 3 : 2 })
        this.sampleCount = samples
      }
      state.gtaoPass.blendIntensity = settings.ambientOcclusionIntensity
      state.gtaoPass.updateGtaoMaterial({
        radius: settings.ambientOcclusionRadius,
        thickness: Math.max(.1, settings.ambientOcclusionRadius * 2.5),
      })
    }

    state.composer.renderToScreen = output === 'screen'
    state.composer.render()
    if (output !== 'texture') return null
    state.composer.readBuffer.texture.colorSpace = THREE.SRGBColorSpace
    return state.composer.readBuffer.texture
  }

  private ensureState(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    const perspective = camera instanceof THREE.PerspectiveCamera
    if (!this.state || this.state.perspective !== perspective) {
      this.dispose()
      const composer = new EffectComposer(this.renderer)
      composer.renderToScreen = false
      const renderPass = new RenderPass(scene, camera)
      renderPass.clear = true
      const gtaoPass = new GTAOPass(scene, camera, width, height)
      const outputPass = new OutputPass()
      composer.addPass(renderPass)
      composer.addPass(gtaoPass)
      composer.addPass(outputPass)
      this.state = { composer, renderPass, gtaoPass, outputPass, perspective }
      this.width = 0
      this.height = 0
      this.sampleCount = 0
    }
    if (width !== this.width || height !== this.height) {
      this.state.composer.setSize(width, height)
      this.width = width
      this.height = height
    }
    return this.state
  }

  dispose() {
    if (!this.state) return
    this.state.gtaoPass.dispose()
    this.state.outputPass.dispose()
    this.state.composer.dispose()
    this.state = null
    this.width = 0
    this.height = 0
    this.sampleCount = 0
  }
}
