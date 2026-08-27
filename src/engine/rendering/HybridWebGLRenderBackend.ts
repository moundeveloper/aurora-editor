import { BlurFilter, ColorMatrixFilter, Container, FillGradient, Graphics, Sprite, Text, Texture, WebGLRenderer } from 'pixi.js'
import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import type { GraphEffects, NodeBlendMode } from '@/engine/nodes/evaluateGraph'
import {
  createRenderPlan, HYBRID_ALPHA_CONTRACT, resolveRenderSize,
  type RenderBackend, type RenderFrameRequest, type RendererInitializationOptions, type RenderSurface,
} from '@/engine/rendering/contracts'
import type { EditorLayer } from '@/models/editor'
import { cameraIdAtTime } from '@/engine/scene3d/cameraCuts'

/** Colour nodes fold into one matrix so a chain of them still costs a single filter pass. */
function colorFilterFor(effects: GraphEffects) {
  const neutral = !effects.invert && !effects.brightness && !effects.contrast && !effects.temperature
    && !effects.hue && effects.saturation === 1 && !effects.greyscale
  if (neutral) return null
  const filter = new ColorMatrixFilter()
  if (effects.brightness) filter.brightness(1 + effects.brightness / 100, true)
  if (effects.contrast) filter.contrast(effects.contrast / 100, true)
  if (effects.temperature) {
    // Warm pushes red and pulls blue; cool does the reverse.
    const shift = effects.temperature / 100
    filter.matrix = [
      1 + shift * .25, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1 - shift * .25, 0, 0,
      0, 0, 0, 1, 0,
    ]
  }
  if (effects.hue) filter.hue(effects.hue, true)
  if (effects.saturation !== 1) filter.saturate(effects.saturation - 1, true)
  if (effects.greyscale >= .5) filter.desaturate()
  if (effects.invert >= .5) filter.negative(true)
  return filter
}

/**
 * A vignette needs a mask, and the renderer has no intermediate targets to build one in, so it is
 * drawn as a radial gradient multiplied over the pass itself.
 */
function vignetteOverlay(effects: GraphEffects, width: number, height: number) {
  if (effects.vignetteAmount <= 0) return null
  // Softness describes the width of the feather: 100% starts the fade near the centre, while 0%
  // keeps the image untouched until the edge. The overlay lives in frame space, never layer space.
  const inner = Math.max(.02, Math.min(.98, 1 - effects.vignetteSoftness / 100))
  const gradient = new FillGradient({
    type: 'radial',
    center: { x: .5, y: .5 },
    innerRadius: 0,
    outerCenter: { x: .5, y: .5 },
    outerRadius: .5,
    colorStops: [
      { offset: 0, color: '#ffffff' },
      { offset: inner, color: '#ffffff' },
      { offset: 1, color: '#000000' },
    ],
    textureSpace: 'local',
  })
  const overlay = new Graphics()
  overlay.rect(0, 0, width, height).fill(gradient)
  overlay.blendMode = 'multiply'
  overlay.alpha = Math.max(0, Math.min(1, effects.vignetteAmount / 100))
  return overlay
}

export interface HybridRendererStats {
  backend: 'WebGL2'
  pixiPasses: number
  threePasses: number
  threeDrawCalls: number
  triangles: number
  width: number
  height: number
}

export class HybridWebGLRenderBackend implements RenderBackend {
  private threeRenderer: THREE.WebGLRenderer | null = null
  private pixiRenderer: WebGLRenderer | null = null
  private readonly runtimeRegistry = new ThreeSceneRuntimeRegistry()
  private sourceImage: HTMLImageElement | null = null
  private sourceTexture: Texture | null = null
  private pixelRatio = 1
  private initialized = false
  private initialization: Promise<void> | null = null
  private contextLost = false
  private lastStats: HybridRendererStats = {
    backend: 'WebGL2', pixiPasses: 0, threePasses: 0, threeDrawCalls: 0, triangles: 0, width: 1, height: 1,
  }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly sourceUrl: string) {}

  /**
   * Setup is asynchronous, so a render requested while it is still running would otherwise start a
   * second one and build a rival pair of renderers on the same canvas — a shared GL context with
   * conflicting state, which draws nothing. Concurrent callers share the in-flight attempt instead.
   */
  async initialize(options: RendererInitializationOptions) {
    if (this.initialized) return
    this.initialization ??= this.createResources(options).catch((error: unknown) => {
      this.initialization = null
      throw error
    })
    return this.initialization
  }

  protected async createResources(options: RendererInitializationOptions) {
    this.pixelRatio = options.pixelRatio
    this.threeRenderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: HYBRID_ALPHA_CONTRACT.alpha,
      premultipliedAlpha: HYBRID_ALPHA_CONTRACT.premultipliedAlpha,
      antialias: true,
      stencil: true,
      powerPreference: 'high-performance',
    })
    this.threeRenderer.autoClear = false
    this.threeRenderer.outputColorSpace = THREE.SRGBColorSpace
    this.threeRenderer.shadowMap.enabled = true
    this.threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.threeRenderer.setClearAlpha(HYBRID_ALPHA_CONTRACT.clearAlpha)

    this.pixiRenderer = new WebGLRenderer()
    await this.pixiRenderer.init({
      context: this.threeRenderer.getContext() as WebGL2RenderingContext,
      width: options.width,
      height: options.height,
      resolution: options.pixelRatio,
      autoDensity: false,
      antialias: true,
      backgroundAlpha: 0,
      clearBeforeRender: false,
    })
    this.sourceImage = new Image()
    this.sourceImage.decoding = 'async'
    this.sourceImage.src = this.sourceUrl
    try {
      await this.sourceImage.decode()
      this.sourceTexture = Texture.from(this.sourceImage)
    } catch {
      this.sourceImage = null
    }
    this.canvas.addEventListener('webglcontextlost', this.onContextLost)
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    this.resize(options.width, options.height, options.pixelRatio)
    this.initialized = true
  }

  resize(width: number, height: number, pixelRatio: number) {
    if (!this.threeRenderer || !this.pixiRenderer) return
    this.pixelRatio = pixelRatio
    this.threeRenderer.setPixelRatio(pixelRatio)
    this.threeRenderer.setSize(width, height, false)
    this.pixiRenderer.resolution = pixelRatio
    this.pixiRenderer.resize(width, height)
    this.lastStats.width = width
    this.lastStats.height = height
  }

  async renderFrame(request: RenderFrameRequest): Promise<RenderSurface> {
    if (!this.initialized) await this.initialize({ width: request.width, height: request.height, pixelRatio: this.pixelRatio })
    if (!this.threeRenderer || !this.pixiRenderer || this.contextLost) return this.surface(request.width, request.height)
    const size = resolveRenderSize(request.width, request.height, request.quality)
    if (this.lastStats.width !== size.width || this.lastStats.height !== size.height) this.resize(size.width, size.height, this.pixelRatio)
    const plan = createRenderPlan({ ...request, width: size.width, height: size.height })
    const layerMap = new Map(request.layers.map((layer) => [layer.id, layer]))
    const sceneMap = new Map(request.scenes3D.map((scene) => [scene.id, scene]))

    this.threeRenderer.resetState()
    this.threeRenderer.setRenderTarget(null)
    this.threeRenderer.setScissorTest(false)
    this.threeRenderer.setClearColor(request.project.backgroundColor, HYBRID_ALPHA_CONTRACT.clearAlpha)
    this.threeRenderer.clear(true, true, true)

    let pixiPasses = 0
    let threePasses = 0
    plan.passes.forEach((pass) => {
      const layer = layerMap.get(pass.layerId)
      if (!layer) return
      if (pass.backend === 'three-webgl') {
        const scene = pass.sceneId ? sceneMap.get(pass.sceneId) : undefined
        if (!scene) return
        this.renderThreeLayer(layer, scene, request.time, size.width, size.height, pass.effects)
        threePasses += 1
      } else {
        this.renderPixiLayer(layer, request.time, size.width, size.height, request.project.width, request.project.height, pass.effects, pass.blendMode)
        pixiPasses += 1
      }
    })

    this.lastStats = {
      backend: 'WebGL2',
      pixiPasses,
      threePasses,
      threeDrawCalls: this.threeRenderer.info.render.calls,
      triangles: this.threeRenderer.info.render.triangles,
      width: size.width,
      height: size.height,
    }
    return this.surface(size.width, size.height)
  }

  getStats(): HybridRendererStats {
    return { ...this.lastStats }
  }

  private renderPixiLayer(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number, effects: GraphEffects, blendMode: NodeBlendMode) {
    if (!this.pixiRenderer || !this.threeRenderer) return
    const container = this.createPixiLayer(layer, time, width, height, projectWidth, projectHeight)
    if (!container) return
    // Node effects sit on top of the layer's own transform, so the graph shifts what the layer draws.
    const scaleFactor = width / projectWidth
    container.position.set(
      container.position.x + effects.offsetX * scaleFactor,
      container.position.y + effects.offsetY * scaleFactor,
    )
    container.rotation += THREE.MathUtils.degToRad(effects.rotation)
    container.scale.set(container.scale.x * effects.scale, container.scale.y * effects.scale)
    container.alpha *= effects.opacity
    container.blendMode = blendMode
    const filters = []
    if (effects.blur > 0) filters.push(new BlurFilter({ strength: effects.blur * scaleFactor, quality: 4 }))
    const colorMatrix = colorFilterFor(effects)
    if (colorMatrix) filters.push(colorMatrix)
    if (filters.length) container.filters = filters
    const stage = new Container()
    stage.addChild(container)
    const vignette = vignetteOverlay(effects, width, height)
    if (vignette) stage.addChild(vignette)
    this.pixiRenderer.resetState()
    this.pixiRenderer.render({ container: stage, clear: false })
    stage.destroy({ children: true })
    this.threeRenderer.resetState()
  }

  private createPixiLayer(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number): Container | null {
    if (layer.type === 'audio' || layer.type === '3d-scene') return null
    const scaleX = width / projectWidth
    const scaleY = height / projectHeight
    const container = new Container()
    container.position.set(
      evaluateNumericProperty(layer.transform.x, time) * scaleX,
      evaluateNumericProperty(layer.transform.y, time) * scaleY,
    )
    container.rotation = THREE.MathUtils.degToRad(evaluateNumericProperty(layer.transform.rotation, time))
    container.scale.set(
      evaluateNumericProperty(layer.transform.scaleX, time) / 100,
      evaluateNumericProperty(layer.transform.scaleY, time) / 100,
    )
    container.alpha = evaluateNumericProperty(layer.transform.opacity, time) / 100

    if (layer.type === 'cluster') {
      ;[...(layer.children ?? [])].reverse().forEach((child) => {
        const childContainer = this.createPixiLayer(child, time, width, height, projectWidth, projectHeight)
        if (childContainer) {
          childContainer.position.x -= width / 2
          childContainer.position.y -= height / 2
          container.addChild(childContainer)
        }
      })
      return container
    }
    if (layer.type === 'video' || layer.type === 'image') {
      if (!this.sourceTexture) {
        container.destroy()
        return null
      }
      const sprite = new Sprite(this.sourceTexture)
      sprite.anchor.set(.5)
      if (layer.type === 'video') {
        const sourceRatio = this.sourceTexture.width / this.sourceTexture.height
        const canvasRatio = width / height
        sprite.width = sourceRatio > canvasRatio ? height * sourceRatio : width
        sprite.height = sourceRatio > canvasRatio ? height : width / sourceRatio
      } else {
        const imageSize = 260 * Math.min(scaleX, scaleY)
        sprite.width = imageSize
        sprite.height = imageSize
      }
      container.addChild(sprite)
      return container
    }
    if (layer.type === 'text') {
      const text = new Text({
        text: layer.textContent ?? layer.name,
        style: {
          fill: '#f3eee6',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Math.max(18, 42 * scaleX),
          fontWeight: '600',
          letterSpacing: Math.max(1, 4 * scaleX),
          dropShadow: { color: '#7684dc', alpha: .6, blur: 8, distance: 0 },
        },
      })
      text.anchor.set(.5)
      container.addChild(text)
      return container
    }
    const graphics = new Graphics()
    if (layer.type === 'adjustment') {
      container.position.set(0, 0)
      container.scale.set(1, 1)
      graphics.rect(0, 0, width, height).fill({ color: '#02040b', alpha: .16 })
    } else if (layer.type === 'shape') {
      const shapeWidth = 280 * scaleX
      const shapeHeight = 180 * scaleY
      if (layer.shapeKind === 'ellipse') graphics.ellipse(0, 0, shapeWidth / 2, shapeHeight / 2)
      else graphics.roundRect(-shapeWidth / 2, -shapeHeight / 2, shapeWidth, shapeHeight, 12)
      graphics.fill(layer.color).stroke({ color: '#e2e7ff', alpha: .78, width: 2 })
    }
    container.addChild(graphics)
    return container
  }

  private renderThreeLayer(layer: EditorLayer, sceneDefinition: RenderFrameRequest['scenes3D'][number], time: number, width: number, height: number, effects: GraphEffects) {
    if (!this.threeRenderer) return
    const runtime = this.runtimeRegistry.get(sceneDefinition, width, height, time)
    const cameraId = cameraIdAtTime(sceneDefinition, time)
    const camera = cameraId ? runtime.cameras.get(cameraId) : undefined
    if (!camera) return
    // A 3D pass draws straight to the frame buffer. Opacity is applied to its materials, while
    // frame-space effects such as vignette are composited immediately after the Three pass.
    const layerOpacity = (evaluateNumericProperty(layer.transform.opacity, time) / 100) * effects.opacity
    runtime.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        material.transparent = true
        material.opacity *= layerOpacity
      })
    })
    this.threeRenderer.resetState()
    this.threeRenderer.setRenderTarget(null)
    this.threeRenderer.autoClear = false
    this.threeRenderer.clearDepth()
    this.threeRenderer.render(runtime.scene, camera)
    this.pixiRenderer?.resetState()
    const vignette = vignetteOverlay(effects, width, height)
    if (vignette && this.pixiRenderer) {
      this.pixiRenderer.render({ container: vignette, clear: false })
      vignette.destroy()
      this.threeRenderer.resetState()
    }
  }

  private surface(width: number, height: number): RenderSurface {
    return {
      width,
      height,
      backend: 'pixi-webgl',
      texture: null,
      premultipliedAlpha: HYBRID_ALPHA_CONTRACT.premultipliedAlpha,
      colorSpace: HYBRID_ALPHA_CONTRACT.colorSpace,
    }
  }

  private readonly onContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
  }

  private readonly onContextRestored = () => {
    this.contextLost = false
  }

  async dispose() {
    // Tearing down while setup is still running would leave the finished resources orphaned.
    await this.initialization?.catch(() => undefined)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.runtimeRegistry.dispose()
    this.sourceTexture?.destroy(true)
    this.sourceTexture = null
    this.sourceImage = null
    this.pixiRenderer?.destroy()
    this.pixiRenderer = null
    this.threeRenderer?.dispose()
    this.threeRenderer = null
    this.initialized = false
    this.initialization = null
  }
}
