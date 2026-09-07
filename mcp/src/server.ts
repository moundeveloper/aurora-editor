import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { SerializedEditorState } from '../../src/models/editor.ts'
import { ProjectRepository } from '../../server/src/projects/ProjectRepository.ts'
import { ensureVault, vaultLayout } from '../../server/src/storage/paths.ts'
import { createNeonSingularityProject, createPillarRunProject } from './showcase.ts'
import { MCP_INFLUENCE_TYPES, upsertProjectInfluence } from './influenceMutation.ts'
import {
  MCP_LIGHT_TYPES, addProjectModel, setProjectCameraLens, setProjectEnvironment, upsertProjectLight,
} from './sceneMutation.ts'

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

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
      targetId: z.string().min(1).optional().describe('Another mesh in the same scene to use as the Boolean operand'),
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

  const animatable = (description: string) => z.object({
    value: z.number().optional(),
    keyframes: z.array(z.object({ time: z.number().min(0), value: z.number() })).optional()
      .describe('Animation curve; two or more entries animate the channel, an empty list clears it'),
  }).optional().describe(description)

  /** Either a fixed triple, or a per-axis curve for a light or object that has to travel. */
  const vector3 = (description: string) => z.union([
    z.tuple([z.number(), z.number(), z.number()]),
    z.object({ x: animatable('X channel'), y: animatable('Y channel'), z: animatable('Z channel') }),
  ]).optional().describe(`${description}. Either [x, y, z], or per-axis channels that accept keyframes`)

  /** Every mutation tool loads, edits, and saves the same document the editor writes. */
  async function mutate<T>(projectId: string, apply: (snapshot: SerializedEditorState) => T) {
    const stored = await projects.load(projectId)
    if (!stored) return { isError: true as const, content: [{ type: 'text' as const, text: `Unknown Aurora project: ${projectId}` }] }
    try {
      const summary = apply(stored as unknown as SerializedEditorState)
      await projects.save(stored)
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] }
    } catch (error) {
      return { isError: true as const, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }
    }
  }

  server.registerTool('aurora_scene_camera_lens_set', {
    title: 'Set a camera lens focus and aperture',
    description: 'Switches depth of field on for a perspective camera and sets its focus distance and f-number. Both channels take keyframes, so a focus pull can be authored in one call. Lower f-numbers shrink the sharp range and grow the bokeh.',
    inputSchema: z.object({
      projectId: z.string().min(1).describe('Aurora project id'),
      sceneId: z.string().min(1).describe('3D scene id from aurora_project_get'),
      cameraId: z.string().min(1).describe('Camera id from aurora_project_get'),
      depthOfField: z.boolean().optional().describe('Off keeps every depth pin-sharp'),
      focusDistance: animatable('Distance to the sharp plane, in scene units'),
      fStop: animatable('Lens f-number, 1 to 22'),
    }),
    annotations: { destructiveHint: false, idempotentHint: true },
  }, async (mutation) => mutate(mutation.projectId, (snapshot) => {
    const { scene, camera } = setProjectCameraLens(snapshot, mutation)
    return {
      projectId: mutation.projectId, sceneId: scene.id, cameraId: camera.id,
      depthOfField: camera.depthOfField, focusDistance: camera.focusDistance, fStop: camera.fStop,
      sceneRevision: scene.revision,
    }
  }))

  server.registerTool('aurora_scene_light_upsert', {
    title: 'Add or update a light',
    description: 'Adds or updates an ambient, directional, point, or spot light. A spot also takes a cone angle, range, and edge softness. Local -Z is the beam, so rotation is what aims a directional or spot light. A spot range of zero lights to infinity; any other value hard-stops the beam at that distance however bright it is.',
    inputSchema: z.object({
      projectId: z.string().min(1).describe('Aurora project id'),
      sceneId: z.string().min(1).describe('3D scene id from aurora_project_get'),
      lightId: z.string().min(1).optional().describe('Existing light id to update, or a stable id for a new light'),
      type: z.enum(MCP_LIGHT_TYPES).describe('Light type'),
      name: z.string().min(1).max(128).optional(),
      color: z.string().regex(HEX_COLOUR).optional().describe('Hex colour such as #2cecff'),
      visible: z.boolean().optional(),
      castShadow: z.boolean().optional(),
      intensity: animatable('Light intensity'),
      position: vector3('Scene-space position'),
      rotation: vector3('Euler degrees; local -Z is the beam direction'),
      angle: animatable('Spot only: cone half-angle in degrees, 1 to 89'),
      distance: animatable('Spot only: range in scene units, or 0 for unlimited'),
      penumbra: animatable('Spot only: cone edge softness, 0 to 1'),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async (mutation) => mutate(mutation.projectId, (snapshot) => {
    const { scene, light } = upsertProjectLight(snapshot, mutation)
    return { projectId: mutation.projectId, sceneId: scene.id, light, sceneRevision: scene.revision }
  }))

  server.registerTool('aurora_scene_environment_set', {
    title: 'Light a scene from a radiance map',
    description: 'Points a 3D scene at an imported .hdr or .exr asset, which lights every material and can also be drawn as the background. Pass a null assetId to drop back to the flat background colour.',
    inputSchema: z.object({
      projectId: z.string().min(1).describe('Aurora project id'),
      sceneId: z.string().min(1).describe('3D scene id from aurora_project_get'),
      assetId: z.string().min(1).nullable().describe('Imported asset of kind hdr, or null to clear'),
      background: z.boolean().optional().describe('Draw the map behind the scene instead of the flat colour'),
      intensity: z.number().min(0).max(8).optional().describe('Environment strength'),
    }),
    annotations: { destructiveHint: false, idempotentHint: true },
  }, async (mutation) => mutate(mutation.projectId, (snapshot) => {
    const { scene } = setProjectEnvironment(snapshot, mutation)
    return {
      projectId: mutation.projectId, sceneId: scene.id, environmentAssetId: scene.environmentAssetId ?? null,
      environmentBackground: scene.environmentBackground, environmentIntensity: scene.environmentIntensity,
      sceneRevision: scene.revision,
    }
  }))

  server.registerTool('aurora_scene_model_add', {
    title: 'Place an imported glTF mesh',
    description: 'Adds an imported .glb or .gltf asset to a 3D scene as a model object. The file keeps its own materials and node hierarchy, so Aurora material and influence edits do not apply to it; its transform and shadow flags do.',
    inputSchema: z.object({
      projectId: z.string().min(1).describe('Aurora project id'),
      sceneId: z.string().min(1).describe('3D scene id from aurora_project_get'),
      assetId: z.string().min(1).describe('Imported asset of kind model3d'),
      objectId: z.string().min(1).optional().describe('Stable id for the new object'),
      name: z.string().min(1).max(128).optional(),
      parentId: z.string().min(1).optional().describe('Group object to parent this mesh to'),
      position: vector3('Scene-space position'),
      rotation: vector3('Euler degrees'),
      scale: vector3('Per-axis scale'),
      castShadow: z.boolean().optional(),
      receiveShadow: z.boolean().optional(),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async (mutation) => mutate(mutation.projectId, (snapshot) => {
    const { scene, object } = addProjectModel(snapshot, mutation)
    return {
      projectId: mutation.projectId, sceneId: scene.id, objectId: object.id, name: object.name,
      assetId: object.assetId, sceneRevision: scene.revision,
    }
  }))

  return { server, projects, layout }
}

export async function runStdioServer() {
  const { server } = await createAuroraMcpServer()
  await server.connect(new StdioServerTransport())
}
