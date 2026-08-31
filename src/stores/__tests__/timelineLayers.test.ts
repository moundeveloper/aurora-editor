import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../editor'
import { evaluateNodeGraph } from '@/engine/nodes/evaluateGraph'

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
    expect(store.assets.find((asset) => asset.id === layer.assetId)).toMatchObject({
      kind: 'scene3d',
      name: scene?.name,
    })
  })

  it('keeps a reusable 3D Library scene current and instantiates a new scene when dropped', () => {
    const store = useEditorStore()
    const layer = store.addTimelineLayer('3d-scene')
    const asset = store.assets.find((item) => item.id === layer.assetId)!

    store.add3DPrimitive('box')
    expect(asset.sceneTemplate?.objects).toHaveLength(1)
    expect(asset.sceneLayerTemplate?.sceneId).toBe(layer.sceneId)

    const copy = store.addAssetToTimeline(asset.id, 4)!
    expect(copy.type).toBe('3d-scene')
    expect(copy.sceneId).not.toBe(layer.sceneId)
    expect(copy.assetId).toBe(asset.id)
    expect(store.scenes3D.find((scene) => scene.id === copy.sceneId)?.objects).toHaveLength(1)
  })

  it('auto-keys a transform channel that was previously static', () => {
    const store = useEditorStore()
    const layer = store.addTimelineLayer('rectangle')
    store.currentTime = 2
    store.autoKey = true

    store.setLayerValue('x', 420)

    expect(layer.transform.x.animated).toBe(true)
    expect(layer.transform.x.keyframes).toHaveLength(1)
    expect(layer.transform.x.keyframes[0]).toMatchObject({ time: 2, value: 420 })
  })

  it('ripples later clips on trims and closes deleted clip time', () => {
    const store = useEditorStore()
    const first = store.addTimelineLayer('image')
    const second = store.addTimelineLayer('image')
    first.trackId = 'shared-track'
    second.trackId = 'shared-track'
    first.start = 0
    first.duration = 2
    second.start = 5
    second.duration = 2
    store.ripple = true

    expect(store.rippleTrackSegments('shared-track', 2, 1, [first.id])).toBe(1)
    expect(second.start).toBe(6)

    store.deleteTimelineLayers([first.id], { keepTracks: true })
    expect(second.start).toBe(4)
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

  it('uses the configured resolution and frame rate for new content', () => {
    const store = useEditorStore()
    store.setProjectFormat(1080, 1920, 59.94)
    store.currentTime = 0

    const shape = store.addTimelineLayer('rectangle')

    expect(store.project).toMatchObject({ width: 1080, height: 1920, frameRate: 59.94 })
    expect(shape.transform.x.value).toBe(540)
    expect(shape.transform.y.value).toBe(960)
    expect(store.stepFrame(1)).toBeUndefined()
    expect(store.currentTime).toBeCloseTo(1 / 59.94)
  })

  it('creates dragged shapes with their requested dimensions', () => {
    const store = useEditorStore()
    const shape = store.addGeneratedLayer('shape', 420, 260, 'ellipse', { width: 180, height: 96 })

    expect(shape).toMatchObject({ type: 'shape', shapeKind: 'ellipse', shapeWidth: 180, shapeHeight: 96 })
    expect(shape.transform.x.value).toBe(420)
    expect(shape.transform.y.value).toBe(260)
    expect(evaluateNodeGraph(store.nodes, store.nodeConnections)?.some((pass) => pass.layerId === shape.id)).toBe(true)
  })

  it('localizes pen anchors and bezier handles around the new path layer', () => {
    const store = useEditorStore()
    const path = store.addPathLayer([
      { id: 'a', position: [100, 100], handleIn: [90, 100], handleOut: [120, 80] },
      { id: 'b', position: [300, 200], handleIn: [280, 220], handleOut: [310, 200] },
      { id: 'c', position: [160, 280], handleIn: [150, 260], handleOut: [170, 290] },
    ], true)!

    expect(path.shapeKind).toBe('path')
    expect(path.shapePath?.closed).toBe(true)
    expect(path.shapePath?.points[0]?.position).toEqual([-100, -85])
    expect(path.transform.x.value).toBe(200)
    expect(path.transform.y.value).toBe(185)
    expect(evaluateNodeGraph(store.nodes, store.nodeConnections)?.some((pass) => pass.layerId === path.id)).toBe(true)
  })

  it('renames, hides, and deletes a timeline layer with its unreferenced 3D scene', () => {
    const store = useEditorStore()
    const layer = store.addTimelineLayer('3d-scene')
    const sceneId = layer.sceneId!

    expect(store.renameTimelineLayers([layer.id], 'Renamed Scene')).toBe(true)
    expect(layer.name).toBe('Renamed Scene')
    expect(store.scenes3D.find((scene) => scene.id === sceneId)?.name).toBe('Renamed Scene')
    expect(store.setTimelineLayersVisible([layer.id], false)).toBe(true)
    expect(layer.visible).toBe(false)
    expect(store.deleteTimelineLayers([layer.id])).toBe(true)
    expect(store.layers.some((item) => item.id === layer.id)).toBe(false)
    expect(store.scenes3D.some((scene) => scene.id === sceneId)).toBe(false)
  })
})
