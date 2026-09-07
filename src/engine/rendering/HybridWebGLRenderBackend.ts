import { BlurFilter, ColorMatrixFilter, Container, FillGradient, Graphics, Mesh, MeshGeometry, Sprite, Text, Texture, WebGLRenderer } from 'pixi.js'
import * as THREE from 'three'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { ThreeSceneRuntimeRegistry } from '@/engine/scene3d/ThreeSceneRuntime'
import type { GraphEffects, NodeBlendMode } from '@/engine/nodes/evaluateGraph'
import {
  createRenderPlan, HYBRID_ALPHA_CONTRACT, resolveRenderSize, type RenderPlan,
  type RenderBackend, type RenderFrameRequest, type RendererInitializationOptions, type RenderSurface,
} from '@/engine/rendering/contracts'
import type { AuroraRig, EditorLayer, MediaAsset } from '@/models/editor'
import { deformRig } from '@/engine/rig/rigMesh'
import { bonePoseMatrices, rigIsActive } from '@/engine/rig/skeleton'
import { cameraIdAtTime } from '@/engine/scene3d/cameraCuts'
import { cameraLensAtTime } from '@/engine/scene3d/cameraLens'
import { createMaskGeometry, maskAlphaField, maskGeometryKey, type MaskGeometryField } from '@/engine/rendering/maskField'
import { MediaTextureCache } from '@/engine/rendering/mediaTextures'
import { AuroraSceneRenderPipeline } from '@/engine/rendering/AuroraSceneRenderPipeline'
import { effectiveMotionBlurSamples, motionBlurSampleTimes } from '@/engine/rendering/motionBlur'
import { mediaUrl } from '../../../shared/contracts.ts'
import { bindNumericScope } from '@/engine/animation/propertyScope'
import { sharedAudioEngine } from '@/engine/audio/AudioEngine'
import { layerSampleTime, sourceTime } from '@/engine/animation/timeRemap'
import { textUnits, textAnimatorWeight, pointAlongOutline, layoutTextLines } from '@/engine/animation/textAnimation'
import { shapeOutline } from '@/engine/shapes/shapeGeometry'
import { evaluatedShapePoint } from '@/engine/shapes/shapeAnimation'
import {prepareTextFont,textFontFamily} from '@/engine/animation/textFonts'

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

/**
 * The rigged stand-in for a sprite: the same quad, subdivided and bent by the skeleton.
 *
 * Rig space runs from -1 to 1 with Y up, while the stage counts Y downward, so the vertical axis is
 * flipped on the way in. The quad keeps the size the unrigged sprite would have had, which means
 * attaching a rig never resizes or shifts the layer on its own.
 */
function riggedLayerMesh(texture: Texture, rig: AuroraRig, time: number, halfWidth: number, halfHeight: number) {
  const { mesh, positions } = deformRig(rig, bonePoseMatrices(rig, time), time)
  const vertices = new Float32Array(positions.length)
  for (let index = 0; index < positions.length; index += 2) {
    vertices[index] = positions[index]! * halfWidth
    vertices[index + 1] = -positions[index + 1]! * halfHeight
  }
  const geometry = new MeshGeometry({ positions: vertices, uvs: mesh.uvs.slice(), indices: mesh.indices.slice() })
  return new Mesh({ geometry, texture })
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

interface PixiPassCacheEntry {
  key: string
  container: Container
}

interface AppendedPixiLayer {
  container: Container
  cached: boolean
}

export interface HybridRendererStats {
  backend: 'WebGL2'
  pixiPasses: number
  pixiBatches: number
  threePasses: number
  threeDrawCalls: number
  triangles: number
  width: number
  height: number
}

export class HybridWebGLRenderBackend implements RenderBackend {
  private threeRenderer: THREE.WebGLRenderer | null = null
  private scenePipeline: AuroraSceneRenderPipeline | null = null
  private pixiRenderer: WebGLRenderer | null = null
  private readonly runtimeRegistry = new ThreeSceneRuntimeRegistry()
  private threeLayerTarget: THREE.WebGLRenderTarget | null = null
  private readonly maskCompositeScene = new THREE.Scene()
  private readonly maskCompositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly maskCompositeMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
  private readonly maskCompositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskCompositeMaterial)
  private readonly cachePresentScene = new THREE.Scene()
  private readonly cachePresentCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly cachePresentMaterial = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false })
  private readonly cachePresentQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.cachePresentMaterial)
  private readonly maskRasterCache = new Map<string, MaskRasterCacheEntry>()
  private readonly maskGeometryCache = new Map<string, MaskGeometryCacheEntry>()
  private sourceImage: HTMLImageElement | null = null
  private sourceTexture: Texture | null = null
  private readonly mediaTextures = new MediaTextureCache()
  /** Resolved once per frame, so layer creation stays synchronous while decoding does not. */
  private readonly frameTextures = new Map<string, Texture>()
  /** Rigs this frame's passes may be attached to, resolved once instead of per layer. */
  private readonly frameRigs = new Map<string, AuroraRig>()
  private frameLayers = new Map<string, EditorLayer>()
  private frameTime = 0
  /** Static display objects and filters survive frames; only their evaluated transform is updated. */
  private readonly pixiPassCache = new Map<string, PixiPassCacheEntry>()
  private readonly activePixiPasses = new Set<string>()
  private pixelRatio = 1
  private initialized = false
  private initialization: Promise<void> | null = null
  private contextLost = false
  private propertyScopeRevision: number | undefined
  private propertyScopeLayers: EditorLayer[] | null = null
  private lastStats: HybridRendererStats = {
    backend: 'WebGL2', pixiPasses: 0, pixiBatches: 0, threePasses: 0, threeDrawCalls: 0, triangles: 0, width: 1, height: 1,
  }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly sourceUrl: string) {
    this.maskCompositeScene.add(this.maskCompositeQuad)
    this.cachePresentScene.add(this.cachePresentQuad)
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
    this.threeRenderer.toneMapping = THREE.ACESFilmicToneMapping
    this.threeRenderer.toneMappingExposure = 1
    this.threeRenderer.shadowMap.enabled = true
    this.threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.threeRenderer.setClearAlpha(HYBRID_ALPHA_CONTRACT.clearAlpha)
    this.scenePipeline = new AuroraSceneRenderPipeline(this.threeRenderer)

    this.pixiRenderer = new WebGLRenderer()
    await this.pixiRenderer.init({
      // Sharing a context also requires sharing its canvas (size and context-loss events).
      canvas: this.canvas,
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
    if (this.propertyScopeLayers !== request.layers || this.propertyScopeRevision !== request.revision || request.revision === undefined) {
      bindNumericScope({ layers: request.layers, scenes: request.scenes3D, rigs: request.rigs }, (id, time) => {
        const layer = request.layers.find(layer => layer.id === id)
        if (!layer || layer.muted || time < layer.start || time >= layer.start + layer.duration) return 0
        return sharedAudioEngine.amplitude(request.assets?.find(asset => asset.id === layer.assetId), time - layer.start + (layer.sourceOffset ?? 0))
      })
      this.propertyScopeLayers = request.layers
      this.propertyScopeRevision = request.revision
    }
    if (!this.initialized) await this.initialize({ width: request.width, height: request.height, pixelRatio: this.pixelRatio })
    if (!this.threeRenderer || !this.pixiRenderer || this.contextLost) return this.surface(request.width, request.height)
    const size = resolveRenderSize(request.width, request.height, request.quality)
    if (this.lastStats.width !== size.width || this.lastStats.height !== size.height) this.resize(size.width, size.height, this.pixelRatio)
    const plan = request.compiledPlan
      ? { ...request.compiledPlan, width: size.width, height: size.height, quality: request.quality }
      : createRenderPlan({ ...request, width: size.width, height: size.height })
    const layerMap = new Map<string,EditorLayer>()
    const indexLayer=(layer:EditorLayer)=>{layerMap.set(layer.id,layer);layer.children?.forEach(indexLayer)}
    request.layers.forEach(indexLayer)
    this.frameTime=request.time
    this.frameLayers = layerMap
    this.frameRigs.clear()
    ;(request.rigs ?? []).forEach((rig) => this.frameRigs.set(rig.id, rig))
    const sceneMap = new Map(request.scenes3D.map((scene) => [scene.id, scene]))
    await this.resolveFrameTextures(plan, layerMap, request.assets ?? [], request.time, request.playback ?? false)
    await this.runtimeRegistry.prepareAssets(request.scenes3D, request.assets ?? [])

    this.threeRenderer.resetState()
    this.threeRenderer.setRenderTarget(null)
    this.threeRenderer.setScissorTest(false)
    this.threeRenderer.setClearColor(request.project.backgroundColor, request.transparentBackground ? 0 : HYBRID_ALPHA_CONTRACT.clearAlpha)
    this.threeRenderer.clear(true, true, true)

    let pixiPasses = 0
    let pixiBatches = 0
    let threePasses = 0
    this.activePixiPasses.clear()
    let pixiBatch: Array<{ pass: RenderPlan['passes'][number]; layer: EditorLayer }> = []
    const flushPixi = () => {
      if (!pixiBatch.length) return
      const stage = new Container()
      const ephemeral: Container[] = []
      pixiBatch.forEach(({ pass, layer }) => {
        const appended = this.appendPixiLayer(
          stage, pass.id, request.revision, layer, layerSampleTime(layer, request.time), size.width, size.height,
          request.project.width, request.project.height, pass.effects, pass.blendMode, layerMap,
        )
        if (appended && !appended.cached) ephemeral.push(appended.container)
      })
      this.preparePixiRender()
      this.pixiRenderer!.render({ container: stage, clear: false })
      pixiBatches += 1
      stage.removeChildren()
      ephemeral.forEach((container) => container.destroy({ children: true }))
      stage.destroy()
      this.threeRenderer!.resetState()
      pixiBatch = []
    }
    plan.passes.forEach((pass) => {
      const layer = layerMap.get(pass.layerId)
      if (!layer) return
      if (pass.backend === 'three-webgl') {
        flushPixi()
        const scene = pass.sceneId ? sceneMap.get(pass.sceneId) : undefined
        if (!scene) return
        this.renderThreeLayer(
          layer, scene, layerSampleTime(layer, request.time), size.width, size.height, request.project.width, request.project.height,
          request.project.frameRate, request.project.duration, request.quality, pass.effects, layerMap,
          request.assets ?? [], request.rigs ?? [], request.transparentBackground === true,
          request.playback === true,
        )
        threePasses += 1
      } else {
        pixiBatch.push({ pass, layer })
        pixiPasses += 1
      }
    })
    flushPixi()
    this.prunePixiPassCache()

    this.lastStats = {
      backend: 'WebGL2',
      pixiPasses,
      pixiBatches,
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

  /**
   * Reads the frame that was just drawn straight out of the drawing buffer.
   *
   * The exporter needs pixels, not a canvas: this backend renders through two libraries sharing one
   * GL context, and `toDataURL` would depend on the compositor never having cleared the buffer in
   * between. Rows arrive bottom-up from GL and are flipped here, since every consumer wants top-down.
   */
  readPixels(): { width: number; height: number; data: Uint8ClampedArray } | null {
    const gl = this.threeRenderer?.getContext()
    if (!gl || this.contextLost) return null
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    if (!width || !height) return null
    const raw = new Uint8Array(width * height * 4)
    this.threeRenderer?.resetState()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw)
    const data = new Uint8ClampedArray(raw.length)
    const stride = width * 4
    for (let row = 0; row < height; row += 1) {
      data.set(raw.subarray((height - row - 1) * stride, (height - row) * stride), row * stride)
    }
    return { width, height, data }
  }

  /** Uploads a cached top-down RGBA frame and presents it through the same sRGB output contract. */
  async presentPixels(frame: { width: number; height: number; data: Uint8ClampedArray }): Promise<RenderSurface> {
    if (!this.initialized) await this.initialize({ width: frame.width, height: frame.height, pixelRatio: 1 })
    if (!this.threeRenderer || !this.pixiRenderer || this.contextLost) return this.surface(frame.width, frame.height)
    if (this.lastStats.width !== frame.width || this.lastStats.height !== frame.height) this.resize(frame.width, frame.height, 1)

    const texture = new THREE.DataTexture(frame.data, frame.width, frame.height, THREE.RGBAFormat, THREE.UnsignedByteType)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = true
    texture.needsUpdate = true
    this.cachePresentMaterial.map = texture
    this.cachePresentMaterial.needsUpdate = true
    this.threeRenderer.resetState()
    this.threeRenderer.setRenderTarget(null)
    this.threeRenderer.setScissorTest(false)
    this.threeRenderer.setClearColor(0x000000, 1)
    this.threeRenderer.clear(true, true, true)
    this.threeRenderer.render(this.cachePresentScene, this.cachePresentCamera)
    this.cachePresentMaterial.map = null
    texture.dispose()
    this.lastStats = { ...this.lastStats, pixiPasses: 0, pixiBatches: 0, threePasses: 0, width: frame.width, height: frame.height }
    return this.surface(frame.width, frame.height)
  }

  /**
   * Decodes whatever media this frame's passes need before any of them draw.
   *
   * Layer creation is synchronous, so the awaiting happens here instead: one pass over the plan,
   * resolving each layer to a texture the cache already holds or is about to. A video is seeked to
   * its own local time, since a clip trimmed to start later in the timeline still begins at zero.
   */
  private async resolveFrameTextures(plan: RenderPlan, layerMap: Map<string, EditorLayer>, assets: MediaAsset[], time: number, playback: boolean) {
    this.frameTextures.clear()
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
    const resolve = async (layer: EditorLayer | undefined, at: number, sequential: boolean): Promise<void> => {
      if (layer?.type === 'text') {await prepareTextFont(layer);return}
      if (layer?.type === 'cluster') {
        await Promise.all((layer.children ?? []).map(child => resolve(child, layerSampleTime(layer, at), sequential && !layer.timeRemap)))
        return
      }
      if (!layer || (layer.type !== 'video' && layer.type !== 'image')) return
      const asset = layer.assetId ? assetMap.get(layer.assetId) : undefined
      if (!asset?.hash) return
      const url = mediaUrl(asset.hash)
      const texture = layer.type === 'video'
        ? await this.mediaTextures.videoFrame(url, Math.max(0, sourceTime(layer, at)), sequential && !layer.timeRemap)
        : await this.mediaTextures.image(url)
      if (texture) this.frameTextures.set(layer.id, texture)
    }
    await Promise.all(plan.passes.map(pass => resolve(layerMap.get(pass.layerId), time, playback)))
  }

  private maskRasterFor(layer: EditorLayer, effect: MaskEffect, time: number, width: number, height: number, projectWidth: number, projectHeight: number) {
    time=layerSampleTime(layer,this.frameTime)
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
    const key = `${geometryKey}|${effect.feather}|${effect.inverted ? 1 : 0}|${effect.segmentFeather.join(',')}`
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

  private appendPixiLayer(
    stage: Container,
    passId: string,
    revision: number | undefined,
    layer: EditorLayer,
    time: number,
    width: number,
    height: number,
    projectWidth: number,
    projectHeight: number,
    effects: GraphEffects,
    blendMode: NodeBlendMode,
    layerMap: Map<string, EditorLayer>,
  ): AppendedPixiLayer | null {
    if (!this.pixiRenderer || !this.threeRenderer) return null
    const cacheable = (layer.type === 'text' || layer.type === 'shape') && !layer.shapePath?.points.some(point=>point.channels) && !layer.textAnimators?.length && !layer.textPathId && !effects.mask && effects.vignetteAmount <= 0
    const fallbackRevision = revision === undefined ? JSON.stringify({ layer, effects, blendMode }) : revision
    const cacheKey = `${fallbackRevision}|${width}x${height}|${projectWidth}x${projectHeight}`
    const cached = cacheable ? this.pixiPassCache.get(passId) : undefined
    if (cached?.key === cacheKey) {
      this.applyPixiPassTransform(cached.container, layer, time, width, height, projectWidth, projectHeight, effects, blendMode)
      stage.addChild(cached.container)
      this.activePixiPasses.add(passId)
      return { container: cached.container, cached: true }
    }
    if (cached) {
      cached.container.parent?.removeChild(cached.container)
      cached.container.destroy({ children: true })
      this.pixiPassCache.delete(passId)
    }

    const container = this.createPixiLayer(layer, time, width, height, projectWidth, projectHeight)
    if (!container) return null
    this.applyPixiPassTransform(container, layer, time, width, height, projectWidth, projectHeight, effects, blendMode)
    const scaleFactor = width / projectWidth
    const filters = []
    if (effects.blur > 0) filters.push(new BlurFilter({ strength: effects.blur * scaleFactor, quality: 4 }))
    const colorMatrix = colorFilterFor(effects)
    if (colorMatrix) filters.push(colorMatrix)
    if (filters.length) container.filters = filters
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
    if (cacheable) {
      this.pixiPassCache.set(passId, { key: cacheKey, container })
      this.activePixiPasses.add(passId)
      return { container, cached: true }
    }
    return { container, cached: false }
  }

  private applyPixiPassTransform(
    container: Container,
    layer: EditorLayer,
    time: number,
    width: number,
    height: number,
    projectWidth: number,
    projectHeight: number,
    effects: GraphEffects,
    blendMode: NodeBlendMode,
  ) {
    // An adjustment layer is a full-frame grade, not a positioned object: its rect is authored in
    // frame space from (0,0). Applying the layer transform here would offset that full-frame rect by
    // the layer's centre and leave only a quarter of it on screen, so adjustment stays at identity —
    // only its opacity and blend mode carry through.
    if (layer.type === 'adjustment') {
      container.position.set(0, 0)
      container.rotation = 0
      container.scale.set(1, 1)
      container.alpha = evaluateNumericProperty(layer.transform.opacity, time) / 100 * effects.opacity
      container.blendMode = blendMode
      return
    }
    const scaleX = width / projectWidth
    const scaleY = height / projectHeight
    container.position.set(
      evaluateNumericProperty(layer.transform.x, time) * scaleX + effects.offsetX * scaleX,
      evaluateNumericProperty(layer.transform.y, time) * scaleY + effects.offsetY * scaleY,
    )
    container.rotation = THREE.MathUtils.degToRad(evaluateNumericProperty(layer.transform.rotation, time) + effects.rotation)
    container.scale.set(
      evaluateNumericProperty(layer.transform.scaleX, time) / 100 * effects.scale,
      evaluateNumericProperty(layer.transform.scaleY, time) / 100 * effects.scale,
    )
    container.alpha = evaluateNumericProperty(layer.transform.opacity, time) / 100 * effects.opacity
    container.blendMode = blendMode
  }

  private prunePixiPassCache() {
    this.pixiPassCache.forEach((entry, passId) => {
      if (this.activePixiPasses.has(passId)) return
      entry.container.parent?.removeChild(entry.container)
      entry.container.destroy({ children: true })
      this.pixiPassCache.delete(passId)
    })
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
        if (!child.visible || child.isPlaceholder || time < child.start || time >= child.start + child.duration) return
        const childContainer = this.createPixiLayer(child, layerSampleTime(child, time), width, height, projectWidth, projectHeight)
        if (childContainer) {
          childContainer.position.x -= width / 2
          childContainer.position.y -= height / 2
          container.addChild(childContainer)
        }
      })
      return container
    }
    if (layer.type === 'video' || layer.type === 'image') {
      // Vault media when the layer has any, and the demo still only while it does not.
      const texture = this.frameTextures.get(layer.id) ?? this.sourceTexture
      if (!texture) {
        container.destroy()
        return null
      }
      let displayWidth: number
      let displayHeight: number
      if (layer.type === 'video') {
        const sourceRatio = texture.width / texture.height
        const canvasRatio = width / height
        displayWidth = sourceRatio > canvasRatio ? height * sourceRatio : width
        displayHeight = sourceRatio > canvasRatio ? height : width / sourceRatio
      } else {
        displayWidth = 260 * Math.min(scaleX, scaleY)
        displayHeight = displayWidth
      }
      const rig = layer.rigId ? this.frameRigs.get(layer.rigId) : undefined
      if (rigIsActive(rig)) {
        container.addChild(riggedLayerMesh(texture, rig, time, displayWidth / 2, displayHeight / 2))
        return container
      }
      const sprite = new Sprite(texture)
      sprite.anchor.set(.5)
      sprite.width = displayWidth
      sprite.height = displayHeight
      container.addChild(sprite)
      return container
    }
    if (layer.type === 'text') {
      const style = {
        fill: layer.textColor ?? '#f3eee6', fontFamily: textFontFamily(layer),
        fontSize: Math.max(1, (layer.textSize ?? 42) * scaleX), fontWeight: '600' as const, letterSpacing: 4 * scaleX,
      }
      if (layer.textAnimators?.length || layer.textPathId) {
        const content = layer.textContent ?? layer.name
        const glyphs = textUnits(content, 'character')
        const words = textUnits(content, 'word')
        const path = layer.textPathId ? this.frameLayers.get(layer.textPathId) : undefined
        const pathTime=path ? layerSampleTime(path,this.frameTime) : time
        const outline = path ? shapeOutline(path, 64, pathTime) : null
        if(outline && path) {
          const at=(key:keyof EditorLayer['transform'])=>evaluateNumericProperty(path.transform[key],pathTime)
          const rotation=at('rotation')*Math.PI/180,cos=Math.cos(rotation),sin=Math.sin(rotation)
          outline.points=outline.points.map(([x,y])=>{
            const sx=x*at('scaleX')/100,sy=y*at('scaleY')/100
            return [at('x')-projectWidth/2+sx*cos-sy*sin,at('y')-projectHeight/2+sx*sin+sy*cos]
          })
        }
        const texts = glyphs.map(glyph => new Text({ text: /^\r?\n$/.test(glyph.text) ? '' : glyph.text, style: { ...style, fill: '#ffffff',letterSpacing:0 } }))
        const positions=layoutTextLines(glyphs.map(glyph=>glyph.text),texts.map(text=>text.width),style.letterSpacing,style.fontSize*1.25)
        const widthTotal = texts.reduce((sum, text) => sum + text.width + style.letterSpacing, 0)
        let cursor = -widthTotal / 2
        for (let i = 0; i < texts.length; i++) {
          const text = texts[i]!, advance = text.width + style.letterSpacing
          text.anchor.set(.5)
          text.tint = style.fill
          text.position.set(positions[i]!.x,positions[i]!.y)
          if (outline) {
            const at = pointAlongOutline(outline.points, outline.closed, (cursor + widthTotal / 2 + advance / 2) / scaleX + (layer.textPathOffset ? evaluateNumericProperty(layer.textPathOffset, time) : 0))
            text.position.set(at.x * scaleX, at.y * scaleY); text.rotation = at.rotation
          }
          for (const animator of layer.textAnimators ?? []) {
            const index = animator.unit === 'word' ? words[i]!.index : i
            const count = animator.unit === 'word' ? (words.at(-1)?.index ?? 0) + 1 : texts.length
            const weight = textAnimatorWeight(animator, index, count, time)
            const at = (key: keyof typeof animator.parameters) => evaluateNumericProperty(animator.parameters[key], time)
            text.x += at('x') * scaleX * weight; text.y += at('y') * scaleY * weight
            text.rotation += THREE.MathUtils.degToRad(at('rotation')) * weight
            text.alpha *= 1 + (at('opacity') / 100 - 1) * weight
            const base = new THREE.Color(text.tint), tint = new THREE.Color(animator.color)
            text.tint = `#${base.lerp(tint, weight).getHexString()}`
          }
          container.addChild(text)
          cursor += advance
        }
        return container
      }
      const text = new Text({
        text: layer.textContent ?? layer.name,
        style: {
          ...style,
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
        const points = layer.shapePath.points.map(point=>evaluatedShapePoint(point,time))
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
    frameRate: number,
    projectDuration: number,
    quality: RenderFrameRequest['quality'],
    effects: GraphEffects,
    layerMap: Map<string, EditorLayer>,
    assets: MediaAsset[],
    rigs: AuroraRig[],
    transparentBackground: boolean,
    playback: boolean,
  ) {
    if (!this.threeRenderer) return
    const runtime = this.runtimeRegistry.get(sceneDefinition, width, height, time, assets, rigs)
    const cameraId = cameraIdAtTime(sceneDefinition, time)
    const camera = cameraId ? runtime.cameras.get(cameraId) : undefined
    if (!camera) return
    this.threeRenderer.shadowMap.enabled = sceneDefinition.settings.shadows
    const layerOpacity = (evaluateNumericProperty(layer.transform.opacity, time) / 100) * effects.opacity

    const maskLayer = effects.mask ? layerMap.get(effects.mask.layerId) : null
    const maskRaster = effects.mask && maskLayer
      ? this.maskRasterFor(maskLayer, effects.mask, time, width, height, projectWidth, projectHeight)
      : null
    const renderSettings = { ...sceneDefinition.settings, quality }
    /*
     * Running the transport buys preview fidelity, not final fidelity. Ambient occlusion is a
     * second full-screen pass per 3D layer per frame, and shutter sampling multiplies the entire
     * scene render by its sample count — eight scene renders for one displayed frame at the default
     * shutter. Both are restored the moment playback stops, and neither is touched for export,
     * which never sets the playback flag.
     */
    const ambientOcclusion = renderSettings.ambientOcclusion && quality !== 'draft' && !playback
    const cameraDefinition = sceneDefinition.cameras.find((item) => item.id === cameraId)
    const motionBlurSamples = layer.motionBlur === false ? 1 : effectiveMotionBlurSamples(renderSettings, quality, playback)
    const sampleTimes = motionBlurSampleTimes(
      time, frameRate, renderSettings.motionBlurShutter, motionBlurSamples,
      Math.max(0, layer.start), Math.min(projectDuration, layer.start + layer.duration),
    )
    const motionBlur = sampleTimes.length > 1
    // Depth of field and motion blur are post passes, so either forces the composited route even with
    // no mask or ambient occlusion: the direct render below has nowhere to apply them. The bokeh pass
    // is a single cheap post shader, so unlike AO it stays on in draft — otherwise focus would blink
    // off the instant playback drops to draft quality and the lens would look like it was not retained.
    const lens = cameraDefinition ? cameraLensAtTime(cameraDefinition, time) : null
    if (maskRaster || ambientOcclusion || lens || motionBlur) {
      let sceneTexture: THREE.Texture | null = null
      this.threeRenderer.resetState()
      if (motionBlur && this.scenePipeline) {
        try {
          sceneTexture = this.scenePipeline.renderMotionBlur(sampleTimes, (sampleTime) => {
            const sampleRuntime = this.runtimeRegistry.get(sceneDefinition, width, height, sampleTime, assets, rigs)
            if (transparentBackground) sampleRuntime.scene.background = null
            const sampleCameraId = cameraIdAtTime(sceneDefinition, sampleTime)
            const sampleCamera = sampleCameraId ? sampleRuntime.cameras.get(sampleCameraId) : undefined
            const sampleCameraDefinition = sceneDefinition.cameras.find((item) => item.id === sampleCameraId)
            if (!sampleCamera) return null
            return {
              scene: sampleRuntime.scene,
              camera: sampleCamera,
              lens: sampleCameraDefinition ? cameraLensAtTime(sampleCameraDefinition, sampleTime) : null,
            }
          }, renderSettings, width, height)
        } finally {
          // Sampling mutates the persistent runtime in place. Put it back at the playhead so selection
          // overlays and a second pass of the same scene observe the exact requested state.
          this.runtimeRegistry.get(sceneDefinition, width, height, time, assets, rigs)
        }
      } else if ((ambientOcclusion || lens) && this.scenePipeline) {
        const background = runtime.scene.background
        if (transparentBackground) runtime.scene.background = null
        try {
          sceneTexture = this.scenePipeline.render(runtime.scene, camera, renderSettings, width, height, 'texture', lens)
        } finally {
          runtime.scene.background = background
        }
      } else {
        this.threeLayerTarget ??= new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: false })
        if (this.threeLayerTarget.width !== width || this.threeLayerTarget.height !== height) this.threeLayerTarget.setSize(width, height)
        this.threeLayerTarget.texture.colorSpace = THREE.SRGBColorSpace
        this.threeRenderer.setRenderTarget(this.threeLayerTarget)
        this.threeRenderer.setClearColor(0x000000, 0)
        this.threeRenderer.clear(true, true, true)
        const background = runtime.scene.background
        if (transparentBackground) runtime.scene.background = null
        try {
          this.threeRenderer.render(runtime.scene, camera)
        } finally {
          runtime.scene.background = background
        }
        sceneTexture = this.threeLayerTarget.texture
      }
      if (!sceneTexture) return

      let alphaMap: THREE.Texture | null = null
      if (maskRaster) {
        maskRaster.threeTexture ??= new THREE.CanvasTexture(maskRaster.canvas)
        maskRaster.threeTexture.colorSpace = THREE.NoColorSpace
        maskRaster.threeTexture.minFilter = THREE.LinearFilter
        maskRaster.threeTexture.magFilter = THREE.LinearFilter
        alphaMap = maskRaster.threeTexture
      }
      this.maskCompositeMaterial.map = sceneTexture
      const changesAlphaMode = Boolean(this.maskCompositeMaterial.alphaMap) !== Boolean(alphaMap)
      this.maskCompositeMaterial.alphaMap = alphaMap
      this.maskCompositeMaterial.opacity = layerOpacity
      if (changesAlphaMode) this.maskCompositeMaterial.needsUpdate = true

      this.threeRenderer.setRenderTarget(null)
      this.threeRenderer.autoClear = false
      this.threeRenderer.clearDepth()
      this.threeRenderer.render(this.maskCompositeScene, this.maskCompositeCamera)
    } else {
      // An unmasked 3D scene can still take the direct path and avoid allocating an intermediate pass.
      const opacityRestore: Array<{ material: THREE.Material & { opacity: number }; opacity: number }> = []
      runtime.root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          if (!('opacity' in material) || typeof material.opacity !== 'number') return
          opacityRestore.push({ material, opacity: material.opacity })
          material.opacity *= layerOpacity
        })
      })
      this.threeRenderer.resetState()
      this.threeRenderer.setRenderTarget(null)
      this.threeRenderer.autoClear = false
      this.threeRenderer.clearDepth()
      const background = runtime.scene.background
      if (transparentBackground) runtime.scene.background = null
      try {
        this.threeRenderer.render(runtime.scene, camera)
      } finally {
        runtime.scene.background = background
      }
      opacityRestore.forEach(({ material, opacity }) => { material.opacity = opacity })
    }
    const vignette = vignetteOverlay(effects, width, height)
    if (vignette && this.pixiRenderer) {
      this.preparePixiRender()
      this.pixiRenderer.render({ container: vignette, clear: false })
      vignette.destroy()
      this.threeRenderer.resetState()
    }
  }

  private preparePixiRender() {
    // Post-processing leaves GL state outside Pixi's cache. Reset the outgoing renderer first:
    // resetting only Pixi can make the next filtered layer erase the composite underneath it.
    this.threeRenderer!.resetState()
    this.pixiRenderer!.resetState()
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
    this.scenePipeline?.dispose()
    this.scenePipeline = null
    this.threeLayerTarget?.dispose()
    this.threeLayerTarget = null
    this.maskCompositeQuad.geometry.dispose()
    this.maskCompositeMaterial.dispose()
    this.cachePresentQuad.geometry.dispose()
    this.cachePresentMaterial.dispose()
    this.maskRasterCache.forEach((entry) => {
      entry.pixiTexture?.destroy(true)
      entry.threeTexture?.dispose()
    })
    this.maskRasterCache.clear()
    this.maskGeometryCache.clear()
    this.mediaTextures.dispose()
    this.frameTextures.clear()
    this.frameRigs.clear()
    this.pixiPassCache.forEach((entry) => entry.container.destroy({ children: true }))
    this.pixiPassCache.clear()
    this.activePixiPasses.clear()
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
