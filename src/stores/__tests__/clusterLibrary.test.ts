import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editor'

type Store = ReturnType<typeof useEditorStore>

const compositions = (store: Store) => store.assets.filter((asset) => asset.kind === 'composition')

describe('cluster library entries', () => {
  beforeEach(() => setActivePinia(createPinia()))

  /** The starter project ships its own composition, so every assertion is against a baseline. */
  function makeCluster() {
    const store = useEditorStore()
    const baseline = compositions(store).length
    const first = store.addGeneratedLayer('shape', 100, 100)
    const second = store.addGeneratedLayer('shape', 200, 200)
    expect(first && second).toBeTruthy()
    const cluster = store.createCluster([first!.id, second!.id])
    expect(cluster).toBeTruthy()
    return { store, cluster: cluster!, baseline }
  }

  it('gives a cluster exactly one library entry', () => {
    const { store, cluster, baseline } = makeCluster()
    expect(compositions(store)).toHaveLength(baseline + 1)
    expect(compositions(store).some((asset) => asset.id === cluster.assetId)).toBe(true)
  })

  it('embeds the link in the template, so a copy knows where it came from', () => {
    const { store, cluster } = makeCluster()
    const entry = store.assets.find((asset) => asset.id === cluster.assetId)!
    expect(entry.layerTemplate?.assetId).toBe(entry.id)
  })

  it('does not add a library entry each time the cluster is dropped on the timeline', () => {
    const { store, cluster, baseline } = makeCluster()

    for (let drop = 0; drop < 4; drop += 1) store.addAssetToTimeline(cluster.assetId!, drop)
    store.ensureClusterAssets()

    expect(compositions(store)).toHaveLength(baseline + 1)
  })

  it('folds duplicate entries a damaged project already carries back into one', () => {
    const { store, cluster, baseline } = makeCluster()
    const entry = store.assets.find((asset) => asset.id === cluster.assetId)!
    // Reproduce the damage: templates with no link, so every drop earned its own entry.
    delete entry.layerTemplate!.assetId
    const copies = [0, 2, 4].map((time) => {
      const copy = store.addAssetToTimeline(entry.id, time)!
      delete copy.assetId
      return copy
    })
    store.ensureClusterAssets()
    expect(store.assets.filter((asset) => asset.kind === 'composition')).toHaveLength(baseline + 4)

    expect(store.dedupeCompositionAssets()).toBe(3)
    expect(compositions(store)).toHaveLength(baseline + 1)
    // Every copy still points at a Library entry that exists.
    for (const copy of copies) {
      expect(store.assets.some((asset) => asset.id === copy.assetId), copy.id).toBe(true)
    }
  })

  it('leaves genuinely different compositions alone', () => {
    const { store, baseline } = makeCluster()
    const other = store.addGeneratedLayer('text', 400, 400)
    const second = store.createCluster([other!.id])!
    expect(compositions(store)).toHaveLength(baseline + 2)
    expect(store.dedupeCompositionAssets()).toBe(0)
    expect(compositions(store)).toHaveLength(baseline + 2)
    expect(second.assetId).toBeTruthy()
  })

  it('still links a copy made from a template saved before the link existed', () => {
    const { store, cluster, baseline } = makeCluster()
    const entry = store.assets.find((asset) => asset.id === cluster.assetId)!
    // Reproduce the older shape: a template with no idea which entry owns it.
    delete entry.layerTemplate!.assetId

    store.addAssetToTimeline(entry.id, 1)
    store.ensureClusterAssets()

    expect(compositions(store)).toHaveLength(baseline + 1)
  })
})
