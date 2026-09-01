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
