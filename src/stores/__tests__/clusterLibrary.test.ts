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
