import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type AuroraServer } from '../app.ts'
import { blobPath, isContentHash, isInside, safeJoin, vaultLayout } from '../storage/paths.ts'
import { storeBlob } from '../storage/blobs.ts'
import { parseRange } from '../routes/media.ts'
import { assetListSchema, importResultSchema } from '../../../shared/contracts.ts'

describe('vault paths', () => {
  const layout = vaultLayout('/vault')

  it('shards blobs by the first byte of the hash', () => {
    const hash = 'a'.repeat(64)
    expect(blobPath(layout, hash)).toContain(join('media', 'aa', hash))
  })

  it('refuses to build a path from anything that is not a hash', () => {
    for (const bad of ['../etc/passwd', 'A'.repeat(64), 'abc', `${'a'.repeat(63)}/`]) {
      expect(() => blobPath(layout, bad), bad).toThrow()
      expect(isContentHash(bad)).toBe(false)
    }
  })

  it('does not mistake a sibling directory for a child', () => {
    expect(isInside('/vault', '/vault/media/file')).toBe(true)
    expect(isInside('/vault', '/vault')).toBe(true)
    expect(isInside('/vault', '/vault-backup/file')).toBe(false)
  })

  it('rejects relative paths that climb out of the root', () => {
    expect(() => safeJoin('/vault', '../secrets')).toThrow()
    expect(() => safeJoin('/vault', 'media/../../secrets')).toThrow()
    expect(safeJoin('/vault', 'media/clip.mp4')).toContain(join('vault', 'media', 'clip.mp4'))
  })
})

describe('range parsing', () => {
  it('reads both bounds', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
  })

  it('treats a missing end as the rest of the file', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('reads a suffix range as the final bytes', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
  })

  it('clamps an end past the file to the last byte', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('rejects nonsense rather than guessing', () => {
    for (const bad of [undefined, '', 'bytes=', 'bytes=abc-def', 'bytes=900-100', 'bytes=1000-', 'items=0-10']) {
      expect(parseRange(bad, 1000), String(bad)).toBeNull()
    }
  })
})

describe('aurora server', () => {
  let root: string
  let server: AuroraServer

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aurora-test-'))
    server = await createServer(root)
  })

  afterEach(async () => {
    server.close()
    await rm(root, { recursive: true, force: true })
  })

  const importFile = (name: string, body: string) => server.app.request(
    `/api/assets?name=${encodeURIComponent(name)}`,
    { method: 'POST', body },
  )

  it('stores an imported file and lists it', async () => {
    const response = await importFile('ridge.mp4', 'video-bytes')
    expect(response.status).toBe(201)
    const result = importResultSchema.parse(await response.json())
    expect(result.deduplicated).toBe(false)
    expect(result.asset.name).toBe('ridge.mp4')
    expect(result.asset.kind).toBe('video')
    expect(result.asset.mimeType).toBe('video/mp4')
    expect(result.asset.sizeBytes).toBe('video-bytes'.length)

    // The bytes really are on disk, at the address the record names.
    await expect(readFile(blobPath(server.layout, result.asset.hash), 'utf8')).resolves.toBe('video-bytes')

    const listed = assetListSchema.parse(await (await server.app.request('/api/assets')).json())
    expect(listed.assets).toHaveLength(1)
    expect(listed.assets[0]!.id).toBe(result.asset.id)
  })

  it('answers a re-import of identical bytes with the record it already had', async () => {
    const first = importResultSchema.parse(await (await importFile('ridge.mp4', 'same')).json())
    const second = await importFile('ridge-copy.mp4', 'same')
    expect(second.status).toBe(200)
    const repeat = importResultSchema.parse(await second.json())
    expect(repeat.deduplicated).toBe(true)
    expect(repeat.asset.id).toBe(first.asset.id)
    const listed = assetListSchema.parse(await (await server.app.request('/api/assets')).json())
    expect(listed.assets).toHaveLength(1)
  })

  it('derives kind from the extension, not the browser', async () => {
    const cases = [['track.wav', 'audio'], ['still.png', 'image'], ['rig.glb', 'model3d'], ['sky.hdr', 'hdr']] as const
    for (const [name, kind] of cases) {
      const result = importResultSchema.parse(await (await importFile(name, `bytes-for-${name}`)).json())
      expect(result.asset.kind, name).toBe(kind)
    }
  })

  it('serves a blob whole, and by range', async () => {
    const result = importResultSchema.parse(await (await importFile('clip.mp4', '0123456789')).json())
    const url = `/media/${result.asset.hash}`

    const whole = await server.app.request(url)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(whole.headers.get('content-type')).toBe('video/mp4')
    await expect(whole.text()).resolves.toBe('0123456789')

    const partial = await server.app.request(url, { headers: { Range: 'bytes=2-5' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(partial.headers.get('content-length')).toBe('4')
    await expect(partial.text()).resolves.toBe('2345')
  })

  it('answers an unsatisfiable range with 416 rather than the whole file', async () => {
    const result = importResultSchema.parse(await (await importFile('clip.mp4', '0123456789')).json())
    const response = await server.app.request(`/media/${result.asset.hash}`, { headers: { Range: 'bytes=50-60' } })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
  })

  it('revalidates with an etag', async () => {
    const result = importResultSchema.parse(await (await importFile('clip.mp4', 'cached')).json())
    const response = await server.app.request(`/media/${result.asset.hash}`, {
      headers: { 'If-None-Match': `"${result.asset.hash}"` },
    })
    expect(response.status).toBe(304)
  })

  it('refuses a media path that is not a content hash', async () => {
    for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'nope', 'A'.repeat(64)]) {
      expect((await server.app.request(`/media/${bad}`)).status, bad).toBe(400)
    }
  })

  it('keeps the blob while another record still points at it', async () => {
    const first = importResultSchema.parse(await (await importFile('a.mp4', 'shared-bytes')).json())
    // A second record for the same bytes, which dedupe would normally prevent.
    server.index.insert({ ...first.asset, id: 'second', name: 'b.mp4' })

    expect((await server.app.request(`/api/assets/${first.asset.id}`, { method: 'DELETE' })).status).toBe(204)
    await expect(readFile(blobPath(server.layout, first.asset.hash), 'utf8')).resolves.toBe('shared-bytes')

    expect((await server.app.request('/api/assets/second', { method: 'DELETE' })).status).toBe(204)
    await expect(readFile(blobPath(server.layout, first.asset.hash), 'utf8')).rejects.toThrow()
  })

  it('reports the vault it is using', async () => {
    await importFile('clip.mp4', 'some-bytes')
    const info = await (await server.app.request('/api/assets/vault')).json() as { root: string; assetCount: number; bytesStored: number }
    expect(info.root).toBe(server.layout.root)
    expect(info.assetCount).toBe(1)
    expect(info.bytesStored).toBe('some-bytes'.length)
  })

  it('leaves nothing behind when a stream fails part way', async () => {
    const failing = Readable.from((async function* () {
      yield Buffer.from('partial')
      throw new Error('connection lost')
    })())
    await expect(storeBlob(server.layout, failing)).rejects.toThrow('connection lost')
    const { readdir } = await import('node:fs/promises')
    await expect(readdir(server.layout.temp)).resolves.toEqual([])
  })
})
