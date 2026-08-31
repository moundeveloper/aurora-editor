import { Hono } from 'hono'
import { serializedProjectSchema } from '../../../shared/contracts.ts'
import type { ProjectRepository } from '../projects/ProjectRepository.ts'

export function projectRoutes(projects: ProjectRepository) {
  return new Hono()
    .get('/', async (context) => context.json({ projects: await projects.list() }))
    .get('/active', async (context) => {
      const snapshot = await projects.loadActive()
      return snapshot ? context.json(snapshot) : context.json({ error: 'no active project' }, 404)
    })
    .get('/:id', async (context) => {
      const snapshot = await projects.load(context.req.param('id'))
      return snapshot ? context.json(snapshot) : context.json({ error: 'unknown project' }, 404)
    })
    .put('/:id', async (context) => {
      const parsed = serializedProjectSchema.safeParse(await context.req.json())
      if (!parsed.success) return context.json({ error: parsed.error.issues[0]?.message ?? 'invalid project' }, 400)
      if (parsed.data.project.id !== context.req.param('id')) {
        return context.json({ error: 'route and project ids differ' }, 400)
      }
      return context.json(await projects.save(parsed.data))
    })
    .post('/:id/active', async (context) => {
      try {
        await projects.setActive(context.req.param('id'))
        return context.json({ ok: true })
      } catch {
        return context.json({ error: 'unknown project' }, 404)
      }
    })
}
