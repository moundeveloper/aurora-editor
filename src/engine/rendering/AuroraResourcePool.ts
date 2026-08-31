export interface AuroraResourcePoolStats {
  created: number
  reused: number
  resident: number
  inUse: number
}

interface PoolEntry<Resource> {
  key: string
  resource: Resource
  inUse: boolean
  lastUsedFrame: number
}

/**
 * Descriptor-keyed transient resource pool. Render targets with non-overlapping graph lifetimes can
 * reuse the same allocation instead of asking the GPU driver for memory during playback.
 */
export class AuroraResourcePool<Resource> {
  private readonly entries: Array<PoolEntry<Resource>> = []
  private frame = 0
  private created = 0
  private reused = 0

  constructor(
    private readonly create: (key: string) => Resource,
    private readonly destroy: (resource: Resource) => void,
    private readonly maxIdleFrames = 120,
  ) {}

  beginFrame() {
    this.frame += 1
  }

  acquire(key: string) {
    const entry = this.entries.find((candidate) => candidate.key === key && !candidate.inUse)
    if (entry) {
      entry.inUse = true
      entry.lastUsedFrame = this.frame
      this.reused += 1
      return entry.resource
    }
    const resource = this.create(key)
    this.entries.push({ key, resource, inUse: true, lastUsedFrame: this.frame })
    this.created += 1
    return resource
  }

  release(resource: Resource) {
    const entry = this.entries.find((candidate) => candidate.resource === resource)
    if (!entry) throw new Error('cannot release a resource owned by another Aurora pool')
    entry.inUse = false
    entry.lastUsedFrame = this.frame
  }

  endFrame() {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]!
      if (entry.inUse || this.frame - entry.lastUsedFrame <= this.maxIdleFrames) continue
      this.destroy(entry.resource)
      this.entries.splice(index, 1)
    }
  }

  stats(): AuroraResourcePoolStats {
    return {
      created: this.created,
      reused: this.reused,
      resident: this.entries.length,
      inUse: this.entries.filter((entry) => entry.inUse).length,
    }
  }

  dispose() {
    this.entries.forEach((entry) => this.destroy(entry.resource))
    this.entries.length = 0
  }
}
