import type { EditorProject, SerializedEditorState } from '@/models/editor'
import { auroraProjectDatabase } from '@/engine/project/AuroraProjectDatabase'

const PROJECT_API = '/api/projects'
const serverVersions = new Map<string,string>()
const recoveryProjects = new Map<string,string>()
export class ProjectSaveConflict extends Error {}

async function serverSnapshot(path: string): Promise<SerializedEditorState | null> {
  try {
    const response = await fetch(`${PROJECT_API}${path}`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`project server returned ${response.status}`)
    const snapshot = await response.json() as SerializedEditorState
    const version = response.headers.get('ETag')
    if (version) serverVersions.set(snapshot.project.id,version)
    return snapshot
  } catch {
    return null
  }
}

async function saveToServer(snapshot: SerializedEditorState) {
  const response = await fetch(`${PROJECT_API}/${encodeURIComponent(snapshot.project.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'If-Match': serverVersions.get(snapshot.project.id) ?? 'new' },
    body: JSON.stringify(snapshot),
  })
  if (response.status===409) throw new ProjectSaveConflict((await response.json()).error)
  if (!response.ok) throw new Error(`project server returned ${response.status}`)
  const version=response.headers.get('ETag')
  if(version) serverVersions.set(snapshot.project.id,version)
}

/**
 * Project persistence bridge. IndexedDB remains an offline mirror, while the local Aurora server
 * is authoritative whenever it is available so projects authored by MCP appear in the same picker.
 */
class AuroraProjectLibrary {
  async saveSnapshot(snapshot: SerializedEditorState) {
    await auroraProjectDatabase.saveSnapshot(snapshot)
    try { await saveToServer(snapshot) } catch (error) {
      if (error instanceof ProjectSaveConflict) {
        // Reopening a remote project refreshes its local mirror. Preserve a separate local branch
        // first, so resolving a conflict cannot destroy the user's unsynchronized edits.
        const recoveryId = recoveryProjects.get(snapshot.project.id) ?? `${snapshot.project.id.slice(0,80)}-recovery-${crypto.randomUUID()}`
        recoveryProjects.set(snapshot.project.id,recoveryId)
        const recovery = JSON.parse(JSON.stringify(snapshot)) as SerializedEditorState
        recovery.project.id=recoveryId
        recovery.project.name=`${snapshot.project.name} — Local recovery`
        await auroraProjectDatabase.saveSnapshot(recovery)
        await auroraProjectDatabase.setActiveProject(snapshot.project.id)
        throw new ProjectSaveConflict(`Project changed in another session. Your edits are saved in “${recovery.project.name}” in the project browser. Reopen the original to load remote changes.`)
      }
      // The local mirror remains available when the server is offline.
    }
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
