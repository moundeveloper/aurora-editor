import { Hono } from 'hono'
import { assetRoutes } from './routes/assets.ts'
import { mediaRoutes } from './routes/media.ts'
import { projectRoutes } from './routes/projects.ts'
import { ProjectRepository } from './projects/ProjectRepository.ts'
import { AssetIndex } from './storage/db.ts'
import { ensureVault, vaultLayout, type VaultLayout } from './storage/paths.ts'

export interface AuroraServer {
  app: Hono
  layout: VaultLayout
  index: AssetIndex
  projects: ProjectRepository
  close(): void
}

/**
 * Builds the server around a vault. Taking the root as an argument rather than reading the
 * environment keeps it testable: a test can point at a scratch directory and get a real server.
 */
export async function createServer(root?: string): Promise<AuroraServer> {
  const layout = await ensureVault(vaultLayout(root))
  const index = new AssetIndex(layout.database)
  const projects = new ProjectRepository(layout)

  const app = new Hono()
    .get('/api/health', (context) => context.json({ ok: true, vault: layout.root }))
    .route('/api/assets', assetRoutes({ layout, index }))
    .route('/api/projects', projectRoutes(projects))
    .route('/media', mediaRoutes({ layout, index }))
    .onError((error, context) => {
      console.error('[aurora]', error)
      return context.json({ error: error.message }, 500)
    })
    .notFound((context) => context.json({ error: 'no such route' }, 404))

  return { app, layout, index, projects, close: () => index.close() }
}
