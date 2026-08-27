import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import type {
  AnimatableProperty, Aurora3DScene, AuroraCamera, AuroraLight,
  EditorLayer, EditorProject, MediaAsset, SerializedEditorState, WorkspaceId,
} from '@/models/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { deserializeEditorState, serializeEditorState } from '@/engine/project/serialization'
import { auroraProjectDatabase } from '@/engine/project/AuroraProjectDatabase'
import { createDemo3DScene, createPrimitiveObject, makeTransform3D, numericProperty } from '@/engine/scene3d/sceneFactory'

const property = (id: string, value: number): AnimatableProperty<number> => ({
  id,
  value,
  animated: false,
  keyframes: [],
})

const makeTransform = (prefix: string) => ({
  x: property(`${prefix}-x`, 960),
  y: property(`${prefix}-y`, 540),
  scaleX: property(`${prefix}-sx`, 100),
  scaleY: property(`${prefix}-sy`, 100),
  rotation: property(`${prefix}-rotation`, 0),
  opacity: property(`${prefix}-opacity`, 100),
})

export const useEditorStore = defineStore('editor', () => {
  const project = ref<EditorProject>({
    id: 'aurora-demo',
    name: 'Beyond the Horizon',
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 18,
    backgroundColor: '#080b12',
    updatedAt: Date.now(),
    version: 3,
  })

  const workspace = ref<WorkspaceId>('Motion')
  const currentTime = ref(4.2)
  const playing = ref(false)
  const loop = ref(true)
  const autoKey = ref(false)
  const snap = ref(true)
  const ripple = ref(false)
  const selectedLayerId = ref('layer-title')
  const selectedKeyframeId = ref<string | null>(null)
  const selectedNodeId = ref('node-blur')
  const selectedSceneId = ref('scene-aurora-3d')
  const selectedSceneEntityId = ref('object-aurora-cube')
  const zoom = ref(100)
  const saveStatus = ref<'Saved' | 'Saving…' | 'Save failed'>('Saved')
  const exportProgress = ref(0)
  let clusterCounter = 1
  let visualTrackCounter = 1
  let audioTrackCounter = 1

  const assets = ref<MediaAsset[]>([
    { id: 'asset-ridge', name: 'Ridge_Expedition.mp4', kind: 'video', duration: 18, dimensions: '3840 × 2160', thumbnail: '/demo/aurora-ridge.png', sizeLabel: '148 MB' },
    { id: 'asset-logo', name: 'Aurora_Mark.png', kind: 'image', dimensions: '2048 × 2048', thumbnail: '/demo/aurora-ridge.png', sizeLabel: '3.8 MB' },
    { id: 'asset-audio', name: 'Deep_Signal.wav', kind: 'audio', duration: 18, sizeLabel: '42 MB' },
    { id: 'asset-comp', name: 'Title_Reveal', kind: 'composition', duration: 6, dimensions: '1920 × 1080' },
  ])

  const layers = ref<EditorLayer[]>([
    { id: 'layer-adjust', name: 'Cinematic Grade', type: 'adjustment', start: 0, duration: 18, color: '#9b8fe8', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('grade'), effects: ['Color Matrix', 'Vignette'] },
    { id: 'layer-title', name: 'BEYOND THE HORIZON', type: 'text', start: 2.2, duration: 8.6, color: '#d49b65', visible: true, locked: false, muted: false, expanded: true, transform: makeTransform('title'), effects: ['Glow'] },
    { id: 'layer-3d-scene', name: 'Aurora 3D Study', type: '3d-scene', sceneId: 'scene-aurora-3d', start: 0, duration: 18, color: '#7888db', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('scene-3d'), effects: [] },
    { id: 'layer-logo', name: 'Aurora Mark', type: 'image', start: 1, duration: 14, color: '#6b99d5', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('logo'), effects: [] },
    { id: 'layer-video', name: 'Ridge Expedition', type: 'video', start: 0, duration: 18, color: '#5477a8', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('video'), effects: ['Brightness / Contrast'] },
    { id: 'layer-audio', name: 'Deep Signal', type: 'audio', start: 0, duration: 18, color: '#5c9b82', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('audio'), effects: ['Gain'] },
  ])
  const scenes3D = ref<Aurora3DScene[]>([createDemo3DScene()])

  const titleLayer = layers.value.find((layer) => layer.id === 'layer-title')
  if (titleLayer) {
    titleLayer.transform.y.value = 460
    titleLayer.transform.opacity.animated = true
    titleLayer.transform.opacity.keyframes = [
      { id: 'opacity-1', time: 2.2, value: 0, interpolation: 'bezier' },
      { id: 'opacity-2', time: 3.4, value: 100, interpolation: 'bezier' },
      { id: 'opacity-3', time: 9.8, value: 100, interpolation: 'linear' },
      { id: 'opacity-4', time: 10.8, value: 0, interpolation: 'bezier' },
    ]
    titleLayer.transform.y.animated = true
    titleLayer.transform.y.keyframes = [
      { id: 'position-1', time: 2.2, value: 500, interpolation: 'bezier' },
      { id: 'position-2', time: 3.4, value: 460, interpolation: 'bezier' },
    ]
  }

  const defaultState = deserializeEditorState(null, {
    project: project.value,
    layers: layers.value,
    scenes3D: scenes3D.value,
    assets: assets.value,
  })
  let persistenceReady = false
  let saveTimer: number | null = null
  let changeRevision = 0
  let saveQueue: Promise<void> = Promise.resolve()

  function applyLoadedState(state: SerializedEditorState) {
    project.value = state.project
    layers.value = state.layers
    scenes3D.value = state.scenes3D
    assets.value = state.assets
  }

  function projectSnapshot(): SerializedEditorState {
    return JSON.parse(serializeEditorState({
      project: project.value,
      layers: layers.value,
      scenes3D: scenes3D.value,
      assets: assets.value,
    })) as SerializedEditorState
  }

  async function initializePersistence() {
    if (persistenceReady) return
    const legacyRaw = typeof window === 'undefined' ? null : window.localStorage.getItem('aurora-editor-project')
    try {
      const databaseState = await auroraProjectDatabase.loadActiveSnapshot()
      const loadedState = databaseState
        ? deserializeEditorState(JSON.stringify(databaseState), defaultState)
        : deserializeEditorState(legacyRaw, defaultState)
      applyLoadedState(loadedState)
      persistenceReady = true
      if (!databaseState) await saveProjectNow()
      if (legacyRaw && saveStatus.value === 'Saved') window.localStorage.removeItem('aurora-editor-project')
    } catch (error) {
      applyLoadedState(deserializeEditorState(legacyRaw, defaultState))
      persistenceReady = true
      saveStatus.value = 'Save failed'
      console.error('Aurora project database initialization failed', error)
    }
  }

  const selectedLayer = computed(() => layers.value.find((layer) => layer.id === selectedLayerId.value) ?? layers.value[0])
  const selectedScene = computed(() => scenes3D.value.find((scene) => scene.id === selectedSceneId.value) ?? scenes3D.value[0])
  const selectedSceneEntity = computed(() => {
    const scene = selectedScene.value
    if (!scene) return null
    const object = scene.objects.find((item) => item.id === selectedSceneEntityId.value)
    if (object) return { kind: 'object' as const, value: object }
    const camera = scene.cameras.find((item) => item.id === selectedSceneEntityId.value)
    if (camera) return { kind: 'camera' as const, value: camera }
    const light = scene.lights.find((item) => item.id === selectedSceneEntityId.value)
    return light ? { kind: 'light' as const, value: light } : null
  })

  let playbackFrame = 0
  let lastTick = 0
  const tick = (timestamp: number) => {
    if (!playing.value) return
    if (!lastTick) lastTick = timestamp
    const elapsed = (timestamp - lastTick) / 1000
    lastTick = timestamp
    currentTime.value += elapsed
    if (currentTime.value >= project.value.duration) {
      currentTime.value = loop.value ? 0 : project.value.duration
      if (!loop.value) playing.value = false
    }
    playbackFrame = requestAnimationFrame(tick)
  }

  function togglePlayback() {
    playing.value = !playing.value
    if (playing.value) selectedKeyframeId.value = null
    lastTick = 0
    if (playing.value) playbackFrame = requestAnimationFrame(tick)
    else cancelAnimationFrame(playbackFrame)
  }

  function setTime(value: number) {
    selectedKeyframeId.value = null
    currentTime.value = Math.max(0, Math.min(project.value.duration, value))
  }

  function stepFrame(direction: -1 | 1) {
    setTime(currentTime.value + direction / project.value.frameRate)
  }

  function setProjectDuration(value: number) {
    const longestLayer = layers.value.reduce((end, layer) => Math.max(end, layer.start + layer.duration), 1)
    project.value.duration = Math.max(longestLayer, Math.min(86400, Number.isFinite(value) ? value : project.value.duration))
    currentTime.value = Math.min(currentTime.value, project.value.duration)
    markChanged()
  }

  function addKeyframe(key: keyof EditorLayer['transform']) {
    const layer = selectedLayer.value
    if (!layer) return
    const channel = layer.transform[key]
    channel.animated = true
    const tolerance = (0.5 / project.value.frameRate) + 0.0001
    const existing = channel.keyframes.find((item) => Math.abs(item.time - currentTime.value) <= tolerance)
    if (existing) {
      channel.keyframes = channel.keyframes.filter((item) => item.id !== existing.id)
      if (selectedKeyframeId.value === existing.id) selectedKeyframeId.value = null
    } else {
      const keyframe = { id: crypto.randomUUID(), time: currentTime.value, value: channel.value, interpolation: 'bezier' as const }
      channel.keyframes.push(keyframe)
      selectedKeyframeId.value = keyframe.id
    }
    channel.keyframes.sort((a, b) => a.time - b.time)
    markChanged()
  }

  function setLayerValue(key: keyof EditorLayer['transform'], value: number) {
    const layer = selectedLayer.value
    if (!layer) return
    const channel = layer.transform[key]
    channel.value = value
    if (channel.animated) {
      const selectedKeyframe = channel.keyframes.find((item) => item.id === selectedKeyframeId.value)
      const tolerance = (0.5 / project.value.frameRate) + 0.0001
      const keyframeAtPlayhead = channel.keyframes.find((item) => Math.abs(item.time - currentTime.value) <= tolerance)
      const keyframeToUpdate = selectedKeyframe ?? keyframeAtPlayhead
      if (keyframeToUpdate) keyframeToUpdate.value = value
      else if (autoKey.value) {
        const keyframe = { id: crypto.randomUUID(), time: currentTime.value, value, interpolation: 'bezier' as const }
        channel.keyframes.push(keyframe)
        channel.keyframes.sort((left, right) => left.time - right.time)
        selectedKeyframeId.value = keyframe.id
      }
    }
    markChanged()
  }

  function addFiles(files: FileList | File[]) {
    Array.from(files).forEach((file) => {
      const major = file.type.split('/')[0]
      const extension = file.name.split('.').at(-1)?.toLowerCase()
      const kind: MediaAsset['kind'] = extension === 'glb' || extension === 'gltf'
        ? 'model3d'
        : extension === 'hdr' || extension === 'exr'
          ? 'hdr'
          : major === 'audio' ? 'audio' : major === 'image' ? 'image' : 'video'
      assets.value.unshift({
        id: crypto.randomUUID(),
        name: file.name,
        kind,
        thumbnail: kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : undefined,
        sizeLabel: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
      })
    })
    markChanged()
  }

  function addAssetToTimeline(assetId: string) {
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset || asset.kind === 'model3d' || asset.kind === 'hdr' || asset.kind === 'texture') return
    const type = asset.kind === 'composition' ? 'image' : asset.kind
    const layer: EditorLayer = {
      id: crypto.randomUUID(), name: asset.name.replace(/\.[^.]+$/, ''), type,
      start: currentTime.value, duration: Math.min(asset.duration ?? 6, project.value.duration - currentTime.value),
      color: type === 'audio' ? '#5c9b82' : type === 'image' ? '#6b99d5' : '#5477a8',
      visible: true, locked: false, muted: false, expanded: false,
      transform: makeTransform(crypto.randomUUID()), effects: [],
    }
    layers.value.splice(type === 'audio' ? layers.value.length : 0, 0, layer)
    selectedLayerId.value = layer.id
    markChanged()
  }

  function addGeneratedLayer(type: 'text' | 'shape', x: number, y: number, shapeKind: 'rectangle' | 'ellipse' = 'rectangle') {
    const id = crypto.randomUUID()
    const layer: EditorLayer = {
      id,
      name: type === 'text' ? 'New Text' : shapeKind === 'ellipse' ? 'Ellipse' : 'Rectangle',
      type,
      shapeKind: type === 'shape' ? shapeKind : undefined,
      textContent: type === 'text' ? 'New Text' : undefined,
      start: currentTime.value,
      duration: Math.max(1 / project.value.frameRate, project.value.duration - currentTime.value),
      color: type === 'text' ? '#d49b65' : shapeKind === 'ellipse' ? '#7296d8' : '#8c9bff',
      visible: true,
      locked: false,
      muted: false,
      expanded: false,
      transform: makeTransform(id),
      effects: [],
    }
    layer.transform.x.value = Math.max(0, Math.min(project.value.width, x))
    layer.transform.y.value = Math.max(0, Math.min(project.value.height, y))
    layers.value.splice(0, 0, layer)
    selectedLayerId.value = layer.id
    selectedKeyframeId.value = null
    markChanged()
    return layer
  }

  function reorderTrack(sourceTrackId: string, targetTrackId: string, before: boolean) {
    if (sourceTrackId === targetTrackId) return
    const trackKey = (layer: EditorLayer) => layer.trackId ?? layer.id
    const sourceSegments = layers.value.filter((layer) => trackKey(layer) === sourceTrackId)
    const targetSegments = layers.value.filter((layer) => trackKey(layer) === targetTrackId)
    if (!sourceSegments.length || !targetSegments.length || (sourceSegments[0]!.type === 'audio') !== (targetSegments[0]!.type === 'audio')) return
    const remaining = layers.value.filter((layer) => trackKey(layer) !== sourceTrackId)
    const targetIndices = remaining.map((layer, index) => trackKey(layer) === targetTrackId ? index : -1).filter((index) => index >= 0)
    const insertionIndex = before ? Math.min(...targetIndices) : Math.max(...targetIndices) + 1
    remaining.splice(insertionIndex, 0, ...sourceSegments)
    layers.value = remaining
    markChanged()
  }

  function moveSegmentToTrack(layerId: string, targetTrackId: string) {
    const segmentIndex = layers.value.findIndex((layer) => layer.id === layerId)
    const segment = layers.value[segmentIndex]
    const target = layers.value.find((layer) => (layer.trackId ?? layer.id) === targetTrackId)
    if (!segment || !target || (segment.type === 'audio') !== (target.type === 'audio')) return false
    const sourceTrackId = segment.trackId ?? segment.id
    if (sourceTrackId === targetTrackId) return false
    layers.value.splice(segmentIndex, 1)
    if (!layers.value.some((layer) => (layer.trackId ?? layer.id) === sourceTrackId)) {
      layers.value.splice(Math.min(segmentIndex, layers.value.length), 0, makeEmptyTrack(segment.type === 'audio' ? 'audio' : 'visual', sourceTrackId))
    }
    const targetPlaceholderIndex = layers.value.findIndex((layer) => (layer.trackId ?? layer.id) === targetTrackId && layer.isPlaceholder)
    if (targetPlaceholderIndex >= 0) layers.value.splice(targetPlaceholderIndex, 1)
    segment.trackId = targetTrackId
    const lastTargetIndex = layers.value.reduce((last, layer, index) => (layer.trackId ?? layer.id) === targetTrackId ? index : last, -1)
    const insertionIndex = lastTargetIndex >= 0 ? lastTargetIndex + 1 : Math.max(0, targetPlaceholderIndex)
    layers.value.splice(insertionIndex, 0, segment)
    selectedLayerId.value = segment.id
    markChanged()
    return true
  }

  function moveSegmentToNewTrack(layerId: string, category: 'visual' | 'audio') {
    const index = layers.value.findIndex((layer) => layer.id === layerId)
    const segment = layers.value[index]
    if (!segment || (segment.type === 'audio') !== (category === 'audio')) return false
    const sourceTrackId = segment.trackId ?? segment.id
    layers.value.splice(index, 1)
    if (!layers.value.some((layer) => (layer.trackId ?? layer.id) === sourceTrackId)) {
      layers.value.splice(Math.min(index, layers.value.length), 0, makeEmptyTrack(category, sourceTrackId))
    }
    segment.trackId = crypto.randomUUID()
    const insertionIndex = category === 'audio' ? layers.value.length : 0
    layers.value.splice(insertionIndex, 0, segment)
    selectedLayerId.value = segment.id
    markChanged()
    return true
  }

  function makeEmptyTrack(category: 'visual' | 'audio', trackId?: string): EditorLayer {
    const id = crypto.randomUUID()
    const isAudio = category === 'audio'
    return {
      id,
      ...(trackId ? { trackId } : {}),
      name: isAudio ? `Audio Layer ${audioTrackCounter++}` : `Visual Layer ${visualTrackCounter++}`,
      type: isAudio ? 'audio' : 'shape',
      isPlaceholder: true,
      start: 0,
      duration: 0,
      color: isAudio ? '#5c9b82' : '#6674bd',
      visible: true,
      locked: false,
      muted: false,
      expanded: false,
      transform: makeTransform(id),
      effects: [],
    }
  }

  function addEmptyTrack(category: 'visual' | 'audio') {
    const layer = makeEmptyTrack(category)
    const isAudio = category === 'audio'
    const firstAudio = layers.value.findIndex((item) => item.type === 'audio')
    layers.value.splice(isAudio ? layers.value.length : (firstAudio < 0 ? layers.value.length : firstAudio), 0, layer)
    selectedLayerId.value = layer.id
    markChanged()
    return layer
  }

  function createCluster(layerIds: string[]) {
    const selectedIds = new Set(layerIds)
    const children = layers.value.filter((layer) => selectedIds.has(layer.id) && layer.type !== 'audio' && !layer.isPlaceholder)
    if (!children.length) return null
    const childIds = new Set(children.map((layer) => layer.id))
    const firstIndex = layers.value.findIndex((layer) => childIds.has(layer.id))
    const start = Math.min(...children.map((layer) => layer.start))
    const end = Math.max(...children.map((layer) => layer.start + layer.duration))
    const id = crypto.randomUUID()
    const cluster: EditorLayer = {
      id,
      name: `Cluster ${clusterCounter++}`,
      type: 'cluster',
      start,
      duration: end - start,
      color: '#7f8fe2',
      visible: true,
      locked: false,
      muted: false,
      expanded: false,
      transform: makeTransform(id),
      effects: [],
      children,
    }
    layers.value = layers.value.filter((layer) => !childIds.has(layer.id))
    layers.value.splice(Math.max(0, Math.min(firstIndex, layers.value.length)), 0, cluster)
    selectedLayerId.value = cluster.id
    selectedKeyframeId.value = null
    markChanged()
    return cluster
  }

  function releaseCluster(clusterId: string) {
    const index = layers.value.findIndex((layer) => layer.id === clusterId && layer.type === 'cluster')
    const cluster = layers.value[index]
    if (!cluster?.children?.length) return false
    layers.value.splice(index, 1, ...cluster.children)
    selectedLayerId.value = cluster.children[0]!.id
    selectedKeyframeId.value = null
    markChanged()
    return true
  }

  function splitLayerAt(layerId: string, requestedTime: number) {
    const index = layers.value.findIndex((item) => item.id === layerId)
    const layer = layers.value[index]
    if (!layer || layer.locked) return false
    const frameDuration = 1 / project.value.frameRate
    const splitTime = Math.round(requestedTime / frameDuration) * frameDuration
    const originalEnd = layer.start + layer.duration
    if (splitTime <= layer.start + frameDuration / 2 || splitTime >= originalEnd - frameDuration / 2) return false

    const right = structuredClone(toRaw(layer))
    const trackId = layer.trackId ?? layer.id
    layer.trackId = trackId
    right.id = crypto.randomUUID()
    right.trackId = trackId
    right.name = layer.name
    right.start = splitTime
    right.duration = originalEnd - splitTime
    right.sourceOffset = (layer.sourceOffset ?? 0) + splitTime - layer.start
    layer.duration = splitTime - layer.start

    ;(Object.keys(layer.transform) as Array<keyof EditorLayer['transform']>).forEach((property) => {
      const leftChannel = layer.transform[property]
      const rightChannel = right.transform[property]
      const boundaryValue = evaluateNumericProperty(leftChannel, splitTime)
      const boundarySource = leftChannel.keyframes.find((keyframe) => Math.abs(keyframe.time - splitTime) <= frameDuration / 2)
      leftChannel.keyframes = leftChannel.keyframes.filter((keyframe) => keyframe.time <= splitTime + frameDuration / 2)
      rightChannel.keyframes = rightChannel.keyframes
        .filter((keyframe) => keyframe.time >= splitTime - frameDuration / 2)
        .map((keyframe) => ({ ...keyframe, id: crypto.randomUUID() }))
      if (leftChannel.animated && !boundarySource) {
        leftChannel.keyframes.push({ id: crypto.randomUUID(), time: splitTime, value: boundaryValue, interpolation: 'bezier' })
        rightChannel.keyframes.unshift({ id: crypto.randomUUID(), time: splitTime, value: boundaryValue, interpolation: 'bezier' })
      }
      leftChannel.keyframes.sort((left, next) => left.time - next.time)
      rightChannel.keyframes.sort((left, next) => left.time - next.time)
    })

    layers.value.splice(index + 1, 0, right)
    selectedLayerId.value = layer.id
    selectedKeyframeId.value = null
    markChanged()
    return true
  }

  function splitSelectedLayer() {
    const layer = selectedLayer.value
    return layer ? splitLayerAt(layer.id, currentTime.value) : false
  }

  function markChanged() {
    changeRevision += 1
    saveStatus.value = 'Saving…'
    if (saveTimer !== null) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => { void saveProjectNow() }, 250)
  }

  function saveProjectNow() {
    if (saveTimer !== null) window.clearTimeout(saveTimer)
    saveTimer = null
    if (!persistenceReady) return Promise.resolve()
    saveStatus.value = 'Saving…'
    const revisionToSave = changeRevision
    const save = async () => {
      project.value.updatedAt = Date.now()
      try {
        await auroraProjectDatabase.saveSnapshot(projectSnapshot())
        if (revisionToSave === changeRevision) saveStatus.value = 'Saved'
      } catch (error) {
        saveStatus.value = 'Save failed'
        console.error('Aurora project save failed', error)
      }
    }
    saveQueue = saveQueue.then(save, save)
    return saveQueue
  }

  function flushProjectSave() {
    return saveTimer !== null || saveStatus.value !== 'Saved' ? saveProjectNow() : saveQueue
  }

  function setWorkspace(nextWorkspace: WorkspaceId) {
    if (workspace.value === nextWorkspace) return
    void flushProjectSave()
    workspace.value = nextWorkspace
  }

  function selectSceneEntity(sceneId: string, entityId: string) {
    selectedSceneId.value = sceneId
    selectedSceneEntityId.value = entityId
  }

  function markSceneChanged(scene: Aurora3DScene = selectedScene.value!) {
    if (!scene) return
    scene.revision += 1
    markChanged()
  }

  function add3DPrimitive(primitive: 'box' | 'sphere') {
    const scene = selectedScene.value
    if (!scene) return null
    const object = createPrimitiveObject(primitive, scene.objects.length + 1)
    object.transform.position.x.value = (scene.objects.length % 3) * 2 - 2
    scene.objects.push(object)
    selectedSceneEntityId.value = object.id
    markSceneChanged(scene)
    return object
  }

  function add3DLight(type: AuroraLight['type']) {
    const scene = selectedScene.value
    if (!scene) return null
    const id = crypto.randomUUID()
    const light: AuroraLight = {
      id,
      name: `${type[0]?.toUpperCase()}${type.slice(1)} Light`,
      type,
      color: type === 'ambient' ? '#c5ccff' : '#ffffff',
      intensity: numericProperty(`${id}-intensity`, type === 'point' ? 18 : 1.5),
      transform: makeTransform3D(id, type === 'ambient' ? [0, 0, 0] : [4, 5, 3]),
      castShadow: type !== 'ambient',
    }
    scene.lights.push(light)
    selectedSceneEntityId.value = light.id
    markSceneChanged(scene)
    return light
  }

  function add3DCamera() {
    const scene = selectedScene.value
    if (!scene) return null
    const id = crypto.randomUUID()
    const camera: AuroraCamera = {
      id,
      name: `Camera ${scene.cameras.length + 1}`,
      projection: 'perspective',
      transform: makeTransform3D(id, [0, 2.4, 7]),
      fov: numericProperty(`${id}-fov`, 45),
      near: .1,
      far: 1000,
    }
    camera.transform.rotation.x.value = -18.924644416051237
    scene.cameras.push(camera)
    selectedSceneEntityId.value = camera.id
    markSceneChanged(scene)
    return camera
  }

  function set3DEntityTransform(group: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', value: number) {
    const entity = selectedSceneEntity.value
    if (!entity) return
    entity.value.transform[group][axis].value = value
    markSceneChanged()
  }

  function update3DEntityTransform(entityId: string, values: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }) {
    const scene = selectedScene.value
    const entity = scene
      ? scene.objects.find((item) => item.id === entityId)
        ?? scene.cameras.find((item) => item.id === entityId)
        ?? scene.lights.find((item) => item.id === entityId)
      : undefined
    if (!scene || !entity) return
    ;(['x', 'y', 'z'] as const).forEach((axis, index) => {
      entity.transform.position[axis].value = values.position[index]!
      entity.transform.rotation[axis].value = values.rotation[index]!
      entity.transform.scale[axis].value = values.scale[index]!
    })
    markSceneChanged(scene)
  }

  function set3DObjectMaterial(key: 'metalness' | 'roughness' | 'opacity' | 'emissiveIntensity', value: number) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'object') return
    entity.value.material[key].value = value
    markSceneChanged()
  }

  function set3DLightIntensity(value: number) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'light') return
    entity.value.intensity.value = value
    markSceneChanged()
  }

  function setActive3DCamera(cameraId: string) {
    const scene = selectedScene.value
    if (!scene || !scene.cameras.some((camera) => camera.id === cameraId)) return
    scene.activeCameraId = cameraId
    selectedSceneEntityId.value = cameraId
    markSceneChanged(scene)
  }

  function startExport() {
    exportProgress.value = 1
    const interval = window.setInterval(() => {
      exportProgress.value = Math.min(100, exportProgress.value + 4)
      if (exportProgress.value >= 100) window.clearInterval(interval)
    }, 90)
  }

  return {
    project, workspace, currentTime, playing, loop, autoKey, snap, ripple, selectedLayerId, selectedKeyframeId,
    selectedNodeId, selectedSceneId, selectedSceneEntityId, zoom, saveStatus, exportProgress, assets, layers, scenes3D,
    selectedLayer, selectedScene, selectedSceneEntity,
    togglePlayback, setTime, stepFrame, setProjectDuration, addKeyframe, setLayerValue, addFiles,
    addAssetToTimeline, addGeneratedLayer, reorderTrack, moveSegmentToTrack, moveSegmentToNewTrack, addEmptyTrack,
    createCluster, releaseCluster,
    splitLayerAt, splitSelectedLayer, markChanged, saveProjectNow, flushProjectSave, initializePersistence, setWorkspace, startExport,
    selectSceneEntity, markSceneChanged, add3DPrimitive, add3DLight, add3DCamera, set3DEntityTransform,
    update3DEntityTransform, set3DObjectMaterial, set3DLightIntensity, setActive3DCamera,
  }
})
