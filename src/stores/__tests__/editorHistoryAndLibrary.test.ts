import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../editor'

describe('editor history and Library management', () => {
  beforeEach(() => setActivePinia(createPinia()))

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
})
