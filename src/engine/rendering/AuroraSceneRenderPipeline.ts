import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import type { Scene3DSettings } from '@/models/editor'
import type { CameraLens } from '@/engine/scene3d/cameraLens'
import { configureSceneColor } from './colorManagement'
import { SceneWorkingSpace, sceneWorkingSpace, workingToDisplayMatrix } from './sceneWorkingSpace'

export type AuroraScenePipelineOutput = 'screen' | 'texture'

interface PipelineState {
  composer: EffectComposer
  renderPass: RenderPass
  gtaoPass: GTAOPass
  bokehPass: BokehPass
  outputPass: OutputPass
  perspective: boolean
}

export interface AuroraMotionBlurSample {
  scene: THREE.Scene
  camera: THREE.Camera
  lens: CameraLens | null
}

/**
 * One persistent post-process chain per render surface. Beauty, shadows, and GTAO share the same
 * scene/camera and render targets; only dimensions or camera projection rebuild GPU resources.
 */
export class AuroraSceneRenderPipeline {
  private readonly workingSpace = new SceneWorkingSpace()
  private state: PipelineState | null = null
  private width = 0
  private height = 0
  private sampleCount = 0
  private accumulationTarget: THREE.WebGLRenderTarget | null = null
  private readonly accumulationScene = new THREE.Scene()
  private readonly accumulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly accumulationMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sampleTexture: { value: null as THREE.Texture | null },
      sampleWeight: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D sampleTexture;
      uniform float sampleWeight;
      varying vec2 vUv;
      // Three prepends <colorspace_pars_fragment> to every material, so including it here again
      // redefines sRGBTransferEOTF and the shader fails to compile.
      void main() {
        gl_FragColor = sRGBTransferEOTF(texture2D(sampleTexture, vUv)) * sampleWeight;
      }
    `,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  private readonly accumulationQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.accumulationMaterial)

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.accumulationScene.add(this.accumulationQuad)
  }

  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: Scene3DSettings,
    width: number,
    height: number,
    output: AuroraScenePipelineOutput,
    lens: CameraLens | null = null,
  ): THREE.Texture | null {
    configureSceneColor(this.renderer,settings)
    const state = this.ensureState(scene, camera, width, height)
    state.renderPass.scene = scene
    state.renderPass.camera = camera
    state.gtaoPass.scene = scene
    state.gtaoPass.camera = camera
    state.bokehPass.scene = scene
    state.bokehPass.camera = camera
    // Intermediate passes stay linear. Texture output is tagged only after the final OutputPass so
    // the hybrid compositor decodes it exactly once on the way back to the sRGB drawing buffer.
    const workingSpace = sceneWorkingSpace(settings)
    state.composer.renderTarget1.texture.colorSpace = workingSpace
    state.composer.renderTarget2.texture.colorSpace = workingSpace
    state.outputPass.uniforms.auroraWorkingToSRGB!.value.copy(workingToDisplayMatrix(workingSpace))

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

    // Bokeh reads the same depth the beauty pass wrote, so it belongs after ambient occlusion and
    // before the output transform. Without a lens it stands down entirely.
    state.bokehPass.enabled = Boolean(lens)
    if (lens) {
      const uniforms = state.bokehPass.uniforms as Partial<Record<'focus' | 'aperture' | 'maxblur', { value: number }>>
      if (uniforms.focus) uniforms.focus.value = lens.focus
      if (uniforms.aperture) uniforms.aperture.value = lens.aperture
      if (uniforms.maxblur) uniforms.maxblur.value = lens.maxBlur
    }

    state.composer.renderToScreen = output === 'screen'
    this.workingSpace.render(scene, settings, () => state.composer.render())
    if (output !== 'texture') return null
    state.composer.readBuffer.texture.colorSpace = THREE.SRGBColorSpace
    return state.composer.readBuffer.texture
  }

  /**
   * Renders and averages complete post-processed samples while each one still owns the composer's
   * transient output texture. The custom pass decodes sRGB before additive accumulation, leaving a
   * linear texture for the hybrid compositor to transform exactly once when it reaches the screen.
   */
  renderMotionBlur(
    sampleTimes: number[],
    prepareSample: (time: number) => AuroraMotionBlurSample | null,
    settings: Scene3DSettings,
    width: number,
    height: number,
  ): THREE.Texture | null {
    if (!sampleTimes.length) return null
    this.ensureAccumulationTarget(width, height)
    const target = this.accumulationTarget!
    const previousTarget = this.renderer.getRenderTarget()
    const previousClearColor = this.renderer.getClearColor(new THREE.Color())
    const previousClearAlpha = this.renderer.getClearAlpha()

    let rendered = 0
    try {
      this.renderer.setRenderTarget(target)
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.clear(true, false, false)
      this.accumulationMaterial.uniforms.sampleWeight!.value = 1 / sampleTimes.length

      sampleTimes.forEach((sampleTime) => {
        const sample = prepareSample(sampleTime)
        if (!sample) return
        const texture = this.render(sample.scene, sample.camera, settings, width, height, 'texture', sample.lens)
        if (!texture) return
        this.accumulationMaterial.uniforms.sampleTexture!.value = texture
        this.renderer.setRenderTarget(target)
        this.renderer.render(this.accumulationScene, this.accumulationCamera)
        rendered += 1
      })
    } finally {
      this.renderer.setRenderTarget(previousTarget)
      this.renderer.setClearColor(previousClearColor, previousClearAlpha)
    }

    if (!rendered) return null
    target.texture.colorSpace = THREE.NoColorSpace
    return target.texture
  }

  private ensureAccumulationTarget(width: number, height: number) {
    if (!this.accumulationTarget) {
      this.accumulationTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: false,
        stencilBuffer: false,
        type: THREE.HalfFloatType,
      })
      this.accumulationTarget.texture.name = 'Aurora.MotionBlurAccumulation'
      this.accumulationTarget.texture.colorSpace = THREE.NoColorSpace
      this.accumulationTarget.texture.minFilter = THREE.LinearFilter
      this.accumulationTarget.texture.magFilter = THREE.LinearFilter
      return
    }
    if (this.accumulationTarget.width !== width || this.accumulationTarget.height !== height) {
      this.accumulationTarget.setSize(width, height)
    }
  }

  private ensureState(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    const perspective = camera instanceof THREE.PerspectiveCamera
    if (!this.state || this.state.perspective !== perspective) {
      this.disposeComposer()
      const composer = new EffectComposer(this.renderer)
      composer.renderToScreen = false
      const renderPass = new RenderPass(scene, camera)
      renderPass.clear = true
      const gtaoPass = new GTAOPass(scene, camera, width, height)
      const bokehPass = new BokehPass(scene, camera, {})
      const outputPass = new OutputPass()
      outputPass.uniforms.auroraWorkingToSRGB = { value: new THREE.Matrix3() }
      outputPass.material.fragmentShader = outputPass.material.fragmentShader
        .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform mat3 auroraWorkingToSRGB;')
        .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv );\ngl_FragColor.rgb = auroraWorkingToSRGB * gl_FragColor.rgb;')
      composer.addPass(renderPass)
      composer.addPass(gtaoPass)
      composer.addPass(bokehPass)
      composer.addPass(outputPass)
      this.state = { composer, renderPass, gtaoPass, bokehPass, outputPass, perspective }
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
    this.workingSpace.dispose()
    this.disposeComposer()
    this.accumulationTarget?.dispose()
    this.accumulationTarget = null
    this.accumulationQuad.geometry.dispose()
    this.accumulationMaterial.dispose()
  }

  private disposeComposer() {
    if (!this.state) return
    this.state.gtaoPass.dispose()
    this.state.bokehPass.dispose()
    this.state.outputPass.dispose()
    this.state.composer.dispose()
    this.state = null
    this.width = 0
    this.height = 0
    this.sampleCount = 0
  }
}
