import * as THREE from 'three'
import { DisplayP3ColorSpace, DisplayP3ColorSpaceImpl, LinearDisplayP3ColorSpace, LinearDisplayP3ColorSpaceImpl } from 'three/addons/math/ColorSpaces.js'
import type { Scene3DSettings } from '@/models/editor'

THREE.ColorManagement.define({
  [DisplayP3ColorSpace]: DisplayP3ColorSpaceImpl,
  [LinearDisplayP3ColorSpace]: LinearDisplayP3ColorSpaceImpl,
})

export function sceneWorkingSpace(settings: Scene3DSettings) {
  return settings.workingColorSpace === 'linear-display-p3' ? LinearDisplayP3ColorSpace : THREE.LinearSRGBColorSpace
}

export function workingToDisplayMatrix(space: string) {
  if (space === THREE.LinearSRGBColorSpace) return new THREE.Matrix3()
  return new THREE.Matrix3().multiplyMatrices(
    THREE.ColorManagement.spaces[THREE.LinearSRGBColorSpace]!.fromXYZ,
    THREE.ColorManagement.spaces[space]!.toXYZ,
  )
}

const colorTextureSlots = ['map', 'emissiveMap', 'lightMap', 'envMap', 'matcap', 'sheenColorMap', 'specularColorMap']
interface ConvertedTexture { version: number; texture: THREE.DataTexture; release: () => void }

/**
 * Authored and imported runtime data stays in linear sRGB. A synchronous render scope converts
 * color inputs to linear P3 and restores them even on failure. This avoids changing the global
 * color convention while another viewport, loader, or the Pixi compositor is doing work.
 */
export class SceneWorkingSpace {
  private textures = new Map<THREE.Texture, ConvertedTexture>()

  private texture(source: THREE.Texture) {
    const cached = this.textures.get(source)
    if (cached?.version === source.version) return cached.texture
    if (cached) cached.release()
    if (source.isRenderTargetTexture || (source as THREE.CompressedTexture).isCompressedTexture) {
      throw new Error('Linear P3 requires decoded color textures. Use linear sRGB for compressed or render-target inputs.')
    }
    const image = source.image as { width: number; height: number; data?: ArrayLike<number> }
    if (!image?.width || !image?.height) throw new Error('Color texture has not finished loading.')
    let pixels: ArrayLike<number>, type = source.type, inputSpace = source.colorSpace || THREE.LinearSRGBColorSpace
    if (image.data) pixels = image.data
    else {
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
      context.drawImage(source.image as CanvasImageSource, 0, 0)
      pixels = context.getImageData(0, 0, image.width, image.height).data
      type = THREE.UnsignedByteType
      // The 2D readback explicitly normalizes embedded image profiles to sRGB.
      inputSpace = THREE.SRGBColorSpace
      canvas.width = 0; canvas.height = 0
    }
    const channels = pixels.length / (image.width * image.height)
    if (channels !== 4 && channels !== 3) throw new Error('Color texture must have RGB or RGBA channels.')
    const data = new Uint16Array(image.width * image.height * 4), color = new THREE.Color()
    const read = (i: number) => type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(pixels[i]!) : type === THREE.UnsignedByteType ? pixels[i]! / 255 : pixels[i]!
    for (let pixel = 0; pixel < image.width * image.height; pixel++) {
      const i = pixel * channels, o = pixel * 4
      color.r = read(i); color.g = read(i + 1); color.b = read(i + 2)
      THREE.ColorManagement.convert(color, inputSpace, LinearDisplayP3ColorSpace)
      data[o] = THREE.DataUtils.toHalfFloat(color.r)
      data[o + 1] = THREE.DataUtils.toHalfFloat(color.g)
      data[o + 2] = THREE.DataUtils.toHalfFloat(color.b)
      data[o + 3] = THREE.DataUtils.toHalfFloat(channels === 4 ? read(i + 3) : 1)
    }
    const texture = new THREE.DataTexture(data, image.width, image.height, THREE.RGBAFormat, THREE.HalfFloatType)
    texture.mapping = source.mapping; texture.channel = source.channel
    texture.wrapS = source.wrapS; texture.wrapT = source.wrapT
    texture.magFilter = source.magFilter; texture.minFilter = source.minFilter
    texture.generateMipmaps = source.generateMipmaps; texture.anisotropy = source.anisotropy
    texture.flipY = source.flipY; texture.premultiplyAlpha = source.premultiplyAlpha
    texture.offset.copy(source.offset); texture.repeat.copy(source.repeat); texture.center.copy(source.center)
    texture.rotation = source.rotation; texture.matrix.copy(source.matrix); texture.matrixAutoUpdate = source.matrixAutoUpdate
    texture.colorSpace = THREE.NoColorSpace // Already linear P3; no transfer function on upload.
    texture.needsUpdate = true
    const release = () => { source.removeEventListener('dispose', release); texture.dispose(); this.textures.delete(source) }
    source.addEventListener('dispose', release)
    this.textures.set(source, { version: source.version, texture, release })
    return texture
  }

  render<T>(scene: THREE.Scene, settings: Scene3DSettings, draw: () => T): T {
    if (sceneWorkingSpace(settings) === THREE.LinearSRGBColorSpace) return draw()
    const restore: (() => void)[] = [], colors = new Set<THREE.Color>(), materials = new Set<THREE.Material>()
    const previousSpace = THREE.ColorManagement.workingColorSpace
    const convertColor = (color: THREE.Color) => {
      if (colors.has(color)) return
      colors.add(color)
      const original = color.clone()
      restore.push(() => color.copy(original))
      THREE.ColorManagement.convert(color, THREE.LinearSRGBColorSpace, LinearDisplayP3ColorSpace)
    }
    const convertTexture = (owner: Record<string, unknown>, key: string) => {
      const value = owner[key]
      if (!(value instanceof THREE.Texture)) return
      const converted = this.texture(value)
      restore.push(() => { owner[key] = value })
      owner[key] = converted
    }
    try {
      if (scene.background instanceof THREE.Color) convertColor(scene.background)
      if (scene.fog) convertColor(scene.fog.color)
      convertTexture(scene as unknown as Record<string, unknown>, 'environment')
      convertTexture(scene as unknown as Record<string, unknown>, 'background')
      scene.traverse(object => {
        if (object instanceof THREE.Light) {
          convertColor(object.color)
          if (object instanceof THREE.HemisphereLight) convertColor(object.groundColor)
        }
        const mesh = object as THREE.Mesh
        for (const material of mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []) {
          if (materials.has(material)) continue
          materials.add(material)
          for (const value of Object.values(material)) if (value instanceof THREE.Color) convertColor(value)
          for (const slot of colorTextureSlots) convertTexture(material as unknown as Record<string, unknown>, slot)
          for (const uniforms of [(material as THREE.ShaderMaterial).uniforms, material.userData.auroraLinkUniforms]) {
            if (uniforms) for (const uniform of Object.values(uniforms) as THREE.IUniform[]) if (uniform.value instanceof THREE.Color) convertColor(uniform.value)
          }
          const originalKey = material.customProgramCacheKey
          const originalCompile = material.onBeforeCompile
          material.onBeforeCompile = (shader, renderer) => {
            originalCompile.call(material, shader, renderer)
            const matrix = workingToDisplayMatrix(LinearDisplayP3ColorSpace).invert().elements.join(',')
            shader.vertexShader = shader.vertexShader.replace(/#include\s+<color_vertex>/, `${THREE.ShaderChunk.color_vertex}\n#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA) || defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)\nvColor.rgb = mat3(${matrix}) * vColor.rgb;\n#endif`)
          }
          material.customProgramCacheKey = () => `${originalKey.call(material)}:linear-p3`
          material.needsUpdate = true
          restore.push(() => { material.customProgramCacheKey = originalKey; material.onBeforeCompile = originalCompile; material.needsUpdate = true })
        }
      })
      THREE.ColorManagement.workingColorSpace = LinearDisplayP3ColorSpace
      return draw()
    } finally {
      THREE.ColorManagement.workingColorSpace = previousSpace
      for (let i = restore.length - 1; i >= 0; i--) restore[i]!()
    }
  }

  dispose() { for (const entry of [...this.textures.values()]) entry.release() }
}
