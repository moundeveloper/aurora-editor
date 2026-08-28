import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import {
  importQuerySchema, kindForFile, mimeForFile,
  type ImportResult, type MediaAssetRecord,
} from '../../../shared/contracts.ts'
import { removeBlob, storeBlob } from '../storage/blobs.ts'
import type { VaultLayout } from '../storage/paths.ts'
import type { AssetIndex } from '../storage/db.ts'

interface AssetDeps { layout: VaultLayout; index: AssetIndex }

export function assetRoutes({ layout, index }: AssetDeps) {
  return new Hono()
    .get('/', (context) => context.json({ assets: index.list() }))

    .get('/vault', (context) => context.json({ root: layout.root, ...index.totals() }))

    /**
     * Takes the raw body as the file, with the name in the query rather than a multipart part.
     *
     * Multipart would buffer or re-parse gigabytes to extract one field; a raw stream goes straight
     * from the socket through the hash and into the vault, at constant memory whatever the size.
     */
    .post('/', async (context) => {
      const query = importQuerySchema.safeParse({
        name: context.req.query('name'),
        mimeType: context.req.query('mimeType') || undefined,
      })
      if (!query.success) return context.json({ error: query.error.issues[0]?.message ?? 'bad import query' }, 400)
      if (!context.req.raw.body) return context.json({ error: 'no body to import' }, 400)

      const { hash, sizeBytes } = await storeBlob(layout, Readable.fromWeb(context.req.raw.body as never))

      /*
       * Identical bytes already in the vault answer with the existing record rather than a second
       * entry. Re-importing the same clip is common — dropping a folder twice, say — and it should
       * cost nothing and leave the library unchanged.
       */
      const existing = index.byHash(hash)
      if (existing) {
        return context.json({ asset: existing, deduplicated: true } satisfies ImportResult, 200)
      }

      const record: MediaAssetRecord = {
        id: randomUUID(),
        hash,
        name: query.data.name,
        kind: kindForFile(query.data.name, query.data.mimeType),
        mimeType: mimeForFile(query.data.name, query.data.mimeType),
        sizeBytes,
        importedAt: Date.now(),
      }
      return context.json({ asset: index.insert(record), deduplicated: false } satisfies ImportResult, 201)
    })

    .delete('/:id', async (context) => {
      const record = index.byId(context.req.param('id'))
      if (!record) return context.json({ error: 'unknown asset' }, 404)
      index.remove(record.id)
      // The blob outlives the record while any other record still addresses the same bytes.
      if (index.referenceCount(record.hash) === 0) await removeBlob(layout, record.hash)
      return context.body(null, 204)
    })
}
