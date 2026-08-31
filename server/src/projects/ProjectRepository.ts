import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
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

export class ProjectRepository {
  private readonly layout: VaultLayout

  constructor(layout: VaultLayout) {
    this.layout = layout
  }

  private projectPath(projectId: string) {
    const validated = editorProjectSchema.shape.id.parse(projectId)
    return join(this.layout.projects, `${validated}${PROJECT_SUFFIX}`)
  }

  private async readProject(path: string): Promise<SharedSerializedProject | null> {
    try {
      return serializedProjectSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async save(snapshot: unknown): Promise<SharedSerializedProject> {
    const parsed = serializedProjectSchema.parse(snapshot)
    const target = this.projectPath(parsed.project.id)
    const temporary = join(this.layout.temp, `${parsed.project.id}-${process.pid}-${Date.now()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    await rename(temporary, target)
    await this.setActive(parsed.project.id)
    return parsed
  }

  load(projectId: string) {
    return this.readProject(this.projectPath(projectId))
  }

  async list(): Promise<SharedEditorProject[]> {
    const entries = await readdir(this.layout.projects, { withFileTypes: true })
    const projects = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(PROJECT_SUFFIX))
      .map(async (entry) => (await this.readProject(join(this.layout.projects, entry.name)))?.project ?? null))
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
