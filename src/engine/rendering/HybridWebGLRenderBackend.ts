import { Container, Graphics, Sprite, Text, Texture, WebGLRenderer } from 'pixi.js'
import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import {
  createRenderPlan, HYBRID_ALPHA_CONTRACT, resolveRenderSize,
  type RenderBackend, type RenderFrameRequest, type RendererInitializationOptions, type RenderSurface,
} from '@/engine/rendering/contracts'
import type { EditorLayer } from '@/models/editor'

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
        this.renderThreeLayer(layer, scene, request.time, size.width, size.height)
        threePasses += 1
      } else {
        this.renderPixiLayer(layer, request.time, size.width, size.height, request.project.width, request.project.height)
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

  private renderPixiLayer(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number) {
    if (!this.pixiRenderer || !this.threeRenderer) return
    const container = this.createPixiLayer(layer, time, width, height, projectWidth, projectHeight)
    if (!container) return
    this.pixiRenderer.resetState()
    this.pixiRenderer.render({ container, clear: false })
    container.destroy({ children: true })
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

  private renderThreeLayer(layer: EditorLayer, sceneDefinition: RenderFrameRequest['scenes3D'][number], time: number, width: number, height: number) {
    if (!this.threeRenderer) return
    const runtime = this.runtimeRegistry.get(sceneDefinition, width, height, time)
    const camera = sceneDefinition.activeCameraId ? runtime.cameras.get(sceneDefinition.activeCameraId) : undefined
    if (!camera) return
    const layerOpacity = evaluateNumericProperty(layer.transform.opacity, time) / 100
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
