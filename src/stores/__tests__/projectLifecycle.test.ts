import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { auroraProjectDatabase } from '@/engine/project/AuroraProjectDatabase'
import { useEditorStore } from '../editor'

describe('project lifecycle', () => {
  beforeEach(async () => {
    await auroraProjectDatabase.delete()
    await auroraProjectDatabase.open()
    setActivePinia(createPinia())
  })

  afterEach(async () => {
    await auroraProjectDatabase.delete()
  })

  it('creates an empty project with one visual and one audio track', async () => {
    const store = useEditorStore()
    await store.initializePersistence()

    expect(await store.createEmptyProject({ name: 'Vertical', width: 1080, height: 1920, frameRate: 30 })).toBe(true)

    expect(store.layers).toHaveLength(2)
    expect(store.layers[0]).toMatchObject({ type: 'shape', isPlaceholder: true })
    expect(store.layers[1]).toMatchObject({ type: 'audio', isPlaceholder: true })
    expect(store.layers.map((layer) => [layer.transform.x.value, layer.transform.y.value])).toEqual([[540, 960], [540, 960]])
  })
})
