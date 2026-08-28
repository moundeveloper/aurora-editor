import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { isContentHash, blobPath, type VaultLayout } from '../storage/paths.ts'
import { blobStats } from '../storage/blobs.ts'
import type { AssetIndex } from '../storage/db.ts'

interface MediaDeps { layout: VaultLayout; index: AssetIndex }

/** `bytes=start-end`, where either side may be blank. Returns null for anything malformed. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  // A suffix range (`bytes=-500`) asks for the final N bytes.
  if (!rawStart) {
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return null
    return { start: Math.max(0, size - length), end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return null
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
  if (!Number.isFinite(end) || end < start) return null
  return { start, end }
}

export function mediaRoutes({ layout, index }: MediaDeps) {
  return new Hono()
    /**
     * Serves a blob by content address, honouring Range so a `<video>` can seek without pulling the
     * whole file. Blobs are immutable by construction, hence the permanent cache headers.
     */
    .get('/:hash', async (context) => {
      const hash = context.req.param('hash')
      if (!isContentHash(hash)) return context.json({ error: 'not a content hash' }, 400)

      const stats = await blobStats(layout, hash)
      if (!stats?.isFile()) return context.json({ error: 'unknown blob' }, 404)

      const record = index.byHash(hash)
      const headers: Record<string, string> = {
        'Content-Type': record?.mimeType ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `"${hash}"`,
      }

      if (context.req.header('if-none-match') === headers.ETag) return context.body(null, 304, headers)

      const range = parseRange(context.req.header('range'), stats.size)
      if (!range) {
        if (context.req.header('range')) {
          return context.body(null, 416, { ...headers, 'Content-Range': `bytes */${stats.size}` })
        }
        headers['Content-Length'] = String(stats.size)
        if (context.req.method === 'HEAD') return context.body(null, 200, headers)
        return context.body(Readable.toWeb(createReadStream(blobPath(layout, hash))) as ReadableStream, 200, headers)
      }

      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stats.size}`
      headers['Content-Length'] = String(range.end - range.start + 1)
      if (context.req.method === 'HEAD') return context.body(null, 206, headers)
      const stream = createReadStream(blobPath(layout, hash), { start: range.start, end: range.end })
      return context.body(Readable.toWeb(stream) as ReadableStream, 206, headers)
    })
}
