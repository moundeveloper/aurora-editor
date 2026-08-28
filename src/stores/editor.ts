import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import type {
  AnimatableProperty, Aurora3DScene, AuroraCamera, AuroraInfluenceType, AuroraLight,
  AuroraPathOrientation, AuroraPathPointMode,
  AuroraCameraCut, EditorLayer, EditorNode, EditorNodeConnection, EditorNodeKind, EditorProject,
  MediaAsset, SerializedEditorState, ShapePathPoint, WorkspaceId,
} from '@/models/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { ensureNumericKeyframe, setNumericPropertyAtTime, toggleNumericKeyframe } from '@/engine/animation/editNumericProperty'
import { deserializeEditorState, serializeEditorState } from '@/engine/project/serialization'
import { auroraProjectDatabase } from '@/engine/project/AuroraProjectDatabase'
import { create3DPath, createCameraPathConstraint, createDemo3DScene, createEmpty3DScene, createPrimitiveObject, makeTransform3D, numericProperty } from '@/engine/scene3d/sceneFactory'
import {
  appendPathPoint, insertPathPoint, movePathHandle, movePathPoint, prependPathPoint, setPathPointMode,
  type PathHandleKey, type PathVector,
} from '@/engine/scene3d/pathEditing'
import { createInfluence, influenceParameters } from '@/engine/scene3d/influences'
import { normalizeCameraCuts, sortedCameraCuts } from '@/engine/scene3d/cameraCuts'
import {
  canConnect, createDemoNodeGraph, createNode, NODE_DEFINITIONS, syncDynamicInputs, type ConnectionRequest,
} from '@/engine/nodes/nodeGraph'

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

export type TimelineLayerPreset = 'adjustment' | 'cinematic-grade' | '3d-scene' | 'text' | 'rectangle' | 'ellipse' | 'image' | 'video' | 'audio'

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
  const demoGraph = createDemoNodeGraph(layers.value)
  const nodes = ref<EditorNode[]>(demoGraph.nodes)
  const nodeConnections = ref<EditorNodeConnection[]>(demoGraph.connections)
  const selectedConnectionId = ref<string | null>(null)
  const renderRootNodeId = ref<string | null>(null)

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

  const defaultState = deserializeEditorState(null, currentState())
  let persistenceReady = false
  let saveTimer: number | null = null
  let changeRevision = 0
  let saveQueue: Promise<void> = Promise.resolve()

  function applyLoadedState(state: SerializedEditorState) {
    project.value = state.project
    layers.value = state.layers
    scenes3D.value = state.scenes3D
    assets.value = state.assets
    nodes.value = state.nodes
    nodeConnections.value = state.nodeConnections
    ensureClusterAssets()
  }

  function currentState(): SerializedEditorState {
    return {
      project: project.value,
      layers: layers.value,
      scenes3D: scenes3D.value,
      assets: assets.value,
      nodes: nodes.value,
      nodeConnections: nodeConnections.value,
    }
  }

  function projectSnapshot(): SerializedEditorState {
    return JSON.parse(serializeEditorState(currentState())) as SerializedEditorState
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

  /**
   * Clusters are editable contexts, not just folded groups: entering one opens a timeline tab whose
   * layer list is that cluster's children. Because a cluster can hold another cluster, tabs stack.
   */
  const openClusterTabs = ref<string[]>([])
  const activeClusterId = ref<string | null>(null)

  function findLayerDeep(list: EditorLayer[], id: string): EditorLayer | null {
    for (const layer of list) {
      if (layer.id === id) return layer
      const nested = layer.children ? findLayerDeep(layer.children, id) : null
      if (nested) return nested
    }
    return null
  }

  const activeCluster = computed(() => activeClusterId.value ? findLayerDeep(layers.value, activeClusterId.value) : null)
  /** The layer list the timeline is editing: the project root, or the open cluster's children. */
  const timelineLayers = computed(() => activeCluster.value?.children ?? layers.value)
  const clusterTabs = computed(() => openClusterTabs.value
    .map((id) => findLayerDeep(layers.value, id))
    .filter((layer): layer is EditorLayer => Boolean(layer)))

  function layerList() {
    return activeCluster.value?.children ?? layers.value
  }

  function replaceLayerList(next: EditorLayer[]) {
    const cluster = activeCluster.value
    if (cluster) cluster.children = next
    else layers.value = next
  }

  function flattenLayers(list: EditorLayer[] = layers.value): EditorLayer[] {
    return list.flatMap((layer) => [layer, ...(layer.children ? flattenLayers(layer.children) : [])])
  }

  function renameTimelineLayers(layerIds: string[], name: string) {
    const nextName = name.trim()
    if (!nextName) return false
    const ids = new Set(layerIds)
    const targets = flattenLayers().filter((layer) => ids.has(layer.id))
    if (!targets.length) return false
    targets.forEach((layer) => {
      layer.name = nextName
      if (layer.type === '3d-scene' && layer.sceneId) {
        const scene = scenes3D.value.find((item) => item.id === layer.sceneId)
        if (scene) scene.name = nextName
      }
    })
    markChanged()
    return true
  }

  function setTimelineLayersVisible(layerIds: string[], visible: boolean) {
    const ids = new Set(layerIds)
    const targets = flattenLayers().filter((layer) => ids.has(layer.id))
    if (!targets.length) return false
    targets.forEach((layer) => { layer.visible = visible })
    markChanged()
    return true
  }

  function deleteTimelineLayers(layerIds: string[]) {
    const ids = new Set(layerIds)
    const deleted = layerList().filter((layer) => ids.has(layer.id))
    if (!deleted.length) return false
    const deletedTree = flattenLayers(deleted)
    const deletedIds = new Set(deletedTree.map((layer) => layer.id))
    replaceLayerList(layerList().filter((layer) => !ids.has(layer.id)))
    openClusterTabs.value = openClusterTabs.value.filter((id) => !deletedIds.has(id))
    if (activeClusterId.value && deletedIds.has(activeClusterId.value)) activeClusterId.value = openClusterTabs.value.at(-1) ?? null
    const remaining = flattenLayers()
    const deletedSceneIds = new Set(deletedTree.flatMap((layer) => layer.type === '3d-scene' && layer.sceneId ? [layer.sceneId] : []))
    scenes3D.value = scenes3D.value.filter((scene) => !deletedSceneIds.has(scene.id)
      || remaining.some((layer) => layer.type === '3d-scene' && layer.sceneId === scene.id))
    if (!remaining.some((layer) => layer.id === selectedLayerId.value)) {
      selectedLayerId.value = layerList().find((layer) => !layer.isPlaceholder)?.id ?? activeClusterId.value ?? ''
      selectedKeyframeId.value = null
    }
    if (!scenes3D.value.some((scene) => scene.id === selectedSceneId.value)) {
      selectedSceneId.value = scenes3D.value[0]?.id ?? ''
      const scene = scenes3D.value[0]
      selectedSceneEntityId.value = scene?.objects[0]?.id ?? scene?.cameras[0]?.id ?? scene?.lights[0]?.id ?? scene?.paths[0]?.id ?? ''
    }
    markChanged()
    return true
  }

  const selectedLayer = computed(() => findLayerDeep(layers.value, selectedLayerId.value) ?? timelineLayers.value[0] ?? layers.value[0])
  const selectedScene = computed(() => scenes3D.value.find((scene) => scene.id === selectedSceneId.value) ?? scenes3D.value[0])
  const selectedSceneEntity = computed(() => {
    const scene = selectedScene.value
    if (!scene) return null
    const object = scene.objects.find((item) => item.id === selectedSceneEntityId.value)
    if (object) return { kind: 'object' as const, value: object }
    const camera = scene.cameras.find((item) => item.id === selectedSceneEntityId.value)
    if (camera) return { kind: 'camera' as const, value: camera }
    const light = scene.lights.find((item) => item.id === selectedSceneEntityId.value)
    if (light) return { kind: 'light' as const, value: light }
    const path = scene.paths?.find((item) => item.id === selectedSceneEntityId.value)
    return path ? { kind: 'path' as const, value: path } : null
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

  /**
   * `toRaw` only unwraps the object it is handed, so a cluster still holds reactive children and
   * cannot be structurally cloned. Unwrap the whole tree before copying it.
   */
  function rawLayerTree(layer: EditorLayer): EditorLayer {
    const raw = toRaw(layer)
    return raw.children?.length ? { ...raw, children: raw.children.map(rawLayerTree) } : raw
  }

  /** `atTime` lands the layer where it was dropped on the timeline; without it, at the playhead. */
  function addAssetToTimeline(assetId: string, atTime?: number) {
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset || asset.kind === 'model3d' || asset.kind === 'hdr' || asset.kind === 'texture') return
    const dropTime = Math.max(0, Math.min(project.value.duration, atTime ?? currentTime.value))
    if (asset.layerTemplate) {
      const layer = structuredClone(rawLayerTree(asset.layerTemplate))
      const delta = dropTime - layer.start
      const renewLayer = (item: EditorLayer) => {
        item.id = crypto.randomUUID()
        delete item.trackId
        item.start += delta
        ;(Object.keys(item.transform) as Array<keyof EditorLayer['transform']>).forEach((key) => {
          item.transform[key].id = `${item.id}-${key}`
          item.transform[key].keyframes.forEach((keyframe) => {
            keyframe.id = crypto.randomUUID()
            keyframe.time += delta
          })
        })
        item.children?.forEach(renewLayer)
      }
      renewLayer(layer)
      layer.name = asset.name
      layerList().splice(0, 0, layer)
      project.value.duration = Math.max(project.value.duration, layer.start + layer.duration)
      selectedLayerId.value = layer.id
      selectedKeyframeId.value = null
      markChanged()
      return layer
    }
    const type = asset.kind === 'composition' ? 'image' : asset.kind
    const layer: EditorLayer = {
      id: crypto.randomUUID(), name: asset.name.replace(/\.[^.]+$/, ''), type,
      start: dropTime, duration: Math.min(asset.duration ?? 6, Math.max(1 / project.value.frameRate, project.value.duration - dropTime)),
      color: type === 'audio' ? '#5c9b82' : type === 'image' ? '#6b99d5' : '#5477a8',
      visible: true, locked: false, muted: false, expanded: false,
      transform: makeTransform(crypto.randomUUID()), effects: [],
    }
    layerList().splice(type === 'audio' ? layerList().length : 0, 0, layer)
    selectedLayerId.value = layer.id
    markChanged()
    return layer
  }

  /** Keep newly authored Motion layers visible when the node graph is the active render path. */
  function attachLayerToCompositeGraph(layer: EditorLayer) {
    if (layer.type === 'audio' || nodes.value.some((node) => node.sourceId === layer.id)) return
    const output = nodes.value.find((node) => node.kind === 'output')
    const outputSocket = output?.inputs.find((socket) => socket.type === 'image')
    if (!output || !outputSocket) return

    const sourceKind: EditorNodeKind = layer.type === '3d-scene' ? 'scene3d' : layer.type === 'text' ? 'text' : 'image'
    const inputNodeXs = nodes.value.filter((node) => NODE_DEFINITIONS[node.kind].category === 'Input').map((node) => node.x)
    const source = createNode(sourceKind, Math.min(40, ...inputNodeXs), Math.max(30, ...nodes.value.map((node) => node.y + 90)))
    source.sourceId = layer.id
    source.title = layer.name
    const incoming = nodeConnections.value.find((connection) => connection.toNodeId === output.id && connection.toPortId === outputSocket.id)

    if (!incoming) {
      nodes.value.push(source)
      nodeConnections.value.push({
        id: crypto.randomUUID(), fromNodeId: source.id, fromPortId: source.outputs[0]!.id,
        toNodeId: output.id, toPortId: outputSocket.id,
      })
      return
    }

    const oldOutputX = output.x
    output.x += 190
    const mix = createNode('mix', oldOutputX, output.y)
    nodes.value.push(source, mix)
    nodeConnections.value = [
      ...nodeConnections.value.filter((connection) => connection.id !== incoming.id),
      { id: crypto.randomUUID(), fromNodeId: incoming.fromNodeId, fromPortId: incoming.fromPortId, toNodeId: mix.id, toPortId: mix.inputs[1]!.id },
      { id: crypto.randomUUID(), fromNodeId: source.id, fromPortId: source.outputs[0]!.id, toNodeId: mix.id, toPortId: mix.inputs[2]!.id },
      { id: crypto.randomUUID(), fromNodeId: mix.id, fromPortId: mix.outputs[0]!.id, toNodeId: output.id, toPortId: outputSocket.id },
    ]
  }

  function addGeneratedLayer(type: 'text' | 'shape', x: number, y: number, shapeKind: 'rectangle' | 'ellipse' = 'rectangle', shapeSize?: { width: number; height: number }) {
    const id = crypto.randomUUID()
    const layer: EditorLayer = {
      id,
      name: type === 'text' ? 'New Text' : shapeKind === 'ellipse' ? 'Ellipse' : 'Rectangle',
      type,
      shapeKind: type === 'shape' ? shapeKind : undefined,
      shapeWidth: type === 'shape' ? Math.max(1, shapeSize?.width ?? 280) : undefined,
      shapeHeight: type === 'shape' ? Math.max(1, shapeSize?.height ?? 180) : undefined,
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
    layerList().splice(0, 0, layer)
    selectedLayerId.value = layer.id
    selectedKeyframeId.value = null
    attachLayerToCompositeGraph(layer)
    markChanged()
    return layer
  }

  function addPathLayer(points: ShapePathPoint[], closed: boolean) {
    if (points.length < 2) return null
    const xs = points.flatMap((point) => [point.position[0], point.handleIn[0], point.handleOut[0]])
    const ys = points.flatMap((point) => [point.position[1], point.handleIn[1], point.handleOut[1]])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const localize = (value: [number, number]): [number, number] => [value[0] - centerX, value[1] - centerY]
    const id = crypto.randomUUID()
    const layer: EditorLayer = {
      id,
      name: 'Path',
      type: 'shape',
      shapeKind: 'path',
      shapeWidth: Math.max(1, maxX - minX),
      shapeHeight: Math.max(1, maxY - minY),
      shapePath: {
        closed,
        points: points.map((point) => ({
          ...point,
          position: localize(point.position),
          handleIn: localize(point.handleIn),
          handleOut: localize(point.handleOut),
        })),
      },
      start: currentTime.value,
      duration: Math.max(1 / project.value.frameRate, project.value.duration - currentTime.value),
      color: '#8c9bff',
      visible: true,
      locked: false,
      muted: false,
      expanded: false,
      transform: makeTransform(id),
      effects: [],
    }
    layer.transform.x.value = centerX
    layer.transform.y.value = centerY
    layerList().splice(0, 0, layer)
    selectedLayerId.value = layer.id
    selectedKeyframeId.value = null
    attachLayerToCompositeGraph(layer)
    markChanged()
    return layer
  }

  function addTimelineLayer(preset: TimelineLayerPreset) {
    const id = crypto.randomUUID()
    const isFullDuration = preset === 'adjustment' || preset === 'cinematic-grade'
    const isAudio = preset === 'audio'
    const shapeKind = preset === 'rectangle' || preset === 'ellipse' ? preset : undefined
    const type: EditorLayer['type'] = preset === 'cinematic-grade'
      ? 'adjustment'
      : preset === 'rectangle' || preset === 'ellipse'
        ? 'shape'
        : preset
    const labels: Record<TimelineLayerPreset, string> = {
      adjustment: 'Adjustment Layer',
      'cinematic-grade': 'Cinematic Grade',
      '3d-scene': '3D Scene',
      text: 'New Text',
      rectangle: 'Rectangle',
      ellipse: 'Ellipse',
      image: 'Image Layer',
      video: 'Video Layer',
      audio: 'Audio Layer',
    }
    const colors: Record<TimelineLayerPreset, string> = {
      adjustment: '#8e86d8',
      'cinematic-grade': '#9b8fe8',
      '3d-scene': '#7888db',
      text: '#d49b65',
      rectangle: '#8c9bff',
      ellipse: '#7296d8',
      image: '#6b99d5',
      video: '#5477a8',
      audio: '#5c9b82',
    }
    const frameDuration = 1 / project.value.frameRate
    const start = isFullDuration ? 0 : Math.min(currentTime.value, Math.max(0, project.value.duration - frameDuration))
    const layer: EditorLayer = {
      id,
      name: labels[preset],
      type,
      start,
      duration: isFullDuration ? project.value.duration : Math.max(frameDuration, project.value.duration - start),
      shapeKind,
      textContent: preset === 'text' ? 'New Text' : undefined,
      color: colors[preset],
      visible: true,
      locked: false,
      muted: false,
      expanded: false,
      transform: makeTransform(id),
      effects: preset === 'cinematic-grade' ? ['Color Matrix', 'Vignette'] : isAudio ? ['Gain'] : [],
    }

    if (preset === '3d-scene') {
      const sceneNumber = scenes3D.value.length + 1
      const scene = createEmpty3DScene(`3D Scene ${sceneNumber}`)
      scenes3D.value.push(scene)
      layer.name = scene.name
      layer.sceneId = scene.id
      selectedSceneId.value = scene.id
      selectedSceneEntityId.value = scene.cameras[0]!.id
    }

    layerList().splice(isAudio ? layerList().length : 0, 0, layer)
    selectedLayerId.value = layer.id
    selectedKeyframeId.value = null
    markChanged()
    return layer
  }

  function reorderTrack(sourceTrackId: string, targetTrackId: string, before: boolean) {
    if (sourceTrackId === targetTrackId) return
    const trackKey = (layer: EditorLayer) => layer.trackId ?? layer.id
    const sourceSegments = layerList().filter((layer) => trackKey(layer) === sourceTrackId)
    const targetSegments = layerList().filter((layer) => trackKey(layer) === targetTrackId)
    if (!sourceSegments.length || !targetSegments.length || (sourceSegments[0]!.type === 'audio') !== (targetSegments[0]!.type === 'audio')) return
    const remaining = layerList().filter((layer) => trackKey(layer) !== sourceTrackId)
    const targetIndices = remaining.map((layer, index) => trackKey(layer) === targetTrackId ? index : -1).filter((index) => index >= 0)
    const insertionIndex = before ? Math.min(...targetIndices) : Math.max(...targetIndices) + 1
    remaining.splice(insertionIndex, 0, ...sourceSegments)
    replaceLayerList(remaining)
    markChanged()
  }

  function moveSegmentToTrack(layerId: string, targetTrackId: string) {
    const segmentIndex = layerList().findIndex((layer) => layer.id === layerId)
    const segment = layerList()[segmentIndex]
    const target = layerList().find((layer) => (layer.trackId ?? layer.id) === targetTrackId)
    if (!segment || !target || (segment.type === 'audio') !== (target.type === 'audio')) return false
    const sourceTrackId = segment.trackId ?? segment.id
    if (sourceTrackId === targetTrackId) return false
    layerList().splice(segmentIndex, 1)
    if (!layerList().some((layer) => (layer.trackId ?? layer.id) === sourceTrackId)) {
      layerList().splice(Math.min(segmentIndex, layerList().length), 0, makeEmptyTrack(segment.type === 'audio' ? 'audio' : 'visual', sourceTrackId))
    }
    const targetPlaceholderIndex = layerList().findIndex((layer) => (layer.trackId ?? layer.id) === targetTrackId && layer.isPlaceholder)
    if (targetPlaceholderIndex >= 0) layerList().splice(targetPlaceholderIndex, 1)
    segment.trackId = targetTrackId
    const lastTargetIndex = layerList().reduce((last, layer, index) => (layer.trackId ?? layer.id) === targetTrackId ? index : last, -1)
    const insertionIndex = lastTargetIndex >= 0 ? lastTargetIndex + 1 : Math.max(0, targetPlaceholderIndex)
    layerList().splice(insertionIndex, 0, segment)
    selectedLayerId.value = segment.id
    markChanged()
    return true
  }

  function moveSegmentToNewTrack(layerId: string, category: 'visual' | 'audio') {
    const index = layerList().findIndex((layer) => layer.id === layerId)
    const segment = layerList()[index]
    if (!segment || (segment.type === 'audio') !== (category === 'audio')) return false
    const sourceTrackId = segment.trackId ?? segment.id
    layerList().splice(index, 1)
    if (!layerList().some((layer) => (layer.trackId ?? layer.id) === sourceTrackId)) {
      layerList().splice(Math.min(index, layerList().length), 0, makeEmptyTrack(category, sourceTrackId))
    }
    segment.trackId = crypto.randomUUID()
    const insertionIndex = category === 'audio' ? layerList().length : 0
    layerList().splice(insertionIndex, 0, segment)
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
    const firstAudio = layerList().findIndex((item) => item.type === 'audio')
    layerList().splice(isAudio ? layerList().length : (firstAudio < 0 ? layerList().length : firstAudio), 0, layer)
    selectedLayerId.value = layer.id
    markChanged()
    return layer
  }

  /**
   * Every cluster owns a Library entry, so it can be reused straight away — including an empty one
   * you are still building. The entry is a snapshot, so it is refreshed whenever the cluster changes
   * rather than left describing whatever the cluster looked like the moment it was made.
   */
  function publishClusterAsset(cluster: EditorLayer) {
    const snapshot = structuredClone(rawLayerTree(cluster))
    const count = cluster.children?.length ?? 0
    const existing = cluster.assetId ? assets.value.find((asset) => asset.id === cluster.assetId) : undefined
    if (existing) {
      existing.name = cluster.name
      existing.duration = cluster.duration
      existing.sizeLabel = `${count} reusable ${count === 1 ? 'layer' : 'layers'}`
      existing.layerTemplate = snapshot
      return existing
    }
    const asset: MediaAsset = {
      id: crypto.randomUUID(),
      name: cluster.name,
      kind: 'composition',
      duration: cluster.duration,
      dimensions: `${project.value.width} × ${project.value.height}`,
      sizeLabel: `${count} reusable ${count === 1 ? 'layer' : 'layers'}`,
      layerTemplate: snapshot,
    }
    cluster.assetId = asset.id
    assets.value.unshift(asset)
    return asset
  }

  /** Keeps the Library entries of the clusters being edited in step with their contents. */
  function syncOpenClusterAssets() {
    openClusterTabs.value.forEach((id) => {
      const cluster = findLayerDeep(layers.value, id)
      if (cluster?.assetId) publishClusterAsset(cluster)
    })
  }

  /**
   * Clusters made before they published themselves — or loaded from an older project — would never
   * appear in the Library. Give any cluster still missing an entry one, at whatever depth it sits.
   */
  function ensureClusterAssets(list: EditorLayer[] = layers.value) {
    list.forEach((layer) => {
      if (layer.type === 'cluster' && !assets.value.some((asset) => asset.id === layer.assetId)) publishClusterAsset(layer)
      if (layer.children?.length) ensureClusterAssets(layer.children)
    })
  }

  const contextKey = (clusterId: string | null) => clusterId ?? 'main'
  const contextPlayheads = ref<Record<string, number>>({})

  /**
   * Each timeline tab keeps its own playhead. Moving the cursor inside a cluster must not drag the
   * main timeline's cursor with it, so the outgoing tab's time is stashed and the incoming tab's
   * restored — a cluster opened for the first time starts at its own first frame.
   */
  function switchPlayheadContext(nextClusterId: string | null) {
    contextPlayheads.value[contextKey(activeClusterId.value)] = currentTime.value
    const saved = contextPlayheads.value[contextKey(nextClusterId)]
    if (saved !== undefined) {
      currentTime.value = saved
      return
    }
    const cluster = nextClusterId ? findLayerDeep(layers.value, nextClusterId) : null
    if (cluster) currentTime.value = cluster.start
  }

  /** Grows a cluster so it still covers everything inside it after an edit. Never shrinks it. */
  function fitClusterToChildren(clusterId: string | null) {
    const cluster = clusterId ? findLayerDeep(layers.value, clusterId) : null
    if (!cluster?.children?.length) return
    const end = Math.max(...cluster.children.map((child) => child.start + child.duration))
    const nextDuration = Math.max(cluster.duration, end - cluster.start)
    if (nextDuration === cluster.duration) return
    cluster.duration = nextDuration
    markChanged()
  }

  /** Opens the cluster as a timeline tab and switches to it. Re-entering focuses the existing tab. */
  function enterCluster(clusterId: string) {
    const cluster = findLayerDeep(layers.value, clusterId)
    if (cluster?.type !== 'cluster') return false
    if (!openClusterTabs.value.includes(clusterId)) openClusterTabs.value = [...openClusterTabs.value, clusterId]
    switchPlayheadContext(clusterId)
    activeClusterId.value = clusterId
    selectedLayerId.value = cluster.children?.[0]?.id ?? clusterId
    selectedKeyframeId.value = null
    return true
  }

  function activateTimelineTab(clusterId: string | null) {
    if (clusterId && !openClusterTabs.value.includes(clusterId)) return
    if (clusterId !== activeClusterId.value) switchPlayheadContext(clusterId)
    activeClusterId.value = clusterId
    const context = clusterId ? findLayerDeep(layers.value, clusterId)?.children ?? [] : layers.value
    if (!context.some((layer) => layer.id === selectedLayerId.value)) {
      selectedLayerId.value = context.find((layer) => !layer.isPlaceholder)?.id ?? selectedLayerId.value
    }
    selectedKeyframeId.value = null
  }

  function closeClusterTab(clusterId: string) {
    openClusterTabs.value = openClusterTabs.value.filter((id) => id !== clusterId)
    if (activeClusterId.value === clusterId) activateTimelineTab(openClusterTabs.value.at(-1) ?? null)
  }

  /** A cluster with nothing in it yet, opened straight away so it can be built from the inside. */
  function createEmptyCluster() {
    const id = crypto.randomUUID()
    const frameDuration = 1 / project.value.frameRate
    const start = Math.min(currentTime.value, Math.max(0, project.value.duration - frameDuration))
    const cluster: EditorLayer = {
      id,
      name: `Cluster ${clusterCounter++}`,
      type: 'cluster',
      start,
      duration: Math.max(frameDuration, Math.min(5, project.value.duration - start)),
      color: '#7f8fe2',
      visible: true,
      locked: false,
      muted: false,
      expanded: false,
      transform: makeTransform(id),
      effects: [],
      children: [],
    }
    layerList().splice(0, 0, cluster)
    publishClusterAsset(cluster)
    markChanged()
    enterCluster(cluster.id)
    return cluster
  }

  function createCluster(layerIds: string[]) {
    const selectedIds = new Set(layerIds)
    const children = layerList().filter((layer) => selectedIds.has(layer.id) && layer.type !== 'audio' && !layer.isPlaceholder)
    if (!children.length) return null
    const childIds = new Set(children.map((layer) => layer.id))
    const firstIndex = layerList().findIndex((layer) => childIds.has(layer.id))
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
    publishClusterAsset(cluster)
    replaceLayerList(layerList().filter((layer) => !childIds.has(layer.id)))
    layerList().splice(Math.max(0, Math.min(firstIndex, layerList().length)), 0, cluster)
    selectedLayerId.value = cluster.id
    selectedKeyframeId.value = null
    markChanged()
    return cluster
  }

  function releaseCluster(clusterId: string) {
    const index = layerList().findIndex((layer) => layer.id === clusterId && layer.type === 'cluster')
    const cluster = layerList()[index]
    if (!cluster?.children?.length) return false
    layerList().splice(index, 1, ...cluster.children)
    selectedLayerId.value = cluster.children[0]!.id
    selectedKeyframeId.value = null
    markChanged()
    return true
  }

  function splitLayerAt(layerId: string, requestedTime: number) {
    const index = layerList().findIndex((item) => item.id === layerId)
    const layer = layerList()[index]
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

    layerList().splice(index + 1, 0, right)
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
    ensureClusterAssets()
    syncOpenClusterAssets()
    changeRevision += 1
    saveStatus.value = 'Saving…'
    if (typeof window === 'undefined') return
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
    if (nextWorkspace === '3D') {
      const layer = layers.value.find((item) => item.id === selectedLayerId.value && item.type === '3d-scene')
        ?? layers.value.find((item) => item.type === '3d-scene' && item.sceneId === selectedSceneId.value)
        ?? layers.value.find((item) => item.type === '3d-scene')
      if (layer) select3DLayer(layer.id)
    }
  }

  function select3DLayer(layerId: string) {
    const layer = layers.value.find((item) => item.id === layerId && item.type === '3d-scene')
    const scene = layer?.sceneId ? scenes3D.value.find((item) => item.id === layer.sceneId) : undefined
    if (!layer || !scene) return
    selectedLayerId.value = layer.id
    selectedSceneId.value = scene.id
    const entityExists = scene.objects.some((item) => item.id === selectedSceneEntityId.value)
      || scene.cameras.some((item) => item.id === selectedSceneEntityId.value)
      || scene.lights.some((item) => item.id === selectedSceneEntityId.value)
      || scene.paths.some((item) => item.id === selectedSceneEntityId.value)
    if (!entityExists) selectedSceneEntityId.value = scene.objects[0]?.id ?? scene.cameras[0]?.id ?? scene.lights[0]?.id ?? scene.paths[0]?.id ?? ''
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
      visible: true,
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
      visible: true,
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

  function selected3DNumericProperties() {
    const entity = selectedSceneEntity.value
    if (!entity) return []
    const transformProperties = (['position', 'rotation', 'scale'] as const).flatMap((group) =>
      (['x', 'y', 'z'] as const).map((axis) => entity.value.transform[group][axis]),
    )
    if (entity.kind === 'object') {
      const influenceProperties = (entity.value.influences ?? []).flatMap((influence) => influenceParameters(influence).map((item) => item.property))
      return [
        ...transformProperties,
        entity.value.material.metalness, entity.value.material.roughness,
        entity.value.material.opacity, entity.value.material.emissiveIntensity,
        ...influenceProperties,
      ]
    }
    if (entity.kind === 'camera') {
      const constraint = entity.value.pathConstraint
      const constraintProperties = constraint
        ? [constraint.progress, constraint.bank, constraint.offset.x, constraint.offset.y, constraint.offset.z]
        : []
      return [...transformProperties, entity.value.fov, ...constraintProperties]
    }
    if (entity.kind === 'path') return transformProperties
    return [...transformProperties, entity.value.intensity]
  }

  function findSelected3DProperty(propertyId: string) {
    return selected3DNumericProperties().find((property) => property.id === propertyId)
  }

  function apply3DPropertyValue(property: AnimatableProperty<number>, value: number) {
    const result = setNumericPropertyAtTime(property, value, currentTime.value, project.value.frameRate, {
      autoKey: autoKey.value,
      selectedKeyframeId: selectedKeyframeId.value,
    })
    if (result.keyframeId) selectedKeyframeId.value = result.keyframeId
    return result.changed
  }

  function set3DEntityTransform(group: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', value: number) {
    const entity = selectedSceneEntity.value
    if (!entity) return
    if (apply3DPropertyValue(entity.value.transform[group][axis], value)) markSceneChanged()
  }

  function update3DEntityTransform(entityId: string, values: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }) {
    const scene = selectedScene.value
    const entity = scene
      ? scene.objects.find((item) => item.id === entityId)
        ?? scene.cameras.find((item) => item.id === entityId)
        ?? scene.lights.find((item) => item.id === entityId)
        ?? scene.paths?.find((item) => item.id === entityId)
      : undefined
    if (!scene || !entity) return
    let changed = false
    ;(['x', 'y', 'z'] as const).forEach((axis, index) => {
      changed = apply3DPropertyValue(entity.transform.position[axis], values.position[index]!) || changed
      changed = apply3DPropertyValue(entity.transform.rotation[axis], values.rotation[index]!) || changed
      changed = apply3DPropertyValue(entity.transform.scale[axis], values.scale[index]!) || changed
    })
    if (changed) markSceneChanged(scene)
  }

  function set3DObjectMaterial(key: 'metalness' | 'roughness' | 'opacity' | 'emissiveIntensity', value: number) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'object') return
    if (apply3DPropertyValue(entity.value.material[key], value)) markSceneChanged()
  }

  function set3DLightIntensity(value: number) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'light') return
    if (apply3DPropertyValue(entity.value.intensity, value)) markSceneChanged()
  }

  function set3DCameraFov(value: number) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'camera') return
    if (apply3DPropertyValue(entity.value.fov, value)) markSceneChanged()
  }

  function selectedObject() {
    const entity = selectedSceneEntity.value
    return entity?.kind === 'object' ? entity.value : null
  }

  function add3DInfluence(type: AuroraInfluenceType) {
    const object = selectedObject()
    if (!object) return null
    if (!Array.isArray(object.influences)) object.influences = []
    const sameType = object.influences.filter((influence) => influence.type === type).length
    const influence = createInfluence(type, sameType + 1)
    object.influences.push(influence)
    markSceneChanged()
    return influence
  }

  function remove3DInfluence(influenceId: string) {
    const object = selectedObject()
    if (!object?.influences?.some((influence) => influence.id === influenceId)) return
    object.influences = object.influences.filter((influence) => influence.id !== influenceId)
    markSceneChanged()
  }

  function toggle3DInfluence(influenceId: string) {
    const influence = selectedObject()?.influences?.find((item) => item.id === influenceId)
    if (!influence) return
    influence.enabled = !influence.enabled
    markSceneChanged()
  }

  /** Stack order is the evaluation order, so moving an entry changes the resulting geometry. */
  function move3DInfluence(influenceId: string, direction: -1 | 1) {
    const object = selectedObject()
    const index = object?.influences?.findIndex((influence) => influence.id === influenceId) ?? -1
    const target = index + direction
    if (!object || index < 0 || target < 0 || target >= object.influences.length) return
    const [influence] = object.influences.splice(index, 1)
    object.influences.splice(target, 0, influence!)
    markSceneChanged()
  }

  function set3DInfluenceParameter(influenceId: string, key: string, value: number) {
    const influence = selectedObject()?.influences?.find((item) => item.id === influenceId)
    const property = influence?.parameters[key]
    if (!property || !Number.isFinite(value)) return
    if (apply3DPropertyValue(property, value)) markSceneChanged()
  }

  function findScenePath(pathId: string) {
    return selectedScene.value?.paths?.find((path) => path.id === pathId)
  }

  function add3DPath() {
    const scene = selectedScene.value
    if (!scene) return null
    if (!Array.isArray(scene.paths)) scene.paths = []
    const path = create3DPath(scene.paths.length + 1)
    scene.paths.push(path)
    selectedSceneEntityId.value = path.id
    markSceneChanged(scene)
    return path
  }

  function rename3DEntity(entityId: string, name: string) {
    const scene = selectedScene.value
    const nextName = name.trim()
    if (!scene || !nextName) return false
    const entity = [...scene.objects, ...scene.cameras, ...scene.lights, ...(scene.paths ?? [])].find((item) => item.id === entityId)
    if (!entity) return false
    entity.name = nextName
    markSceneChanged(scene)
    return true
  }

  function set3DEntityVisible(entityId: string, visible: boolean) {
    const scene = selectedScene.value
    if (!scene) return false
    const entity = [...scene.objects, ...scene.cameras, ...scene.lights, ...(scene.paths ?? [])].find((item) => item.id === entityId)
    if (!entity) return false
    entity.visible = visible
    markSceneChanged(scene)
    return true
  }

  function delete3DEntity(entityId: string) {
    const scene = selectedScene.value
    if (!scene) return false
    if (scene.paths.some((path) => path.id === entityId)) {
      delete3DPath(entityId)
      return true
    }
    const objectIndex = scene.objects.findIndex((item) => item.id === entityId)
    const cameraIndex = scene.cameras.findIndex((item) => item.id === entityId)
    const lightIndex = scene.lights.findIndex((item) => item.id === entityId)
    if (objectIndex >= 0) {
      scene.objects.splice(objectIndex, 1)
      scene.objects.forEach((object) => { if (object.parentId === entityId) delete object.parentId })
      scene.cameras.forEach((camera) => {
        if (camera.pathConstraint?.lookAtEntityId === entityId) delete camera.pathConstraint.lookAtEntityId
      })
    } else if (cameraIndex >= 0) {
      if (scene.cameras.length <= 1) return false
      scene.cameras.splice(cameraIndex, 1)
      scene.cameraCuts = normalizeCameraCuts(scene, scene.cameraCuts.filter((cut) => cut.cameraId !== entityId))
      if (scene.activeCameraId === entityId) scene.activeCameraId = scene.cameraCuts[0]?.cameraId ?? scene.cameras[0]?.id ?? null
    } else if (lightIndex >= 0) scene.lights.splice(lightIndex, 1)
    else return false
    if (selectedSceneEntityId.value === entityId) {
      selectedSceneEntityId.value = scene.objects[0]?.id ?? scene.cameras[0]?.id ?? scene.lights[0]?.id ?? scene.paths[0]?.id ?? ''
    }
    markSceneChanged(scene)
    return true
  }

  function delete3DPath(pathId: string) {
    const scene = selectedScene.value
    if (!scene?.paths?.some((path) => path.id === pathId)) return
    scene.paths = scene.paths.filter((path) => path.id !== pathId)
    scene.cameras.forEach((camera) => {
      if (camera.pathConstraint?.pathId === pathId) delete camera.pathConstraint
    })
    if (selectedSceneEntityId.value === pathId) selectedSceneEntityId.value = scene.activeCameraId ?? scene.objects[0]?.id ?? ''
    markSceneChanged(scene)
  }

  function move3DPathPoint(pathId: string, pointId: string, target: PathHandleKey, position: PathVector) {
    const path = findScenePath(pathId)
    const point = path?.points.find((item) => item.id === pointId)
    if (!path || !point || path.locked) return
    if (target === 'position') movePathPoint(point, position)
    else movePathHandle(point, target, position)
    markSceneChanged()
  }

  function set3DPathPointAxis(pathId: string, pointId: string, target: PathHandleKey, axis: 0 | 1 | 2, value: number) {
    const point = findScenePath(pathId)?.points.find((item) => item.id === pointId)
    if (!point || !Number.isFinite(value)) return
    const next = [...point[target]] as PathVector
    next[axis] = value
    move3DPathPoint(pathId, pointId, target, next)
  }

  function set3DPathPointMode(pathId: string, pointId: string, mode: AuroraPathPointMode) {
    const path = findScenePath(pathId)
    if (!path || path.locked) return
    setPathPointMode(path, pointId, mode)
    markSceneChanged()
  }

  /** Adds a point in the middle of the segment that follows `afterPointId`, or extends the open end. */
  function add3DPathPoint(pathId: string, afterPointId?: string) {
    const path = findScenePath(pathId)
    if (!path || path.locked) return null
    const index = afterPointId ? path.points.findIndex((point) => point.id === afterPointId) : path.points.length - 1
    const hasFollowingSegment = index >= 0 && (path.closed || index < path.points.length - 1)
    const point = hasFollowingSegment ? insertPathPoint(path, index) : appendPathPoint(path)
    if (point) markSceneChanged()
    return point
  }

  function add3DPathEndpoint(pathId: string, side: 'start' | 'end') {
    const path = findScenePath(pathId)
    if (!path || path.locked || path.closed) return null
    const point = side === 'start' ? prependPathPoint(path) : appendPathPoint(path)
    if (point) markSceneChanged()
    return point
  }

  function delete3DPathPoint(pathId: string, pointId: string) {
    const path = findScenePath(pathId)
    if (!path || path.locked || path.points.length <= 2) return false
    path.points = path.points.filter((point) => point.id !== pointId)
    markSceneChanged()
    return true
  }

  function toggle3DPathClosed(pathId: string) {
    const path = findScenePath(pathId)
    if (!path || path.locked) return
    path.closed = !path.closed
    markSceneChanged()
  }

  function set3DPathColor(pathId: string, color: string) {
    const path = findScenePath(pathId)
    if (!path) return
    path.color = color
    markSceneChanged()
  }

  function set3DPathLocked(pathId: string, locked: boolean) {
    const path = findScenePath(pathId)
    if (!path) return
    path.locked = locked
    markSceneChanged()
  }

  function selectedCamera(): AuroraCamera | null {
    const entity = selectedSceneEntity.value
    return entity?.kind === 'camera' ? entity.value : null
  }

  function setCameraPathConstraint(pathId: string | null) {
    const camera = selectedCamera()
    if (!camera) return
    if (!pathId) delete camera.pathConstraint
    else if (camera.pathConstraint) camera.pathConstraint.pathId = pathId
    else camera.pathConstraint = createCameraPathConstraint(camera.id, pathId)
    markSceneChanged()
  }

  function setCameraPathOrientation(orientation: AuroraPathOrientation) {
    const constraint = selectedCamera()?.pathConstraint
    if (!constraint) return
    constraint.orientation = orientation
    markSceneChanged()
  }

  function setCameraPathTarget(entityId: string | null) {
    const constraint = selectedCamera()?.pathConstraint
    if (!constraint) return
    if (entityId) constraint.lookAtEntityId = entityId
    else delete constraint.lookAtEntityId
    markSceneChanged()
  }

  function setCameraPathProgress(value: number) {
    const constraint = selectedCamera()?.pathConstraint
    if (!constraint) return
    if (apply3DPropertyValue(constraint.progress, Math.max(0, Math.min(1, value)))) markSceneChanged()
  }

  function setCameraPathBank(value: number) {
    const constraint = selectedCamera()?.pathConstraint
    if (!constraint) return
    if (apply3DPropertyValue(constraint.bank, value)) markSceneChanged()
  }

  function setCameraPathOffset(axis: 'x' | 'y' | 'z', value: number) {
    const constraint = selectedCamera()?.pathConstraint
    if (!constraint || !Number.isFinite(value)) return
    if (apply3DPropertyValue(constraint.offset[axis], value)) markSceneChanged()
  }

  function resetCameraPathOffset() {
    const constraint = selectedCamera()?.pathConstraint
    if (!constraint) return
    let changed = false
    ;(['x', 'y', 'z'] as const).forEach((axis) => { changed = apply3DPropertyValue(constraint.offset[axis], 0) || changed })
    if (changed) markSceneChanged()
  }

  function toggleLayerPropertyKeyframe(property: AnimatableProperty<number>) {
    selectedKeyframeId.value = toggleNumericKeyframe(property, currentTime.value, project.value.frameRate)
    markChanged()
  }

  function toggle3DPropertyKeyframe(property: AnimatableProperty<number>) {
    selectedKeyframeId.value = toggleNumericKeyframe(property, currentTime.value, project.value.frameRate)
    markSceneChanged()
  }

  /** Moves the playhead onto the neighbouring keyframe of a single channel and selects it. */
  function stepToAdjacentKeyframe(property: AnimatableProperty<number>, direction: -1 | 1) {
    const tolerance = (0.5 / project.value.frameRate) + 0.0001
    const ordered = [...property.keyframes].sort((left, right) => left.time - right.time)
    const target = direction > 0
      ? ordered.find((keyframe) => keyframe.time > currentTime.value + tolerance)
      : ordered.reverse().find((keyframe) => keyframe.time < currentTime.value - tolerance)
    if (!target) return false
    currentTime.value = Math.max(0, Math.min(project.value.duration, target.time))
    selectedKeyframeId.value = target.id
    return true
  }

  function hasAdjacentKeyframe(property: AnimatableProperty<number>, direction: -1 | 1) {
    const tolerance = (0.5 / project.value.frameRate) + 0.0001
    return property.keyframes.some((keyframe) => direction > 0
      ? keyframe.time > currentTime.value + tolerance
      : keyframe.time < currentTime.value - tolerance)
  }

  function isKeyedAtPlayhead(property: AnimatableProperty<number>) {
    const tolerance = (0.5 / project.value.frameRate) + 0.0001
    return property.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId.value || Math.abs(keyframe.time - currentTime.value) <= tolerance)
  }

  function toggle3DKeyframe(propertyId: string) {
    const property = findSelected3DProperty(propertyId)
    if (!property) return
    selectedKeyframeId.value = toggleNumericKeyframe(property, currentTime.value, project.value.frameRate)
    markSceneChanged()
  }

  function keySelected3DTransform() {
    const entity = selectedSceneEntity.value
    if (!entity) return
    const properties = (['position', 'rotation', 'scale'] as const).flatMap((group) =>
      (['x', 'y', 'z'] as const).map((axis) => entity.value.transform[group][axis]),
    )
    properties.forEach((property) => { selectedKeyframeId.value = ensureNumericKeyframe(property, currentTime.value, project.value.frameRate) })
    markSceneChanged()
  }

  function move3DKeyframe(propertyId: string, keyframeId: string, time: number) {
    const property = findSelected3DProperty(propertyId)
    const keyframe = property?.keyframes.find((item) => item.id === keyframeId)
    if (!property || !keyframe) return
    const frameTime = snap.value ? Math.round(time * project.value.frameRate) / project.value.frameRate : time
    keyframe.time = Math.max(0, Math.min(project.value.duration, frameTime))
    property.keyframes.sort((left, right) => left.time - right.time)
    selectedKeyframeId.value = keyframe.id
    markSceneChanged()
  }

  function delete3DKeyframe(propertyId: string, keyframeId: string) {
    const property = findSelected3DProperty(propertyId)
    if (!property || !property.keyframes.some((keyframe) => keyframe.id === keyframeId)) return
    property.keyframes = property.keyframes.filter((keyframe) => keyframe.id !== keyframeId)
    property.animated = property.keyframes.length > 0
    if (selectedKeyframeId.value === keyframeId) selectedKeyframeId.value = null
    markSceneChanged()
  }

  function setActive3DCamera(cameraId: string) {
    const scene = selectedScene.value
    if (!scene || !scene.cameras.some((camera) => camera.id === cameraId)) return
    scene.activeCameraId = cameraId
    selectedSceneEntityId.value = cameraId
    markSceneChanged(scene)
  }

  function add3DCameraCut(cameraId: string, time: number = currentTime.value) {
    const scene = selectedScene.value
    if (!scene || !scene.cameras.some((camera) => camera.id === cameraId)) return null
    const frameTime = Math.round(Math.max(0, Math.min(project.value.duration, time)) * project.value.frameRate) / project.value.frameRate
    const tolerance = .5 / project.value.frameRate
    const existing = scene.cameraCuts.find((cut) => Math.abs(cut.time - frameTime) <= tolerance)
    if (existing) {
      existing.cameraId = cameraId
      scene.cameraCuts = normalizeCameraCuts(scene)
      markSceneChanged(scene)
      return existing
    }
    const cut: AuroraCameraCut = { id: crypto.randomUUID(), cameraId, time: frameTime }
    scene.cameraCuts.push(cut)
    scene.cameraCuts = normalizeCameraCuts(scene)
    markSceneChanged(scene)
    return cut
  }

  function set3DCameraCutCamera(cutId: string, cameraId: string) {
    const scene = selectedScene.value
    const cut = scene?.cameraCuts.find((item) => item.id === cutId)
    if (!scene || !cut || !scene.cameras.some((camera) => camera.id === cameraId)) return
    cut.cameraId = cameraId
    markSceneChanged(scene)
  }

  function move3DCameraCut(cutId: string, time: number) {
    const scene = selectedScene.value
    if (!scene) return
    const cuts = sortedCameraCuts(scene)
    const index = cuts.findIndex((cut) => cut.id === cutId)
    if (index <= 0) return
    const frame = 1 / project.value.frameRate
    const previous = cuts[index - 1]!
    const next = cuts[index + 1]
    let frameTime = snap.value ? Math.round(time * project.value.frameRate) / project.value.frameRate : time
    frameTime = Math.max(previous.time + frame, Math.min((next?.time ?? project.value.duration + frame) - frame, frameTime))
    cuts[index]!.time = frameTime
    scene.cameraCuts = normalizeCameraCuts(scene, cuts)
    currentTime.value = frameTime
    markSceneChanged(scene)
  }

  function delete3DCameraCut(cutId: string) {
    const scene = selectedScene.value
    if (!scene || scene.cameraCuts.length <= 1) return
    const cuts = sortedCameraCuts(scene)
    if (cuts[0]?.id === cutId) return
    scene.cameraCuts = normalizeCameraCuts(scene, cuts.filter((cut) => cut.id !== cutId))
    markSceneChanged(scene)
  }

  function selectNode(nodeId: string | null) {
    selectedNodeId.value = nodeId ?? ''
    if (nodeId) selectedConnectionId.value = null
  }

  function selectNodeConnection(connectionId: string | null) {
    selectedConnectionId.value = connectionId
    if (connectionId) selectedNodeId.value = ''
  }

  function addNode(kind: EditorNodeKind, x: number, y: number) {
    const node = createNode(kind, x, y)
    nodes.value.push(node)
    selectNode(node.id)
    markChanged()
    return node
  }

  function moveNode(nodeId: string, x: number, y: number) {
    const node = nodes.value.find((item) => item.id === nodeId)
    if (!node || (node.x === Math.round(x) && node.y === Math.round(y))) return
    node.x = Math.round(x)
    node.y = Math.round(y)
    markChanged()
  }

  function deleteNode(nodeId: string) {
    if (!nodes.value.some((node) => node.id === nodeId)) return
    nodes.value = nodes.value.filter((node) => node.id !== nodeId)
    nodeConnections.value = nodeConnections.value.filter((connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId)
    if (selectedNodeId.value === nodeId) selectedNodeId.value = ''
    if (renderRootNodeId.value === nodeId) renderRootNodeId.value = null
    refreshDynamicInputs()
    markChanged()
  }

  /** An input takes a single link, so connecting to a used one replaces what was there. */
  function connectNodes(request: ConnectionRequest) {
    if (!canConnect(nodes.value, nodeConnections.value, request)) return null
    const connection: EditorNodeConnection = { id: crypto.randomUUID(), ...request }
    nodeConnections.value = [
      ...nodeConnections.value.filter((item) => !(item.toNodeId === request.toNodeId && item.toPortId === request.toPortId)),
      connection,
    ]
    refreshDynamicInputs()
    selectNodeConnection(connection.id)
    markChanged()
    return connection
  }

  function disconnectNodes(connectionId: string) {
    if (!nodeConnections.value.some((connection) => connection.id === connectionId)) return
    nodeConnections.value = nodeConnections.value.filter((connection) => connection.id !== connectionId)
    refreshDynamicInputs()
    if (selectedConnectionId.value === connectionId) selectedConnectionId.value = null
    markChanged()
  }

  function refreshDynamicInputs() {
    nodes.value.forEach((node) => syncDynamicInputs(node, nodeConnections.value))
  }

  function setNodeSource(nodeId: string, sourceId: string | null) {
    const node = nodes.value.find((item) => item.id === nodeId)
    if (!node) return
    if (sourceId) node.sourceId = sourceId
    else delete node.sourceId
    const layer = sourceId ? layers.value.find((item) => item.id === sourceId) : undefined
    node.title = layer?.name ?? NODE_DEFINITIONS[node.kind].label
    markChanged()
  }

  /** Writes the inline default of an unlinked input socket. A linked socket takes its value upstream. */
  function setNodeSocketValue(nodeId: string, socketId: string, value: number) {
    const socket = nodes.value.find((item) => item.id === nodeId)?.inputs.find((item) => item.id === socketId)
    if (!socket || !Number.isFinite(value) || socket.value === value) return
    socket.value = value
    markChanged()
  }

  function setNodeProperty(nodeId: string, key: string, value: string) {
    const node = nodes.value.find((item) => item.id === nodeId)
    if (!node || node.properties[key] === value) return
    node.properties[key] = value
    markChanged()
  }

  function setNodeMaskEdgeFeather(nodeId: string, values: number[]) {
    const node = nodes.value.find((item) => item.id === nodeId && item.kind === 'mask')
    if (!node) return
    node.maskEdgeFeather = values.map((value) => Math.max(0, Math.min(1, value)))
    markChanged()
  }

  function toggleNodeMuted(nodeId: string) {
    const node = nodes.value.find((item) => item.id === nodeId)
    if (!node) return
    node.muted = !node.muted
    markChanged()
  }

  /** Activating a Viewer redirects the viewport to that branch; deactivating returns it to Composite. */
  function setRenderRootNode(nodeId: string | null) {
    const node = nodeId ? nodes.value.find((item) => item.id === nodeId) : null
    renderRootNodeId.value = node?.kind === 'viewer' ? node.id : null
    markChanged()
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
    nodes, nodeConnections, selectedConnectionId, renderRootNodeId,
    selectNode, selectNodeConnection, addNode, moveNode, deleteNode, connectNodes, disconnectNodes,
    setNodeSource, setNodeSocketValue, setNodeProperty, setNodeMaskEdgeFeather, toggleNodeMuted, setRenderRootNode,
    selectedLayer, selectedScene, selectedSceneEntity,
    togglePlayback, setTime, stepFrame, setProjectDuration, addKeyframe, setLayerValue, addFiles,
    addAssetToTimeline, addGeneratedLayer, addPathLayer, addTimelineLayer, reorderTrack, moveSegmentToTrack, moveSegmentToNewTrack, addEmptyTrack,
    renameTimelineLayers, setTimelineLayersVisible, deleteTimelineLayers,
    createCluster, releaseCluster, createEmptyCluster,
    openClusterTabs, activeClusterId, activeCluster, timelineLayers, clusterTabs,
    enterCluster, activateTimelineTab, closeClusterTab, fitClusterToChildren, publishClusterAsset, ensureClusterAssets,
    splitLayerAt, splitSelectedLayer, markChanged, saveProjectNow, flushProjectSave, initializePersistence, setWorkspace, startExport,
    selectSceneEntity, select3DLayer, markSceneChanged, add3DPrimitive, add3DLight, add3DCamera, set3DEntityTransform,
    rename3DEntity, set3DEntityVisible, delete3DEntity,
    update3DEntityTransform, set3DObjectMaterial, set3DLightIntensity, set3DCameraFov,
    toggle3DKeyframe, keySelected3DTransform, move3DKeyframe, delete3DKeyframe, setActive3DCamera,
    add3DCameraCut, set3DCameraCutCamera, move3DCameraCut, delete3DCameraCut,
    add3DPath, delete3DPath, findScenePath, move3DPathPoint, set3DPathPointAxis, set3DPathPointMode,
    add3DPathPoint, add3DPathEndpoint, delete3DPathPoint, toggle3DPathClosed, set3DPathColor, set3DPathLocked,
    setCameraPathConstraint, setCameraPathOrientation, setCameraPathTarget, setCameraPathProgress, setCameraPathBank,
    setCameraPathOffset, resetCameraPathOffset,
    toggleLayerPropertyKeyframe, toggle3DPropertyKeyframe, stepToAdjacentKeyframe, hasAdjacentKeyframe, isKeyedAtPlayhead,
    add3DInfluence, remove3DInfluence, toggle3DInfluence, move3DInfluence, set3DInfluenceParameter,
  }
})
