import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../editor'

describe('timeline layer creation', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('creates a full-duration cinematic grade with its starter effects', () => {
    const store = useEditorStore()
    store.currentTime = 7

    const layer = store.addTimelineLayer('cinematic-grade')

    expect(layer).toMatchObject({
      name: 'Cinematic Grade',
      type: 'adjustment',
      start: 0,
      duration: store.project.duration,
      effects: ['Color Matrix', 'Vignette'],
    })
    expect(store.layers[0]?.id).toBe(layer.id)
    expect(store.selectedLayerId).toBe(layer.id)
  })

  it('creates an independent 3D scene and selects its initial camera', () => {
    const store = useEditorStore()
    const initialSceneCount = store.scenes3D.length

    const layer = store.addTimelineLayer('3d-scene')
    const scene = store.scenes3D.find((item) => item.id === layer.sceneId)

    expect(store.scenes3D).toHaveLength(initialSceneCount + 1)
    expect(scene).toBeDefined()
    expect(scene?.objects).toEqual([])
    expect(scene?.cameras).toHaveLength(1)
    expect(scene?.cameraCuts[0]?.cameraId).toBe(scene?.cameras[0]?.id)
    expect(store.selectedSceneId).toBe(scene?.id)
    expect(store.selectedSceneEntityId).toBe(scene?.cameras[0]?.id)
  })

  it('creates media and shape layers at the playhead in the correct section', () => {
    const store = useEditorStore()
    store.currentTime = 5

    const shape = store.addTimelineLayer('ellipse')
    const audio = store.addTimelineLayer('audio')

    expect(shape).toMatchObject({ type: 'shape', shapeKind: 'ellipse', start: 5 })
    expect(audio).toMatchObject({ type: 'audio', start: 5, effects: ['Gain'] })
    expect(store.layers.at(-1)?.id).toBe(audio.id)
  })
})
