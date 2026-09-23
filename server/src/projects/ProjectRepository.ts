import { createHash } from 'node:crypto'
import { packGeometry, unpackGeometry } from './geometryStorage.ts'
import { mkdir, rmdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  editorProjectSchema,
  serializedProjectSchema,
  type SharedEditorProject,
  type SharedSerializedProject,
} from '../../../shared/contracts.ts'
import type { VaultLayout } from '../storage/paths.ts'

const PROJECT_SUFFIX = '.aurora.json'
const ACTIVE_PROJECT_FILE = '.active-project.json'

interface ActiveProjectFile { projectId: string }

export function projectETag(snapshot: unknown) { return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') }
export class ProjectConflictError extends Error {
  constructor() { super('Project changed in another session. Your local edits are retained; reopen or reconcile before saving.'); this.name='ProjectConflictError' }
}
export class ProjectRepository {
  private readonly readVersions = new WeakMap<object, string>()
  private readonly layout: VaultLayout

  constructor(layout: VaultLayout) {
    this.layout = layout
  }

  private projectPath(projectId: string) {
    const validated = editorProjectSchema.shape.id.parse(projectId)
    return join(this.layout.projects, `${validated}${PROJECT_SUFFIX}`)
  }

  private async readProject(path: string): Promise<SharedSerializedProject | null> {
    let contents: string
    try {
      contents = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const manifest = serializedProjectSchema.parse(JSON.parse(contents))
    const snapshot = await unpackGeometry(manifest,join(this.layout.projects,'.geometry'))
    this.readVersions.set(snapshot, projectETag(snapshot))
    return snapshot
  }

  async save(snapshot: unknown, expectedVersion?: string): Promise<SharedSerializedProject> {
    const parsed = serializedProjectSchema.parse(snapshot)
    const expected = expectedVersion ?? (typeof snapshot === 'object' && snapshot ? this.readVersions.get(snapshot) : undefined)
    const target = this.projectPath(parsed.project.id)
    // Atomic cross-process exclusion: the HTTP server and STDIO MCP may run separately.
    const lock = `${target}.lock`
    const deadline = Date.now()+3000
    while (true) {
      try { await mkdir(lock); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (Date.now()>deadline) throw new Error('Project writer is busy. Retry after the other save finishes.')
        await new Promise(resolve => setTimeout(resolve,25))
      }
    }
    try {
      const current = await this.load(parsed.project.id)
      if (expected !== undefined && (current ? projectETag(current) : 'new') !== expected) throw new ProjectConflictError()
      const temporary = join(this.layout.temp, `${parsed.project.id}-${process.pid}-${Date.now()}.tmp`)
      const packed=await packGeometry(parsed,join(this.layout.projects,'.geometry'))
      await writeFile(temporary, `${JSON.stringify(packed)}\n`, 'utf8')
      await rename(temporary, target)
      if (typeof snapshot === 'object' && snapshot) this.readVersions.set(snapshot,projectETag(parsed))
      await this.setActive(parsed.project.id)
      return parsed
    } finally { await rmdir(lock) }
  }

  load(projectId: string) {
    return this.readProject(this.projectPath(projectId))
  }

  async list(): Promise<SharedEditorProject[]> {
    const entries = await readdir(this.layout.projects, { withFileTypes: true })
    const projects = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(PROJECT_SUFFIX))
      .map(async (entry) => {
        try {
          // The project picker needs metadata, never decompressed model arrays.
          const manifest=JSON.parse(await readFile(join(this.layout.projects,entry.name),'utf8'))
          return editorProjectSchema.parse(manifest.project)
        } catch(error) {
          if((error as NodeJS.ErrnoException).code==='ENOENT')return null
          throw error
        }
      }))
    return projects
      .filter((project): project is SharedEditorProject => project !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async activeId(): Promise<string | null> {
    try {
      const parsed = JSON.parse(await readFile(join(this.layout.projects, ACTIVE_PROJECT_FILE), 'utf8')) as ActiveProjectFile
      return editorProjectSchema.shape.id.parse(parsed.projectId)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      return null
    }
  }

  async loadActive(): Promise<SharedSerializedProject | null> {
    const activeId = await this.activeId()
    if (activeId) {
      const active = await this.load(activeId)
      if (active) return active
    }
    const [latest] = await this.list()
    return latest ? this.load(latest.id) : null
  }

  async setActive(projectId: string) {
    const validated = editorProjectSchema.shape.id.parse(projectId)
    if (!(await this.load(validated))) throw new Error(`unknown project: ${validated}`)
    await writeFile(
      join(this.layout.projects, ACTIVE_PROJECT_FILE),
      `${JSON.stringify({ projectId: validated } satisfies ActiveProjectFile)}\n`,
      'utf8',
    )
  }
}
