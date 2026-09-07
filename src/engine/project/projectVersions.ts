import Dexie, { type Table } from 'dexie'
import type { SerializedEditorState } from '@/models/editor'
import { serializeEditorState } from './serialization'
export interface ProjectVersion { id: string; projectId: string; name: string; createdAt: number; snapshot: SerializedEditorState }
export class ProjectVersionDatabase extends Dexie {
  versions!: Table<ProjectVersion, string>
  constructor(name = 'aurora-project-versions') { super(name); this.version(1).stores({ versions: 'id, projectId, createdAt' }) }
  async capture(name: string, state: SerializedEditorState) {
    const version: ProjectVersion = { id: crypto.randomUUID(), projectId: state.project.id, name: name.trim() || 'Snapshot', createdAt: Date.now(), snapshot: JSON.parse(serializeEditorState(state)) }
    await this.versions.add(version)
    return version
  }
}
export const projectVersions = new ProjectVersionDatabase()

export interface SnapshotChange { path: string; before: string; after: string }
export function snapshotDiff(before: unknown, after: unknown): SnapshotChange[] {
  const changes: SnapshotChange[] = []
  const display = (value: unknown) => value === undefined ? '—' : JSON.stringify(value)
  const visit = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every(item => item && typeof item === 'object' && 'id' in item)) {
        const left = new Map(a.map(item => [item.id, item])), right = new Map(b.map(item => [item.id, item]))
        if (a.map(item => item.id).join('|') !== b.map(item => item.id).join('|')) changes.push({ path: `${path} / order`, before: a.map(item => item.name ?? item.id).join(', '), after: b.map(item => item.name ?? item.id).join(', ') })
        for (const id of new Set([...left.keys(), ...right.keys()])) visit(left.get(id), right.get(id), `${path} / ${right.get(id)?.name ?? left.get(id)?.name ?? id}`)
      } else {
        const left = a as Record<string, unknown>, right = b as Record<string, unknown>
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) if (key !== 'updatedAt') visit(left[key], right[key], path ? `${path} / ${key}` : key)
      }
    } else changes.push({ path, before: display(a), after: display(b) })
  }
  visit(before, after, '')
  return changes
}
