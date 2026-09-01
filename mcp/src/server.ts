import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { SerializedEditorState } from '../../src/models/editor.ts'
import { ProjectRepository } from '../../server/src/projects/ProjectRepository.ts'
import { ensureVault, vaultLayout } from '../../server/src/storage/paths.ts'
import { createNeonSingularityProject, createPillarRunProject } from './showcase.ts'
import { MCP_INFLUENCE_TYPES, upsertProjectInfluence } from './influenceMutation.ts'

export async function createAuroraMcpServer(root?: string) {
  const layout = await ensureVault(vaultLayout(root))
  const projects = new ProjectRepository(layout)
  const server = new McpServer({ name: 'aurora-editor', version: '0.1.0' })

  server.registerTool('aurora_project_list', {
    title: 'List Aurora projects',
    description: 'Lists editable Aurora projects in the local vault, newest first.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const list = await projects.list()
    return { content: [{ type: 'text', text: JSON.stringify({ projects: list }, null, 2) }] }
  })

  server.registerTool('aurora_project_get', {
    title: 'Read an Aurora project',
    description: 'Returns the complete editable Aurora project, including layers, animation, nodes, rigs, and 3D scenes.',
    inputSchema: z.object({ projectId: z.string().min(1).describe('Aurora project id') }),
    annotations: { readOnlyHint: true },
  }, async ({ projectId }) => {
    const snapshot = await projects.load(projectId)
    return snapshot
      ? { content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] }
      : { isError: true, content: [{ type: 'text', text: `Unknown Aurora project: ${projectId}` }] }
  })

  server.registerTool('aurora_project_create_showcase', {
    title: 'Create Neon Singularity showcase',
    description: 'Creates and activates a polished, fully editable 12-second Aurora composition with 2D keyframes, a reusable HUD cluster, a compositing node graph, and an animated 3D scene.',
    inputSchema: z.object({
      name: z.string().min(1).max(256).optional().describe('Optional project name'),
      projectId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional().describe('Optional existing id to replace in place'),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async ({ name, projectId }) => {
    const snapshot = createNeonSingularityProject(name, projectId)
    await projects.save(snapshot)
    const summary = {
      projectId: snapshot.project.id,
      name: snapshot.project.name,
      duration: snapshot.project.duration,
      layers: snapshot.layers.length,
      keyframes: JSON.stringify(snapshot).match(/"interpolation"/g)?.length ?? 0,
      nodes: snapshot.nodes.length,
      objects3D: snapshot.scenes3D.reduce((sum, scene) => sum + scene.objects.length, 0),
      vault: layout.root,
    }
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
  })

  server.registerTool('aurora_project_create_pillar_run', {
    title: 'Create Pillar Run drone showcase',
    description: 'Creates and activates a polished neon canyon with six pillar gates, an animated modular drone, a cinematic chase camera, lighting, overlays, and compositing nodes.',
    inputSchema: z.object({
      name: z.string().min(1).max(256).optional().describe('Optional project name'),
      projectId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional().describe('Optional existing id to replace in place'),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async ({ name, projectId }) => {
    const snapshot = createPillarRunProject(name, projectId)
    await projects.save(snapshot)
    const scene = snapshot.scenes3D[0]!
    const summary = {
      projectId: snapshot.project.id,
      name: snapshot.project.name,
      duration: snapshot.project.duration,
      layers: snapshot.layers.length,
      keyframes: JSON.stringify(snapshot).match(/"interpolation"/g)?.length ?? 0,
      nodes: snapshot.nodes.length,
      objects3D: scene.objects.length,
      pillarGates: 6,
      cameraPathPoints: scene.paths[0]?.points.length ?? 0,
      vault: layout.root,
    }
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
  })

  server.registerTool('aurora_scene_object_influence_upsert', {
    title: 'Add or update a 3D object influence',
    description: 'Adds or updates an editable influence stack entry on a mesh or group. Linear arrays on groups repeat the complete child hierarchy.',
    inputSchema: z.object({
      projectId: z.string().min(1).describe('Aurora project id'),
      sceneId: z.string().min(1).describe('3D scene id from aurora_project_get'),
      objectId: z.string().min(1).describe('Mesh or group object id'),
      type: z.enum(MCP_INFLUENCE_TYPES).describe('Influence type'),
      influenceId: z.string().min(1).optional().describe('Existing influence id to update, or a stable id for a new influence'),
      name: z.string().min(1).max(128).optional(),
      enabled: z.boolean().optional(),
      parameters: z.record(z.string(), z.number()).optional().describe('Influence parameter values; omitted parameters use editor defaults'),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async (mutation) => {
    const stored = await projects.load(mutation.projectId)
    if (!stored) return { isError: true, content: [{ type: 'text', text: `Unknown Aurora project: ${mutation.projectId}` }] }
    try {
      const { scene, object, influence } = upsertProjectInfluence(stored as unknown as SerializedEditorState, mutation)
      await projects.save(stored)
      return { content: [{ type: 'text', text: JSON.stringify({
        projectId: mutation.projectId,
        sceneId: scene.id,
        objectId: object.id,
        influence,
        sceneRevision: scene.revision,
      }, null, 2) }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
    }
  })

  return { server, projects, layout }
}

export async function runStdioServer() {
  const { server } = await createAuroraMcpServer()
  await server.connect(new StdioServerTransport())
}
