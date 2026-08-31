import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../editor'
import type { EditorLayer } from '@/models/editor'

const keyframeIds = (layer: EditorLayer) =>
  (Object.keys(layer.transform) as Array<keyof EditorLayer['transform']>)
    .flatMap((key) => layer.transform[key].keyframes.map((keyframe) => keyframe.id))

describe('reusable clusters', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function clusterOfTitleAndLogo() {
    const store = useEditorStore()
    const cluster = store.createCluster(['layer-title', 'layer-logo'])!
    const asset = store.assets.find((item) => item.layerTemplate)!
    return { store, cluster, asset }
  }

  it('saves a cluster to the Library as a reusable composition', () => {
    const { store, cluster, asset } = clusterOfTitleAndLogo()

    expect(asset).toMatchObject({ kind: 'composition', name: cluster.name })
    expect(asset.layerTemplate?.children).toHaveLength(2)
    // The template is a snapshot: editing the timeline cluster must not rewrite the Library entry.
    cluster.name = 'Renamed in timeline'
    expect(asset.layerTemplate?.name).not.toBe('Renamed in timeline')
    expect(store.assets.filter((item) => item.layerTemplate)).toHaveLength(1)
  })

  it('instantiates an independent copy with fresh ids on every drop', () => {
    const { store, cluster, asset } = clusterOfTitleAndLogo()

    const first = store.addAssetToTimeline(asset.id, 4)!
    const second = store.addAssetToTimeline(asset.id, 9)!

    expect(first.id).not.toBe(second.id)
    expect(first.id).not.toBe(cluster.id)
    expect(first.children?.map((child) => child.id)).not.toEqual(second.children?.map((child) => child.id))
    const sharedKeyframes = keyframeIds(first.children![0]!).filter((id) => keyframeIds(second.children![0]!).includes(id))
    expect(sharedKeyframes).toEqual([])

    // Animating one copy leaves the other alone.
    first.children![0]!.transform.opacity.value = 12
    expect(second.children![0]!.transform.opacity.value).not.toBe(12)
  })

  it('lands the copy where it was dropped and shifts its keyframes with it', () => {
    const { store, cluster, asset } = clusterOfTitleAndLogo()
    const template = asset.layerTemplate!
    const animatedChild = template.children!.find((child) => child.transform.opacity.keyframes.length)!
    const originalTimes = animatedChild.transform.opacity.keyframes.map((keyframe) => keyframe.time)
    const dropTime = cluster.start + 5

    const copy = store.addAssetToTimeline(asset.id, dropTime)!
    const copiedChild = copy.children!.find((child) => child.transform.opacity.keyframes.length)!

    expect(copy.start).toBe(dropTime)
    expect(copiedChild.transform.opacity.keyframes.map((keyframe) => keyframe.time))
      .toEqual(originalTimes.map((time) => time + 5))
    expect(store.project.duration).toBeGreaterThanOrEqual(copy.start + copy.duration)
  })

  it('falls back to the playhead when no drop time is given', () => {
    const { store, asset } = clusterOfTitleAndLogo()
    store.currentTime = 6

    expect(store.addAssetToTimeline(asset.id)!.start).toBe(6)
  })

  it('keeps plain media assets working alongside composition templates', () => {
    const store = useEditorStore()
    const video = store.assets.find((item) => item.kind === 'video')!

    const layer = store.addAssetToTimeline(video.id, 3)!

    expect(layer).toMatchObject({ type: 'video', start: 3 })
    expect(layer.children).toBeUndefined()
  })
})
