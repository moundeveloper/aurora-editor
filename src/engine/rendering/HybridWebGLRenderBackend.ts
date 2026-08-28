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
import { createMaskGeometry, maskAlphaField, maskGeometryKey, type MaskGeometryField } from '@/engine/rendering/maskField'

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

type MaskEffect = NonNullable<GraphEffects['mask']>

/** Uploads the alpha the field module computes; the arithmetic itself is pure and lives beside its tests. */
function paintMaskCanvas(geometry: MaskGeometryField, effect: MaskEffect, width: number, height: number, projectWidth: number) {
  if (typeof document === 'undefined') return null
  const field = maskAlphaField(geometry, effect, width, height, projectWidth)
  const canvas = document.createElement('canvas')
  canvas.width = field.width
  canvas.height = field.height
  const context = canvas.getContext('2d')
  if (!context) return null
  const pixels = context.createImageData(field.width, field.height)
  for (let index = 0; index < field.alpha.length; index += 1) {
    const alphaByte = field.alpha[index]!
    const pixelIndex = index * 4
    pixels.data[pixelIndex] = alphaByte
    pixels.data[pixelIndex + 1] = alphaByte
    pixels.data[pixelIndex + 2] = alphaByte
    pixels.data[pixelIndex + 3] = alphaByte
  }
  context.putImageData(pixels, 0, 0)
  return canvas
}

interface MaskRasterCacheEntry {
  key: string
  canvas: HTMLCanvasElement
  pixiTexture?: Texture
  threeTexture?: THREE.CanvasTexture
}

interface MaskGeometryCacheEntry { key: string; geometry: MaskGeometryField }

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
  private threeLayerTarget: THREE.WebGLRenderTarget | null = null
  private readonly maskCompositeScene = new THREE.Scene()
  private readonly maskCompositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly maskCompositeMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
  private readonly maskCompositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskCompositeMaterial)
  private readonly maskRasterCache = new Map<string, MaskRasterCacheEntry>()
  private readonly maskGeometryCache = new Map<string, MaskGeometryCacheEntry>()
  private sourceImage: HTMLImageElement | null = null
  private sourceTexture: Texture | null = null
  private pixelRatio = 1
  private initialized = false
  private initialization: Promise<void> | null = null
  private contextLost = false
  private lastStats: HybridRendererStats = {
    backend: 'WebGL2', pixiPasses: 0, threePasses: 0, threeDrawCalls: 0, triangles: 0, width: 1, height: 1,
  }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly sourceUrl: string) {
    this.maskCompositeScene.add(this.maskCompositeQuad)
  }

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
    this.threeLayerTarget?.setSize(width, height)
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
        this.renderThreeLayer(layer, scene, request.time, size.width, size.height, request.project.width, request.project.height, pass.effects, layerMap)
        threePasses += 1
      } else {
        this.renderPixiLayer(layer, request.time, size.width, size.height, request.project.width, request.project.height, pass.effects, pass.blendMode, layerMap)
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

  private maskRasterFor(layer: EditorLayer, effect: MaskEffect, time: number, width: number, height: number, projectWidth: number, projectHeight: number) {
    const geometryKey = maskGeometryKey(layer, time, width, height, projectWidth, projectHeight)
    let geometryEntry = this.maskGeometryCache.get(layer.id)
    if (geometryEntry?.key !== geometryKey) {
      const geometry = createMaskGeometry(layer, time, width, height, projectWidth, projectHeight)
      if (!geometry) {
        this.maskGeometryCache.delete(layer.id)
        const staleRaster = this.maskRasterCache.get(layer.id)
        staleRaster?.pixiTexture?.destroy(true)
        staleRaster?.threeTexture?.dispose()
        this.maskRasterCache.delete(layer.id)
        return null
      }
      geometryEntry = { key: geometryKey, geometry }
      this.maskGeometryCache.set(layer.id, geometryEntry)
    }
    const key = `${geometryKey}|${effect.feather}|${effect.inverted ? 1 : 0}|${effect.edgeFeather.join(',')}`
    const cached = this.maskRasterCache.get(layer.id)
    if (cached?.key === key) return cached
    cached?.pixiTexture?.destroy(true)
    cached?.threeTexture?.dispose()
    const canvas = paintMaskCanvas(geometryEntry.geometry, effect, width, height, projectWidth)
    if (!canvas) {
      this.maskRasterCache.delete(layer.id)
      return null
    }
    const entry: MaskRasterCacheEntry = { key, canvas }
    this.maskRasterCache.set(layer.id, entry)
    return entry
  }

  private renderPixiLayer(layer: EditorLayer, time: number, width: number, height: number, projectWidth: number, projectHeight: number, effects: GraphEffects, blendMode: NodeBlendMode, layerMap: Map<string, EditorLayer>) {
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
    const maskLayer = effects.mask ? layerMap.get(effects.mask.layerId) : null
    const maskRaster = effects.mask && maskLayer
      ? this.maskRasterFor(maskLayer, effects.mask, time, width, height, projectWidth, projectHeight)
      : null
    if (maskRaster) {
      maskRaster.pixiTexture ??= Texture.from(maskRaster.canvas)
      const maskSprite = new Sprite(maskRaster.pixiTexture)
      maskSprite.width = width
      maskSprite.height = height
      stage.addChild(maskSprite)
      container.mask = maskSprite
    }
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
      const shapeWidth = (layer.shapeWidth ?? 280) * scaleX
      const shapeHeight = (layer.shapeHeight ?? 180) * scaleY
      if (layer.shapeKind === 'ellipse') graphics.ellipse(0, 0, shapeWidth / 2, shapeHeight / 2)
      else if (layer.shapeKind === 'path' && layer.shapePath?.points.length) {
        const points = layer.shapePath.points
        const first = points[0]!
        graphics.moveTo(first.position[0] * scaleX, first.position[1] * scaleY)
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1]!
          const point = points[index]!
          graphics.bezierCurveTo(
            previous.handleOut[0] * scaleX, previous.handleOut[1] * scaleY,
            point.handleIn[0] * scaleX, point.handleIn[1] * scaleY,
            point.position[0] * scaleX, point.position[1] * scaleY,
          )
        }
        if (layer.shapePath.closed && points.length > 2) {
          const last = points.at(-1)!
          graphics.bezierCurveTo(
            last.handleOut[0] * scaleX, last.handleOut[1] * scaleY,
            first.handleIn[0] * scaleX, first.handleIn[1] * scaleY,
            first.position[0] * scaleX, first.position[1] * scaleY,
          ).closePath()
        }
      } else graphics.roundRect(-shapeWidth / 2, -shapeHeight / 2, shapeWidth, shapeHeight, 12)
      if (layer.shapeKind !== 'path' || layer.shapePath?.closed) graphics.fill(layer.color)
      graphics.stroke({ color: '#e2e7ff', alpha: .78, width: 2 })
    }
    container.addChild(graphics)
    return container
  }

  private renderThreeLayer(
    layer: EditorLayer,
    sceneDefinition: RenderFrameRequest['scenes3D'][number],
    time: number,
    width: number,
    height: number,
    projectWidth: number,
    projectHeight: number,
    effects: GraphEffects,
    layerMap: Map<string, EditorLayer>,
  ) {
    if (!this.threeRenderer) return
    const runtime = this.runtimeRegistry.get(sceneDefinition, width, height, time)
    const cameraId = cameraIdAtTime(sceneDefinition, time)
    const camera = cameraId ? runtime.cameras.get(cameraId) : undefined
    if (!camera) return
    const layerOpacity = (evaluateNumericProperty(layer.transform.opacity, time) / 100) * effects.opacity

    const maskLayer = effects.mask ? layerMap.get(effects.mask.layerId) : null
    const maskRaster = effects.mask && maskLayer
      ? this.maskRasterFor(maskLayer, effects.mask, time, width, height, projectWidth, projectHeight)
      : null
    if (maskRaster) {
      this.threeLayerTarget ??= new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: false })
      if (this.threeLayerTarget.width !== width || this.threeLayerTarget.height !== height) this.threeLayerTarget.setSize(width, height)
      this.threeLayerTarget.texture.colorSpace = THREE.SRGBColorSpace

      this.threeRenderer.resetState()
      this.threeRenderer.setRenderTarget(this.threeLayerTarget)
      this.threeRenderer.setClearColor(0x000000, 0)
      this.threeRenderer.clear(true, true, true)
      this.threeRenderer.render(runtime.scene, camera)

      maskRaster.threeTexture ??= new THREE.CanvasTexture(maskRaster.canvas)
      maskRaster.threeTexture.colorSpace = THREE.NoColorSpace
      maskRaster.threeTexture.minFilter = THREE.LinearFilter
      maskRaster.threeTexture.magFilter = THREE.LinearFilter
      this.maskCompositeMaterial.map = this.threeLayerTarget.texture
      const enablesAlphaMap = !this.maskCompositeMaterial.alphaMap
      this.maskCompositeMaterial.alphaMap = maskRaster.threeTexture
      this.maskCompositeMaterial.opacity = layerOpacity
      if (enablesAlphaMap) this.maskCompositeMaterial.needsUpdate = true

      this.threeRenderer.setRenderTarget(null)
      this.threeRenderer.autoClear = false
      this.threeRenderer.clearDepth()
      this.threeRenderer.render(this.maskCompositeScene, this.maskCompositeCamera)
      this.pixiRenderer?.resetState()
    } else {
      // An unmasked 3D scene can still take the direct path and avoid allocating an intermediate pass.
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
    this.threeLayerTarget?.dispose()
    this.threeLayerTarget = null
    this.maskCompositeQuad.geometry.dispose()
    this.maskCompositeMaterial.dispose()
    this.maskRasterCache.forEach((entry) => {
      entry.pixiTexture?.destroy(true)
      entry.threeTexture?.dispose()
    })
    this.maskRasterCache.clear()
    this.maskGeometryCache.clear()
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
