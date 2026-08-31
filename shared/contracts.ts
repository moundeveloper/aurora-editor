import { z } from 'zod'

/**
 * The single source of truth for everything crossing the wire.
 *
 * The server validates against these schemas at its boundary and the app infers its types from the
 * same definitions, so a route and its caller cannot drift apart without the type-check failing.
 * Imported by both sides — it must stay free of Node and browser APIs alike.
 */

export const MEDIA_KINDS = ['video', 'image', 'audio', 'model3d', 'hdr'] as const
export const mediaKindSchema = z.enum(MEDIA_KINDS)
export type MediaKind = z.infer<typeof mediaKindSchema>

/**
 * A stored blob. `hash` is the content address: the same bytes imported twice yield one record, and
 * everything derived from it (proxies, thumbnails, waveforms) can be keyed off the hash and cached
 * forever, because the bytes behind a hash never change.
 */
export const mediaAssetSchema = z.object({
  id: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/, 'expected a sha-256 hex digest'),
  name: z.string().min(1),
  kind: mediaKindSchema,
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  importedAt: z.number().int().nonnegative(),
  /** Filled in by the probe pass once ffmpeg lands; absent until then. */
  durationSeconds: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})
export type MediaAssetRecord = z.infer<typeof mediaAssetSchema>

export const assetListSchema = z.object({ assets: z.array(mediaAssetSchema) })
export type AssetList = z.infer<typeof assetListSchema>

export const importQuerySchema = z.object({
  name: z.string().min(1).max(512),
  /** Optional: the browser is often wrong or silent about type, so the server re-derives from the name. */
  mimeType: z.string().min(1).max(255).optional(),
})
export type ImportQuery = z.infer<typeof importQuerySchema>

export const importResultSchema = z.object({
  asset: mediaAssetSchema,
  /** True when the bytes were already in the vault, so nothing was written. */
  deduplicated: z.boolean(),
})
export type ImportResult = z.infer<typeof importResultSchema>

export const errorSchema = z.object({ error: z.string() })
export type ApiError = z.infer<typeof errorSchema>

export const vaultInfoSchema = z.object({
  root: z.string(),
  assetCount: z.number().int().nonnegative(),
  bytesStored: z.number().int().nonnegative(),
})
export type VaultInfo = z.infer<typeof vaultInfoSchema>

/**
 * Project files deliberately validate the stable envelope here and leave editor entities open.
 * Their detailed shapes evolve with the project version and are normalised by the editor's
 * migration layer when loaded. This still rejects malformed project files at the server boundary
 * without forcing the headless server to duplicate every rendering model.
 */
export const editorProjectSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1).max(256),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.number().positive(),
  duration: z.number().positive(),
  backgroundColor: z.string().min(1).max(64),
  updatedAt: z.number().int().nonnegative(),
  version: z.number().int().positive(),
})
export type SharedEditorProject = z.infer<typeof editorProjectSchema>

const editorEntitySchema = z.record(z.string(), z.unknown())
export const serializedProjectSchema = z.object({
  project: editorProjectSchema,
  layers: z.array(editorEntitySchema),
  scenes3D: z.array(editorEntitySchema),
  assets: z.array(editorEntitySchema),
  nodes: z.array(editorEntitySchema),
  nodeConnections: z.array(editorEntitySchema),
  rigs: z.array(editorEntitySchema).default([]),
})
export type SharedSerializedProject = z.infer<typeof serializedProjectSchema>

export const projectListSchema = z.object({ projects: z.array(editorProjectSchema) })
export type ProjectList = z.infer<typeof projectListSchema>

/** Extensions the importer recognises, and the kind each maps to. */
export const EXTENSION_KINDS: Readonly<Record<string, MediaKind>> = Object.freeze({
  mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', avi: 'video', m4v: 'video',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image', tif: 'image', tiff: 'image',
  wav: 'audio', mp3: 'audio', aac: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio',
  glb: 'model3d', gltf: 'model3d',
  hdr: 'hdr', exr: 'hdr',
})

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', m4v: 'video/x-m4v',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  wav: 'audio/wav', mp3: 'audio/mpeg', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  hdr: 'image/vnd.radiance', exr: 'image/x-exr',
})

export function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
}

/** Kind is derived from the extension, which is far more reliable than a browser-reported MIME type. */
export function kindForFile(fileName: string, mimeType?: string): MediaKind {
  const byExtension = EXTENSION_KINDS[extensionOf(fileName)]
  if (byExtension) return byExtension
  const major = mimeType?.split('/')[0]
  if (major === 'video' || major === 'image' || major === 'audio') return major
  return 'video'
}

export function mimeForFile(fileName: string, fallback?: string) {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? fallback ?? 'application/octet-stream'
}

/** Where the app fetches an asset's bytes. Relative, so Vite's proxy and a direct origin both work. */
export function mediaUrl(hash: string) {
  return `/media/${hash}`
}
