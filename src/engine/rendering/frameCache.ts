import Dexie, { type Table } from 'dexie'
import { resolveRenderSize, type CachedFramePixels, type RenderFrameRequest, type RenderQuality } from '@/engine/rendering/contracts'

export interface FrameCacheAddress {
  key: string
  projectId: string
  revision: number
  frame: number
  frameRate: number
  scope: string
  width: number
  height: number
  quality: RenderQuality
}

export interface FrameCacheEntry extends FrameCacheAddress, CachedFramePixels {}

export interface FrameCacheStore {
  get(address: FrameCacheAddress): Promise<CachedFramePixels | null>
  put(entry: FrameCacheEntry): Promise<void>
  clearProject(projectId: string): Promise<void>
}

interface StoredFrame extends Omit<FrameCacheEntry, 'data'> {
  data: ArrayBuffer
  bytes: number
  accessedAt: number
}

const safePart = (value: string | number) => encodeURIComponent(String(value))

export function frameCacheAddress(request: RenderFrameRequest, quality: RenderQuality): FrameCacheAddress {
  const frameRate = Math.max(1, request.project.frameRate)
  const size = resolveRenderSize(request.width, request.height, quality)
  const frame = Math.max(0, Math.round(request.time * frameRate))
  const revision = request.revision ?? -1
  const scope = request.cacheScope ?? `layers:${request.layers.map((layer) => layer.id).join(',')}`
  const version = request.cacheVersion ?? revision
  const parts = [
    request.project.id, request.project.updatedAt, version, scope, request.renderRootNodeId ?? 'composite',
    frame, frameRate, size.width, size.height, quality,
  ]
  return {
    key: parts.map(safePart).join('|'),
    projectId: request.project.id,
    revision,
    frame,
    frameRate,
    scope,
    width: size.width,
    height: size.height,
    quality,
  }
}

/** How stale a cached frame's recorded access time may be before a read refreshes it. */
const ACCESS_STAMP_INTERVAL_MS = 30_000

/** IndexedDB-backed LRU storage. Raw RGBA avoids codec drift and makes cache replay deterministic. */
export class AuroraFrameCacheDatabase extends Dexie implements FrameCacheStore {
  frames!: Table<StoredFrame, string>
  private residentBytes: number | null = null
  private readonly touchedAt = new Map<string, number>()

  constructor(name = 'aurora-frame-cache', private readonly maxBytes = 128 * 1024 * 1024) {
    super(name)
    this.version(1).stores({
      frames: '&key, projectId, revision, accessedAt, [projectId+revision]',
    })
  }

  async get(address: FrameCacheAddress): Promise<CachedFramePixels | null> {
    const record = await this.frames.get(address.key)
    if (!record || record.width !== address.width || record.height !== address.height) return null
    /*
     * Playing a cached range reads one frame per displayed frame, so this path has to stay lean in
     * two ways. IndexedDB already hands back a private copy of the buffer, so copying it again cost
     * a full frame memcpy — 3.7MB at 720p — for nothing. And stamping the access time on every read
     * queued a write transaction per frame behind the reads; recency only has to be good enough to
     * order eviction, so it is stamped at most once per interval per frame.
     */
    const now = Date.now()
    if (now - (this.touchedAt.get(record.key) ?? 0) > ACCESS_STAMP_INTERVAL_MS) {
      this.touchedAt.set(record.key, now)
      void this.frames.update(record.key, { accessedAt: now }).catch(() => undefined)
    }
    return { width: record.width, height: record.height, data: new Uint8ClampedArray(record.data) }
  }

  async put(entry: FrameCacheEntry) {
    const existing = await this.frames.get(entry.key)
    const bytes = entry.data.byteLength
    const data = entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + bytes) as ArrayBuffer
    await this.frames.put({ ...entry, data, bytes, accessedAt: Date.now() })
    if (this.residentBytes === null) {
      this.residentBytes = (await this.frames.toArray()).reduce((sum, frame) => sum + frame.bytes, 0)
    } else {
      this.residentBytes += bytes - (existing?.bytes ?? 0)
    }
    while (this.residentBytes > this.maxBytes) {
      const oldest = await this.frames.orderBy('accessedAt').first()
      if (!oldest) break
      await this.frames.delete(oldest.key)
      this.residentBytes -= oldest.bytes
    }
  }

  async clearProject(projectId: string) {
    await this.frames.where('projectId').equals(projectId).delete()
    this.residentBytes = null
  }
}

export const auroraFrameCache = new AuroraFrameCacheDatabase()
