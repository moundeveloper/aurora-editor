import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { contributingNodeIds } from '@/engine/nodes/evaluateGraph'
import { useEditorStore } from '../editor'

describe('editor history and Library management', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('restores persisted audio graph edits through undo and redo', () => {
    const store = useEditorStore()
    store.setWorkspace('Audio')
    store.audioGraph.nodes[0]!.gain = -12
    expect(store.canUndo).toBe(true)
    store.undo()
    expect(store.audioGraph.nodes[0]!.gain).toBe(0)
    expect(store.canRedo).toBe(true)
    store.redo()
    expect(store.audioGraph.nodes[0]!.gain).toBe(-12)
  })

  it('undoes and redoes project edits globally and restores their workspace context', () => {
    const store = useEditorStore()
    const initialLayerCount = store.layers.length
    store.setWorkspace('Nodes')

    const layer = store.addTimelineLayer('rectangle')
    expect(store.canUndo).toBe(true)
    store.setWorkspace('Motion')

    expect(store.undo()).toBe(true)
    expect(store.workspace).toBe('Nodes')
    expect(store.layers).toHaveLength(initialLayerCount)
    expect(store.layers.some((item) => item.id === layer.id)).toBe(false)
    expect(store.canRedo).toBe(true)

    expect(store.redo()).toBe(true)
    expect(store.workspace).toBe('Nodes')
    expect(store.layers.some((item) => item.id === layer.id)).toBe(true)
  })

  it('exposes named history states and can jump between them without discarding the future', () => {
    const store = useEditorStore()
    const initialCount = store.layers.length
    store.addTimelineLayer('rectangle')
    store.addTimelineLayer('text')

    expect(store.historyEntries).toHaveLength(3)
    expect(store.historyEntries.map((entry) => entry.label)).toEqual(['Project opened', 'Add layer', 'Add layer'])
    const firstEdit = store.historyEntries[1]
    expect(store.jumpToHistory(firstEdit.id)).toBe(true)
    expect(store.layers).toHaveLength(initialCount + 1)
    expect(store.historyEntries.find((entry) => entry.id === firstEdit.id)?.current).toBe(true)
    expect(store.canRedo).toBe(true)

    const latest = store.historyEntries.at(-1)!
    expect(store.jumpToHistory(latest.id)).toBe(true)
    expect(store.layers).toHaveLength(initialCount + 2)
    expect(store.canRedo).toBe(false)
  })

  it('creates and edits independently sized clusters while rejecting duplicate names', () => {
    const store = useEditorStore()
    const cluster = store.createEmptyCluster({ name: 'Portrait Cards', width: 1080, height: 1920 })!
    const asset = store.assets.find((item) => item.id === cluster.assetId)!

    expect(cluster).toMatchObject({ name: 'Portrait Cards', width: 1080, height: 1920 })
    expect(asset).toMatchObject({ name: 'Portrait Cards', dimensions: '1080 × 1920' })
    expect(store.createEmptyCluster({ name: 'portrait cards', width: 1920, height: 1080 })).toBeNull()

    expect(store.updateClusterSettings(asset.id, { name: 'Square Cards', width: 1200, height: 1200 })).toBe(true)
    expect(cluster).toMatchObject({ name: 'Square Cards', width: 1200, height: 1200 })
    expect(asset).toMatchObject({ name: 'Square Cards', dimensions: '1200 × 1200' })
  })

  it('preserves public controls and internal drivers when instantiating a cluster', () => {
    const store = useEditorStore()
    const child = store.addTimelineLayer('text')
    const cluster = store.createEmptyCluster({name:'Driven title',width:800,height:600})!
    cluster.children = [JSON.parse(JSON.stringify(child))]
    const original = cluster.children[0]!
    original.transform.y.driver = {enabled:true,sourceId:original.transform.x.id,expression:'source + 10'}
    cluster.publicParameters = [{id:'control',label:'Title X',propertyId:original.transform.x.id}]
    store.markChanged()
    const copy = store.addAssetToTimeline(cluster.assetId!,3)!
    const copied = copy.children![0]!
    expect(copied.transform.x.id).not.toBe(original.transform.x.id)
    expect(copy.publicParameters![0]!.propertyId).toBe(copied.transform.x.id)
    expect(copied.transform.y.driver!.sourceId).toBe(copied.transform.x.id)
    copied.transform.x.value = 42
    expect(original.transform.x.value).not.toBe(42)
  })

  it('deletes reusable Library assets without deleting their authored layers and can undo it', () => {
    const store = useEditorStore()
    const cluster = store.createEmptyCluster({ name: 'Reusable Cluster', width: 1280, height: 720 })!
    const assetId = cluster.assetId!

    expect(store.deleteMediaAsset(assetId)).toBe(true)
    expect(store.assets.some((asset) => asset.id === assetId)).toBe(false)
    expect(store.layers.some((layer) => layer.id === cluster.id)).toBe(true)
    expect(cluster.assetId).toBeUndefined()
    expect(cluster.libraryPublished).toBe(false)

    expect(store.undo()).toBe(true)
    const restored = store.layers.find((layer) => layer.id === cluster.id)
    expect(store.assets.some((asset) => asset.id === assetId)).toBe(true)
    expect(restored?.assetId).toBe(assetId)
  })

  it('unlinks ordinary media references when deleting an imported-style asset', () => {
    const store = useEditorStore()
    const layer = store.addAssetToTimeline('asset-logo', 0)!

    expect(store.mediaAssetReferenceCount('asset-logo')).toBe(1)
    expect(store.deleteMediaAsset('asset-logo')).toBe(true)
    expect(layer.assetId).toBeUndefined()
    expect(store.assets.some((asset) => asset.id === 'asset-logo')).toBe(false)
  })

  it('adds, edits, navigates, deletes, and undoes project timeline markers', () => {
    const store = useEditorStore()
    store.setTime(2)
    const first = store.addTimelineMarker('Intro', '#a5b4fc')!
    store.setTime(7)
    const second = store.addTimelineMarker('Drop', '#69d49e')!

    expect(store.timelineMarkers.map((marker) => marker.name)).toEqual(['Intro', 'Drop'])
    store.setTime(4)
    expect(store.jumpToAdjacentTimelineMarker(-1)).toBe(true)
    expect(store.currentTime).toBe(2)
    expect(store.jumpToAdjacentTimelineMarker(1)).toBe(true)
    expect(store.currentTime).toBe(7)

    expect(store.updateTimelineMarker(second.id, { name: 'Beat drop', time: 6 })).toBe(true)
    expect(store.timelineMarkers[1]).toMatchObject({ id: second.id, name: 'Beat drop', time: 6 })
    expect(store.deleteTimelineMarker(first.id)).toBe(true)
    expect(store.timelineMarkers).toHaveLength(1)
    expect(store.undo()).toBe(true)
    expect(store.timelineMarkers.map((marker) => marker.id)).toContain(first.id)
  })

  it('connects newly created and reused 3D scenes to the Motion render graph', () => {
    const store = useEditorStore()
    const sceneLayer = store.addTimelineLayer('3d-scene')
    const source = store.nodes.find((node) => node.sourceId === sceneLayer.id)

    expect(source?.kind).toBe('scene3d')
    expect(contributingNodeIds(store.nodes, store.nodeConnections, store.renderRootNodeId)).toContain(source!.id)

    const copy = store.addAssetToTimeline(sceneLayer.assetId!, 1)!
    const copySource = store.nodes.find((node) => node.sourceId === copy.id)
    expect(copySource?.kind).toBe('scene3d')
    expect(contributingNodeIds(store.nodes, store.nodeConnections, store.renderRootNodeId)).toContain(copySource!.id)
  })
})
