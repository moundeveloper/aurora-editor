import * as THREE from 'three'

interface Entry { users: number; promise: Promise<THREE.Texture | null> }
const entries = new Map<string, Entry>()

/** Share decoded texture/source data across viewports; GPU allocations remain renderer-owned. */
export function acquireTexture(url: string, color: boolean) {
  const key = `${color ? 'color' : 'data'}:${url}`
  let entry = entries.get(key)
  if (!entry) {
    entry = { users: 0, promise: Promise.resolve(null) }
    entry.promise = new THREE.TextureLoader().loadAsync(url).then(texture => {
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
      return texture
    }).catch(() => null)
    entries.set(key, entry)
  }
  entry.users++
  let released = false
  return { promise: entry.promise, release() {
    if (released) return
    released = true
    if (--entry!.users === 0) {
      if (entries.get(key) === entry) entries.delete(key)
      void entry!.promise.then(texture => texture?.dispose())
    }
  } }
}
