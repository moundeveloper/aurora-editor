import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../editor'

describe('cluster timeline contexts', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('edits the cluster children once its tab is open', () => {
    const store = useEditorStore()
    const cluster = store.createCluster(['layer-title', 'layer-logo'])!
    expect(store.timelineLayers).toBe(store.layers)

    expect(store.enterCluster(cluster.id)).toBe(true)
    expect(store.activeClusterId).toBe(cluster.id)
    expect(store.timelineLayers.map((layer) => layer.id)).toEqual(cluster.children!.map((layer) => layer.id))

    // A layer added inside the tab lands in the cluster, not in the project root.
    const added = store.addTimelineLayer('text')
    expect(cluster.children!.some((layer) => layer.id === added.id)).toBe(true)
    expect(store.layers.some((layer) => layer.id === added.id)).toBe(false)
  })

  it('stacks a tab per nesting level and keeps the root reachable', () => {
    const store = useEditorStore()
    const outer = store.createCluster(['layer-title', 'layer-logo'])!
    store.enterCluster(outer.id)
    const inner = store.createCluster(outer.children!.map((layer) => layer.id))!

    expect(outer.children!.some((layer) => layer.id === inner.id)).toBe(true)
    store.enterCluster(inner.id)
    expect(store.openClusterTabs).toEqual([outer.id, inner.id])
    expect(store.clusterTabs.map((tab) => tab.id)).toEqual([outer.id, inner.id])

    store.activateTimelineTab(null)
    expect(store.activeClusterId).toBeNull()
    expect(store.timelineLayers).toBe(store.layers)

    store.activateTimelineTab(inner.id)
    expect(store.timelineLayers.map((layer) => layer.id)).toEqual(inner.children!.map((layer) => layer.id))
  })

  it('creates an empty cluster and opens it ready to work in', () => {
    const store = useEditorStore()
    store.currentTime = 3

    const cluster = store.createEmptyCluster()

    expect(cluster.children).toHaveLength(2)
    expect(cluster.children?.map((layer) => ({ type: layer.type, placeholder: layer.isPlaceholder }))).toEqual([
      { type: 'shape', placeholder: true },
      { type: 'audio', placeholder: true },
    ])
    expect(cluster.start).toBe(3)
    expect(cluster.duration).toBeGreaterThan(0)
    expect(store.activeClusterId).toBe(cluster.id)
    expect(store.timelineLayers).toHaveLength(2)

    const first = store.addTimelineLayer('rectangle')
    expect(cluster.children).toHaveLength(3)
    expect(store.selectedLayer?.id).toBe(first.id)
  })

  it('closing a tab falls back to the previous context', () => {
    const store = useEditorStore()
    const outer = store.createCluster(['layer-title', 'layer-logo'])!
    store.enterCluster(outer.id)
    const inner = store.createCluster(outer.children!.map((layer) => layer.id))!
    store.enterCluster(inner.id)

    store.closeClusterTab(inner.id)
    expect(store.activeClusterId).toBe(outer.id)

    store.closeClusterTab(outer.id)
    expect(store.activeClusterId).toBeNull()
    expect(store.openClusterTabs).toEqual([])
    expect(store.timelineLayers).toBe(store.layers)
  })

  it('keeps children at the same place inside the cluster when the cluster moves', () => {
    const store = useEditorStore()
    const cluster = store.createCluster(['layer-title', 'layer-logo'])!
    const child = cluster.children![0]!
    const relativeBefore = child.start - cluster.start

    // Moving the cluster on the main timeline carries its children along.
    const delta = 4
    cluster.start += delta
    cluster.children!.forEach((item) => { item.start += delta })

    expect(child.start - cluster.start).toBe(relativeBefore)
  })

  it('grows a cluster to cover a child dragged past its end, leaving the project alone', () => {
    const store = useEditorStore()
    const cluster = store.createCluster(['layer-title', 'layer-logo'])!
    const projectDuration = store.project.duration
    const child = cluster.children![0]!
    const originalDuration = cluster.duration

    child.start = cluster.start + cluster.duration + 2
    store.fitClusterToChildren(cluster.id)

    expect(cluster.duration).toBeGreaterThan(originalDuration)
    expect(cluster.start + cluster.duration).toBeGreaterThanOrEqual(child.start + child.duration)
    expect(store.project.duration).toBe(projectDuration)
  })

  it('never shrinks a cluster when its contents move inwards', () => {
    const store = useEditorStore()
    const cluster = store.createCluster(['layer-title', 'layer-logo'])!
    const originalDuration = cluster.duration
    cluster.children!.forEach((child) => { child.duration = 0.5 })

    store.fitClusterToChildren(cluster.id)

    expect(cluster.duration).toBe(originalDuration)
  })

  it('publishes every cluster to the Library, empty ones included', () => {
    const store = useEditorStore()
    const empty = store.createEmptyCluster()

    const asset = store.assets.find((item) => item.id === empty.assetId)
    expect(asset).toMatchObject({ kind: 'composition', name: empty.name })
    expect(asset?.layerTemplate?.children).toHaveLength(2)
    expect(asset?.layerTemplate?.children?.every((layer) => layer.isPlaceholder)).toBe(true)
    expect(asset?.sizeLabel).toBe('0 reusable layers')
  })

  it('refreshes the Library entry as the cluster is built, without adding duplicates', () => {
    const store = useEditorStore()
    const cluster = store.createEmptyCluster()
    const assetCount = store.assets.length

    store.addTimelineLayer('rectangle')
    store.addTimelineLayer('text')

    const asset = store.assets.find((item) => item.id === cluster.assetId)!
    expect(store.assets).toHaveLength(assetCount)
    expect(asset.layerTemplate?.children).toHaveLength(4)
    expect(asset.sizeLabel).toBe('2 reusable layers')
    // The refreshed template is what a later drop instantiates.
    expect(store.addAssetToTimeline(asset.id, 0)!.children).toHaveLength(4)
  })

  it('gives every tab its own playhead', () => {
    const store = useEditorStore()
    const cluster = store.createCluster(['layer-title', 'layer-logo'])!
    store.setTime(9)

    store.enterCluster(cluster.id)
    // A cluster opened for the first time starts at its own first frame.
    expect(store.currentTime).toBe(cluster.start)

    store.setTime(cluster.start + 2)
    store.activateTimelineTab(null)
    // Scrubbing inside the cluster left the main timeline where it was.
    expect(store.currentTime).toBe(9)

    store.activateTimelineTab(cluster.id)
    expect(store.currentTime).toBe(cluster.start + 2)
  })

  it('backfills a Library entry for clusters that never published one', () => {
    const store = useEditorStore()
    const cluster = store.createCluster(['layer-title', 'layer-logo'])!

    // An older project, or one saved before clusters published themselves.
    store.assets = store.assets.filter((asset) => asset.id !== cluster.assetId)
    delete cluster.assetId
    expect(store.assets.some((asset) => asset.layerTemplate)).toBe(false)

    store.ensureClusterAssets()

    const asset = store.assets.find((item) => item.id === cluster.assetId)
    expect(asset).toMatchObject({ kind: 'composition', name: cluster.name })
    expect(asset?.layerTemplate?.children).toHaveLength(2)
  })

  it('backfills nested clusters too, without duplicating the ones already listed', () => {
    const store = useEditorStore()
    const outer = store.createCluster(['layer-title', 'layer-logo'])!
    store.enterCluster(outer.id)
    const inner = store.createCluster(outer.children!.map((layer) => layer.id))!
    store.activateTimelineTab(null)

    const before = store.assets.length
    store.ensureClusterAssets()

    expect(store.assets).toHaveLength(before)
    expect(store.assets.some((asset) => asset.id === inner.assetId)).toBe(true)
    expect(store.assets.some((asset) => asset.id === outer.assetId)).toBe(true)
  })

  it('refuses to enter anything that is not a cluster', () => {
    const store = useEditorStore()
    expect(store.enterCluster('layer-title')).toBe(false)
    expect(store.enterCluster('missing')).toBe(false)
    expect(store.activeClusterId).toBeNull()
  })

  it('resolves the selected layer inside a nested cluster for the inspector', () => {
    const store = useEditorStore()
    const cluster = store.createCluster(['layer-title', 'layer-logo'])!
    const child = cluster.children![0]!

    store.selectedLayerId = child.id

    expect(store.selectedLayer?.id).toBe(child.id)
  })
})
