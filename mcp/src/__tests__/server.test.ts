import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuroraMcpServer } from '../server.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Aurora MCP influence authoring', () => {
  it('updates a group array through the protocol and persists the editable parameters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aurora-mcp-influence-'))
    temporaryRoots.push(root)
    const { server, projects } = await createAuroraMcpServer(root)
    const client = new Client({ name: 'influence-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      await client.callTool({
        name: 'aurora_project_create_pillar_run',
        arguments: { name: 'Array Protocol Test', projectId: 'array-protocol-test' },
      })
      const result = await client.callTool({
        name: 'aurora_scene_object_influence_upsert',
        arguments: {
          projectId: 'array-protocol-test', sceneId: 'scene-pillar-run', objectId: 'gate-cyan-array',
          type: 'array', influenceId: 'gate-cyan-array-repeat', parameters: { count: 4, offsetZ: -8 },
        },
      })

      expect(result.isError).not.toBe(true)
      const stored = await projects.load('array-protocol-test')
      const scene = stored?.scenes3D[0] as { objects: Array<{ id: string; influences: Array<{ parameters: Record<string, { value: number }> }> }> }
      const influence = scene.objects.find((object) => object.id === 'gate-cyan-array')?.influences[0]
      expect(influence?.parameters.count?.value).toBe(4)
      expect(influence?.parameters.offsetZ?.value).toBe(-8)
    } finally {
      await client.close()
      await server.close()
    }
  })
})

describe('Aurora MCP scene authoring', () => {
  it('advertises the scene mutation tools and persists a focus pull and a spot cone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aurora-mcp-scene-'))
    temporaryRoots.push(root)
    const { server, projects } = await createAuroraMcpServer(root)
    const client = new Client({ name: 'scene-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const advertised = (await client.listTools()).tools.map((tool) => tool.name)
      expect(advertised).toContain('aurora_scene_camera_lens_set')
      expect(advertised).toContain('aurora_scene_light_upsert')
      expect(advertised).toContain('aurora_scene_environment_set')
      expect(advertised).toContain('aurora_scene_model_add')

      await client.callTool({
        name: 'aurora_project_create_pillar_run',
        arguments: { name: 'Scene Protocol Test', projectId: 'scene-protocol-test' },
      })
      const lens = await client.callTool({
        name: 'aurora_scene_camera_lens_set',
        arguments: {
          projectId: 'scene-protocol-test', sceneId: 'scene-pillar-run', cameraId: 'camera-drone-chase',
          depthOfField: true, fStop: { value: 1.8 },
          focusDistance: { keyframes: [{ time: 0, value: 3 }, { time: 6, value: 14 }] },
        },
      })
      const spot = await client.callTool({
        name: 'aurora_scene_light_upsert',
        arguments: {
          projectId: 'scene-protocol-test', sceneId: 'scene-pillar-run', lightId: 'protocol-spot',
          type: 'spot', name: 'Protocol Spot', intensity: { value: 64 }, position: [0, 9, 2],
          rotation: [-90, 0, 0], angle: { value: 24 },
        },
      })

      expect(lens.isError).not.toBe(true)
      expect(spot.isError).not.toBe(true)
      const stored = await projects.load('scene-protocol-test')
      const scene = stored?.scenes3D[0] as {
        cameras: Array<{ id: string; depthOfField?: boolean; fStop?: { value: number }; focusDistance?: { animated: boolean; keyframes: unknown[] } }>
        lights: Array<{ id: string; type: string; angle?: { value: number }; distance?: { value: number } }>
      }
      const camera = scene.cameras.find((item) => item.id === 'camera-drone-chase')
      expect(camera?.depthOfField).toBe(true)
      expect(camera?.fStop?.value).toBe(1.8)
      expect(camera?.focusDistance?.animated).toBe(true)
      expect(camera?.focusDistance?.keyframes).toHaveLength(2)
      const light = scene.lights.find((item) => item.id === 'protocol-spot')
      expect(light?.type).toBe('spot')
      expect(light?.angle?.value).toBe(24)
      expect(light?.distance?.value).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('reports a bad target as a tool error rather than throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aurora-mcp-scene-error-'))
    temporaryRoots.push(root)
    const { server } = await createAuroraMcpServer(root)
    const client = new Client({ name: 'scene-error-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      await client.callTool({
        name: 'aurora_project_create_pillar_run',
        arguments: { name: 'Scene Error Test', projectId: 'scene-error-test' },
      })
      const missingProject = await client.callTool({
        name: 'aurora_scene_camera_lens_set',
        arguments: { projectId: 'no-such-project', sceneId: 'scene-pillar-run', cameraId: 'camera-drone-chase' },
      })
      const missingCamera = await client.callTool({
        name: 'aurora_scene_camera_lens_set',
        arguments: { projectId: 'scene-error-test', sceneId: 'scene-pillar-run', cameraId: 'no-such-camera' },
      })

      expect(missingProject.isError).toBe(true)
      expect(missingCamera.isError).toBe(true)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
