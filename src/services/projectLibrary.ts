import type { EditorProject, SerializedEditorState } from '@/models/editor'
import { auroraProjectDatabase } from '@/engine/project/AuroraProjectDatabase'

const PROJECT_API = '/api/projects'

async function serverSnapshot(path: string): Promise<SerializedEditorState | null> {
  try {
    const response = await fetch(`${PROJECT_API}${path}`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`project server returned ${response.status}`)
    return await response.json() as SerializedEditorState
  } catch {
    return null
  }
}

async function saveToServer(snapshot: SerializedEditorState) {
  const response = await fetch(`${PROJECT_API}/${encodeURIComponent(snapshot.project.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
  if (!response.ok) throw new Error(`project server returned ${response.status}`)
}

/**
 * Project persistence bridge. IndexedDB remains an offline mirror, while the local Aurora server
 * is authoritative whenever it is available so projects authored by MCP appear in the same picker.
 */
class AuroraProjectLibrary {
  async saveSnapshot(snapshot: SerializedEditorState) {
    await auroraProjectDatabase.saveSnapshot(snapshot)
    try { await saveToServer(snapshot) } catch { /* The editor remains fully usable offline. */ }
  }

  async loadSnapshot(projectId: string): Promise<SerializedEditorState | null> {
    const fromServer = await serverSnapshot(`/${encodeURIComponent(projectId)}`)
    if (fromServer) {
      await auroraProjectDatabase.saveSnapshot(fromServer)
      return fromServer
    }
    return auroraProjectDatabase.loadSnapshot(projectId)
  }

  async loadActiveSnapshot(): Promise<SerializedEditorState | null> {
    const fromServer = await serverSnapshot('/active')
    if (fromServer) {
      await auroraProjectDatabase.saveSnapshot(fromServer)
      return fromServer
    }
    return auroraProjectDatabase.loadActiveSnapshot()
  }

  async listProjects(): Promise<EditorProject[]> {
    const local = await auroraProjectDatabase.listProjects()
    try {
      const response = await fetch(PROJECT_API)
      if (!response.ok) return local
      const remote = (await response.json() as { projects: EditorProject[] }).projects
      const combined = new Map(local.map((project) => [project.id, project]))
      for (const project of remote) combined.set(project.id, project)
      return [...combined.values()].sort((left, right) => right.updatedAt - left.updatedAt)
    } catch {
      return local
    }
  }

  async setActiveProject(projectId: string) {
    await auroraProjectDatabase.setActiveProject(projectId)
    try { await fetch(`${PROJECT_API}/${encodeURIComponent(projectId)}/active`, { method: 'POST' }) } catch { /* offline */ }
  }
}

export const auroraProjectLibrary = new AuroraProjectLibrary()
