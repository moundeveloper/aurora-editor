import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { AuroraFrameCacheDatabase, frameCacheAddress } from '@/engine/rendering/frameCache'
import type { RenderFrameRequest } from '@/engine/rendering/contracts'

const databases: AuroraFrameCacheDatabase[] = []
const request = (overrides: Partial<RenderFrameRequest> = {}) => ({
  project: { id: 'project-a', updatedAt: 100, width: 1920, height: 1080, frameRate: 25, duration: 10 },
  layers: [], scenes3D: [], revision: 4, cacheScope: 'project', time: 2,
  width: 320, height: 180, quality: 'preview', ...overrides,
} as RenderFrameRequest)

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()))
})

describe('persistent frame cache', () => {
  it('keys frames by edit revision, scope, time, size, and quality', () => {
    const base = frameCacheAddress(request(), 'preview')
    expect(frameCacheAddress(request({ time: 2.001 }), 'preview').key).toBe(base.key)
    expect(frameCacheAddress(request({ time: 2.04 }), 'preview').key).not.toBe(base.key)
    expect(frameCacheAddress(request({ revision: 5 }), 'preview').key).not.toBe(base.key)
    expect(frameCacheAddress(request({ cacheScope: 'cluster:one' }), 'preview').key).not.toBe(base.key)
    expect(frameCacheAddress(request({ width: 640 }), 'preview').key).not.toBe(base.key)
    expect(frameCacheAddress(request(), 'full').key).not.toBe(base.key)
    expect(frameCacheAddress(request({ revision: 99, cacheVersion: 'saved' }), 'preview').key)
      .toBe(frameCacheAddress(request({ revision: 1, cacheVersion: 'saved' }), 'preview').key)
  })

  it('round-trips pixels without sharing mutable buffers', async () => {
    const database = new AuroraFrameCacheDatabase(`frame-cache-${crypto.randomUUID()}`, 1024)
    databases.push(database)
    const address = frameCacheAddress(request(), 'preview')
    const pixels = new Uint8ClampedArray([1, 2, 3, 255])
    await database.put({ ...address, width: 1, height: 1, data: pixels })
    const restored = await database.get({ ...address, width: 1, height: 1 })
    expect([...restored!.data]).toEqual([1, 2, 3, 255])
    restored!.data[0] = 99
    expect([...(await database.get({ ...address, width: 1, height: 1 }))!.data]).toEqual([1, 2, 3, 255])
  })

  it('evicts least-recently-used frames within its byte budget', async () => {
    const database = new AuroraFrameCacheDatabase(`frame-cache-${crypto.randomUUID()}`, 8)
    databases.push(database)
    for (let frame = 0; frame < 3; frame += 1) {
      const address = frameCacheAddress(request({ time: frame / 25 }), 'preview')
      await database.put({ ...address, width: 1, height: 1, data: new Uint8ClampedArray([frame, 0, 0, 255]) })
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    expect(await database.frames.count()).toBe(2)
    expect(await database.get(frameCacheAddress(request({ time: 0 }), 'preview'))).toBeNull()
  })
})
