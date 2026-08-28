import { Hono } from 'hono'
import { assetRoutes } from './routes/assets.ts'
import { mediaRoutes } from './routes/media.ts'
import { AssetIndex } from './storage/db.ts'
import { ensureVault, vaultLayout, type VaultLayout } from './storage/paths.ts'

export interface AuroraServer {
  app: Hono
  layout: VaultLayout
  index: AssetIndex
  close(): void
}

/**
 * Builds the server around a vault. Taking the root as an argument rather than reading the
 * environment keeps it testable: a test can point at a scratch directory and get a real server.
 */
export async function createServer(root?: string): Promise<AuroraServer> {
  const layout = await ensureVault(vaultLayout(root))
  const index = new AssetIndex(layout.database)

  const app = new Hono()
    .get('/api/health', (context) => context.json({ ok: true, vault: layout.root }))
    .route('/api/assets', assetRoutes({ layout, index }))
    .route('/media', mediaRoutes({ layout, index }))
    .onError((error, context) => {
      console.error('[aurora]', error)
      return context.json({ error: error.message }, 500)
    })
    .notFound((context) => context.json({ error: 'no such route' }, 404))

  return { app, layout, index, close: () => index.close() }
}
