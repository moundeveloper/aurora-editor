import Dexie, { type Table } from 'dexie'
import type {
  Aurora3DScene, EditorLayer, EditorNode, EditorNodeConnection, EditorProject, MediaAsset, SerializedEditorState,
} from '@/models/editor'

interface OrderedProjectRecord<T> {
  key: string
  projectId: string
  order: number
  value: T
}

interface DatabaseSetting {
  key: string
  value: string
}

export class AuroraProjectDatabase extends Dexie {
  projects!: Table<EditorProject, string>
  layers!: Table<OrderedProjectRecord<EditorLayer>, string>
  scenes3D!: Table<OrderedProjectRecord<Aurora3DScene>, string>
  assets!: Table<OrderedProjectRecord<MediaAsset>, string>
  nodes!: Table<OrderedProjectRecord<EditorNode>, string>
  nodeConnections!: Table<OrderedProjectRecord<EditorNodeConnection>, string>
  settings!: Table<DatabaseSetting, string>

  constructor(name = 'aurora-editor') {
    super(name)
    this.version(1).stores({
      projects: 'id, updatedAt',
      layers: '&key, projectId, [projectId+order]',
      scenes3D: '&key, projectId, [projectId+order]',
      assets: '&key, projectId, [projectId+order]',
      settings: 'key',
    })
    this.version(2).stores({
      nodes: '&key, projectId, [projectId+order]',
      nodeConnections: '&key, projectId, [projectId+order]',
    })
  }

  async saveSnapshot(snapshot: SerializedEditorState) {
    const projectId = snapshot.project.id
    const ordered = <T extends { id: string }>(values: T[]): OrderedProjectRecord<T>[] => values.map((value, order) => ({
      key: `${projectId}:${value.id}`,
      projectId,
      order,
      value,
    }))
    await this.transaction('rw', [this.projects, this.layers, this.scenes3D, this.assets, this.nodes, this.nodeConnections, this.settings], async () => {
      await this.projects.put(snapshot.project)
      await Promise.all([
        this.layers.where('projectId').equals(projectId).delete(),
        this.scenes3D.where('projectId').equals(projectId).delete(),
        this.assets.where('projectId').equals(projectId).delete(),
        this.nodes.where('projectId').equals(projectId).delete(),
        this.nodeConnections.where('projectId').equals(projectId).delete(),
      ])
      await Promise.all([
        this.layers.bulkPut(ordered(snapshot.layers)),
        this.scenes3D.bulkPut(ordered(snapshot.scenes3D)),
        this.assets.bulkPut(ordered(snapshot.assets)),
        this.nodes.bulkPut(ordered(snapshot.nodes)),
        this.nodeConnections.bulkPut(ordered(snapshot.nodeConnections)),
        this.settings.put({ key: 'active-project-id', value: projectId }),
      ])
    })
  }

  async loadSnapshot(projectId: string): Promise<SerializedEditorState | null> {
    return this.transaction('r', [this.projects, this.layers, this.scenes3D, this.assets, this.nodes, this.nodeConnections], async () => {
      const project = await this.projects.get(projectId)
      if (!project) return null
      const [layers, scenes3D, assets, nodes, nodeConnections] = await Promise.all([
        this.layers.where('projectId').equals(projectId).sortBy('order'),
        this.scenes3D.where('projectId').equals(projectId).sortBy('order'),
        this.assets.where('projectId').equals(projectId).sortBy('order'),
        this.nodes.where('projectId').equals(projectId).sortBy('order'),
        this.nodeConnections.where('projectId').equals(projectId).sortBy('order'),
      ])
      return {
        project,
        layers: layers.map((record) => record.value),
        scenes3D: scenes3D.map((record) => record.value),
        assets: assets.map((record) => record.value),
        nodes: nodes.map((record) => record.value),
        nodeConnections: nodeConnections.map((record) => record.value),
      }
    })
  }

  async loadActiveSnapshot(): Promise<SerializedEditorState | null> {
    const activeId = (await this.settings.get('active-project-id'))?.value
    const projectId = activeId ?? (await this.projects.orderBy('updatedAt').last())?.id
    return projectId ? this.loadSnapshot(projectId) : null
  }
}

export const auroraProjectDatabase = new AuroraProjectDatabase()
