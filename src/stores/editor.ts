import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import * as THREE from 'three'
import type {
  AnimatableProperty, Aurora3DObject, Aurora3DScene, AuroraCamera, AuroraInfluenceType, AuroraLight, AuroraRig, AuroraRigBone,
  AuroraObjectFollowOrientation, AuroraPathOrientation, AuroraPathPointMode,
  AuroraCameraCut, EditorLayer, EditorNode, EditorNodeConnection, EditorNodeKind, EditorProject,
  LayerEffectKind, MediaAsset, SerializedEditorState, ShapePathPoint, TimelineMarker, WorkspaceId,
} from '@/models/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { ensureNumericKeyframe, setNumericPropertyAtTime, toggleNumericKeyframe } from '@/engine/animation/editNumericProperty'
import { CURRENT_PROJECT_VERSION, deserializeEditorState, serializeEditorState } from '@/engine/project/serialization'
import { auroraProjectLibrary } from '@/services/projectLibrary'
import { importAsset, mediaUrl } from '@/services/mediaLibrary'
import { kindForFile } from '../../shared/contracts.ts'
import { aimRotationDegrees, create3DPath, createCameraObjectConstraint, createCameraPathConstraint, createDemo3DScene, createGroupObject, createPrimitiveObject, createStarter3DScene, makeTransform3D, numericProperty } from '@/engine/scene3d/sceneFactory'
import { createRig, createRigBone, type RigBoneChannelKey } from '@/engine/rig/rigFactory'
import { MAX_RIG_CELLS, MIN_RIG_CELLS } from '@/engine/rig/rigMesh'
import {
  appendPathPoint, insertPathPoint, movePathHandle, movePathPoint, prependPathPoint, setPathPointMode,
  type PathHandleKey, type PathVector,
} from '@/engine/scene3d/pathEditing'
import { createInfluence, influenceParameters } from '@/engine/scene3d/influences'
import { normalizeCameraCuts, sortedCameraCuts } from '@/engine/scene3d/cameraCuts'
import {
  canConnect, createDemoNodeGraph, createNode, NODE_DEFINITIONS, syncDynamicInputs, type ConnectionRequest,
} from '@/engine/nodes/nodeGraph'
import { adjacentTimelineMarker, DEFAULT_TIMELINE_MARKER_COLOR, normalizeTimelineMarkers } from '@/engine/animation/timelineMarkers'
import { createLayerEffect, layerEffectParameters } from '@/engine/nodes/layerEffects'

const property = (id: string, value: number): AnimatableProperty<number> => ({
  id,
  value,
  animated: false,
  keyframes: [],
})

const makeTransform = (prefix: string, x = 960, y = 540) => ({
  x: property(`${prefix}-x`, x),
  y: property(`${prefix}-y`, y),
  scaleX: property(`${prefix}-sx`, 100),
  scaleY: property(`${prefix}-sy`, 100),
  rotation: property(`${prefix}-rotation`, 0),
  opacity: property(`${prefix}-opacity`, 100),
})

export type TimelineLayerPreset = 'adjustment' | 'cinematic-grade' | '3d-scene' | 'text' | 'rectangle' | 'ellipse' | 'image' | 'video' | 'audio'

export interface NewProjectOptions {
  name: string
  width: number
  height: number
  frameRate: number
}

export interface ClusterSettings {
  name: string
  width: number
  height: number
}


/** Library kind for a dropped file, from its extension first and the browser's MIME type second. */
function libraryKind(file: File): MediaAsset['kind'] {
  return kindForFile(file.name, file.type)
}
/** Hands a rendered file to the browser; the object URL outlives the click so the download can start. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

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
    markers: [],
  })
  const makeProjectTransform = (prefix: string) => makeTransform(prefix, project.value.width / 2, project.value.height / 2)
  const availableProjects = ref<EditorProject[]>([])
  const projectBrowserBusy = ref(false)
  const projectBrowserError = ref('')

  const workspace = ref<WorkspaceId>('Motion')
  const currentTime = ref(4.2)
  const playing = ref(false)
  const loop = ref(true)
  const autoKey = ref(false)
  const snap = ref(true)
  const ripple = ref(false)
  const selectedLayerId = ref<string | null>('layer-title')
  const selectedKeyframeId = ref<string | null>(null)
  /** Which mask segment the edge editor is focused on; null selects the whole outline. */
  const selectedMaskSegment = ref<number | null>(null)
  /** Imports the media server refused or never received, surfaced in the Library rather than swallowed. */
  const importFailures = ref<{ assetId: string; name: string; reason: string }[]>([])
  /**
   * The library entry currently being dragged. dataTransfer only exposes its `types` during a drag,
   * never the payload, so the timeline needs this to preview what is about to land.
   */
  const draggingAssetId = ref<string | null>(null)
  const selectedNodeId = ref('node-blur')
  const selectedSceneId = ref('scene-aurora-3d')
  const selectedSceneEntityId = ref('object-aurora-cube')
  const zoom = ref(100)
  const saveStatus = ref<'Saved' | 'Saving…' | 'Save failed'>('Saved')
  const exportProgress = ref(0)
  const exportStatus = ref<'idle' | 'rendering' | 'done' | 'error'>('idle')
  /** Result line under the progress bar: the finished size, or why the render stopped. */
  const exportMessage = ref('')
  let exportAbort: AbortController | null = null
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
    { id: 'layer-adjust', name: 'Cinematic Grade', type: 'adjustment', start: 0, duration: 18, color: '#9b8fe8', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('grade'), effects: [createLayerEffect('colorMatrix', 'demo-color-matrix', { temperature: -8, contrast: 1.12 }), createLayerEffect('vignette', 'demo-vignette', { amount: 34, softness: 72 })] },
    { id: 'layer-title', name: 'BEYOND THE HORIZON', type: 'text', start: 2.2, duration: 8.6, color: '#d49b65', visible: true, locked: false, muted: false, expanded: true, transform: makeTransform('title'), effects: [createLayerEffect('glow', 'demo-glow', { threshold: 62, radius: 28, intensity: 1.45 })] },
    { id: 'layer-3d-scene', name: 'Aurora 3D Study', type: '3d-scene', sceneId: 'scene-aurora-3d', start: 0, duration: 18, color: '#7888db', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('scene-3d'), effects: [] },
    { id: 'layer-logo', name: 'Aurora Mark', type: 'image', start: 1, duration: 14, color: '#6b99d5', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('logo'), effects: [] },
    { id: 'layer-video', name: 'Ridge Expedition', type: 'video', start: 0, duration: 18, color: '#5477a8', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('video'), effects: [createLayerEffect('brightnessContrast', 'demo-brightness-contrast', { brightness: 4, contrast: 12 })] },
    { id: 'layer-audio', name: 'Deep Signal', type: 'audio', start: 0, duration: 18, color: '#5c9b82', visible: true, locked: false, muted: false, expanded: false, transform: makeTransform('audio'), effects: [] },
  ])
  const scenes3D = ref<Aurora3DScene[]>([createDemo3DScene()])
  const demoGraph = createDemoNodeGraph(layers.value)
  const nodes = ref<EditorNode[]>(demoGraph.nodes)
  const nodeConnections = ref<EditorNodeConnection[]>(demoGraph.connections)
  /** Deformation skeletons, shared project-wide so one rig can drive a layer and a 3D plane alike. */
  const rigs = ref<AuroraRig[]>([])
  const selectedRigBoneId = ref<string | null>(null)
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
  const renderRevision = ref(0)
  const frameCacheStatus = ref<'idle' | 'caching' | 'ready' | 'cancelled' | 'error'>('idle')
  const frameCacheFrames = ref<number[]>([])
  const frameCacheProjectId = ref('')
  const frameCacheRevision = ref(-1)
  const frameCacheScope = ref('project')
  const frameCacheProgress = ref({ completed: 0, total: 0 })
  const frameCacheRange = ref({ start: 0, end: 0 })
  const frameCacheRequestId = ref(0)
  const frameCacheCancelId = ref(0)
  const frameCacheClearId = ref(0)
  let saveQueue: Promise<void> = Promise.resolve()

  function resetFrameCacheDisplay() {
    frameCacheStatus.value = 'idle'
    frameCacheFrames.value = []
    frameCacheProjectId.value = ''
    frameCacheRevision.value = -1
    frameCacheScope.value = 'project'
    frameCacheProgress.value = { completed: 0, total: 0 }
  }

  function requestFrameCacheRange(start: number, end: number) {
    frameCacheRange.value = { start: Math.max(0, start), end: Math.max(start, end) }
    frameCacheRequestId.value += 1
  }

  function cancelFrameCache() {
    frameCacheCancelId.value += 1
    if (frameCacheStatus.value === 'caching') frameCacheStatus.value = 'cancelled'
  }

  function requestFrameCacheClear() {
    frameCacheClearId.value += 1
  }

  function beginFrameCache(projectId: string, revision: number, scope: string, total: number) {
    frameCacheStatus.value = 'caching'
    frameCacheProgress.value = { completed: 0, total }
    if (frameCacheProjectId.value !== projectId || frameCacheRevision.value !== revision || frameCacheScope.value !== scope) {
      frameCacheFrames.value = []
      frameCacheProjectId.value = projectId
      frameCacheRevision.value = revision
      frameCacheScope.value = scope
    }
  }

  function recordFrameCached(event: { projectId: string; revision: number; scope: string; frame: number }) {
    if (frameCacheProjectId.value !== event.projectId || frameCacheRevision.value !== event.revision || frameCacheScope.value !== event.scope) {
      frameCacheFrames.value = []
      frameCacheProjectId.value = event.projectId
      frameCacheRevision.value = event.revision
      frameCacheScope.value = event.scope
    }
    if (!frameCacheFrames.value.includes(event.frame)) {
      frameCacheFrames.value = [...frameCacheFrames.value, event.frame].sort((left, right) => left - right)
    }
  }

  function updateFrameCacheProgress(completed: number, total: number) {
    frameCacheProgress.value = { completed, total }
  }

  function finishFrameCache(status: 'ready' | 'cancelled' | 'error' = 'ready') {
    frameCacheStatus.value = status
  }

  function applyLoadedState(state: SerializedEditorState) {
    const addedStarterTracks = state.layers.length === 0
    project.value = state.project
    layers.value = state.layers
    scenes3D.value = state.scenes3D
    assets.value = state.assets
    nodes.value = state.nodes
    nodeConnections.value = state.nodeConnections
    rigs.value = state.rigs ?? []
    selectedRigBoneId.value = null
    if (!layers.value.length) layers.value = [makeEmptyTrack('visual'), makeEmptyTrack('audio')]
    // Repair before filling gaps, or a duplicate about to be folded away could be re-published.
    dedupeCompositionAssets()
    ensureClusterAssets()
    ensure3DSceneAssets()
    /*
     * The default selection is a layer id from the starter project. A restored project usually has
     * no such layer, and the selection would otherwise point at nothing while still reading as a
     * selection — a transform box in the viewport with no clip behind it.
     */
    if (!findLayerDeep(layers.value, selectedLayerId.value ?? '')) {
      selectedLayerId.value = layers.value[0]?.id ?? null
      selectedKeyframeId.value = null
    }
    playing.value = false
    currentTime.value = 0
    workspace.value = 'Motion'
    selectedNodeId.value = nodes.value.find((node) => node.kind === 'output')?.id ?? nodes.value[0]?.id ?? ''
    selectedConnectionId.value = null
    renderRootNodeId.value = null
    selectedSceneId.value = scenes3D.value[0]?.id ?? ''
    const firstScene = scenes3D.value[0]
    selectedSceneEntityId.value = firstScene?.objects[0]?.id ?? firstScene?.cameras[0]?.id ?? firstScene?.lights[0]?.id ?? firstScene?.paths[0]?.id ?? ''
    openClusterTabs.value = []
    activeClusterId.value = null
    resetEditorHistory()
    renderRevision.value += 1
    resetFrameCacheDisplay()
    return addedStarterTracks
  }

  function updateProjectSummary(summary: EditorProject) {
    const next = structuredClone(toRaw(summary))
    availableProjects.value = [next, ...availableProjects.value.filter((item) => item.id !== next.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async function refreshProjects() {
    availableProjects.value = await auroraProjectLibrary.listProjects()
    return availableProjects.value
  }

  function currentState(): SerializedEditorState {
    return {
      project: project.value,
      layers: layers.value,
      scenes3D: scenes3D.value,
      assets: assets.value,
      nodes: nodes.value,
      nodeConnections: nodeConnections.value,
      rigs: rigs.value,
    }
  }

  function projectSnapshot(): SerializedEditorState {
    return JSON.parse(serializeEditorState(currentState())) as SerializedEditorState
  }

  async function initializePersistence() {
    if (persistenceReady) return
    const legacyRaw = typeof window === 'undefined' ? null : window.localStorage.getItem('aurora-editor-project')
    try {
      const databaseState = await auroraProjectLibrary.loadActiveSnapshot()
      const loadedState = databaseState
        ? deserializeEditorState(JSON.stringify(databaseState), defaultState)
        : deserializeEditorState(legacyRaw, defaultState)
      const addedStarterTracks = applyLoadedState(loadedState)
      persistenceReady = true
      if (!databaseState || addedStarterTracks) {
        changeRevision += 1
        await saveProjectNow()
      }
      await refreshProjects()
      if (legacyRaw && saveStatus.value === 'Saved') window.localStorage.removeItem('aurora-editor-project')
    } catch (error) {
      applyLoadedState(deserializeEditorState(legacyRaw, defaultState))
      persistenceReady = true
      saveStatus.value = 'Save failed'
      availableProjects.value = [structuredClone(toRaw(project.value))]
      console.error('Aurora project database initialization failed', error)
    }
  }

  function validProjectFormat(width: number, height: number, frameRate: number) {
    return {
      width: Math.round(Math.max(16, Math.min(16384, Number.isFinite(width) ? width : 1920))),
      height: Math.round(Math.max(16, Math.min(16384, Number.isFinite(height) ? height : 1080))),
      frameRate: Math.max(1, Math.min(240, Number.isFinite(frameRate) ? frameRate : 30)),
    }
  }

  async function openProject(projectId: string) {
    projectBrowserBusy.value = true
    projectBrowserError.value = ''
    try {
      await flushProjectSave()
      const snapshot = await auroraProjectLibrary.loadSnapshot(projectId)
      if (!snapshot) throw new Error('The selected project could not be found.')
      const addedStarterTracks = applyLoadedState(deserializeEditorState(JSON.stringify(snapshot), defaultState))
      if (addedStarterTracks) {
        changeRevision += 1
        await saveProjectNow()
      } else await auroraProjectLibrary.setActiveProject(projectId)
      saveStatus.value = 'Saved'
      return true
    } catch (error) {
      projectBrowserError.value = error instanceof Error ? error.message : 'The project could not be opened.'
      return false
    } finally {
      projectBrowserBusy.value = false
    }
  }

  async function createEmptyProject(options: NewProjectOptions) {
    projectBrowserBusy.value = true
    projectBrowserError.value = ''
    try {
      await flushProjectSave()
      const format = validProjectFormat(options.width, options.height, options.frameRate)
      const nextProject: EditorProject = {
        id: crypto.randomUUID(),
        name: options.name.trim() || 'Untitled Project',
        ...format,
        duration: 10,
        backgroundColor: '#080b12',
        updatedAt: Date.now(),
        version: CURRENT_PROJECT_VERSION,
      }
      const graph = createDemoNodeGraph([])
      applyLoadedState({ project: nextProject, layers: [], scenes3D: [], assets: [], nodes: graph.nodes, nodeConnections: graph.connections, rigs: [] })
      changeRevision += 1
      await saveProjectNow()
      await refreshProjects()
      return true
    } catch (error) {
      projectBrowserError.value = error instanceof Error ? error.message : 'The project could not be created.'
      return false
    } finally {
      projectBrowserBusy.value = false
    }
  }

  function setProjectFormat(width: number, height: number, frameRate: number) {
    Object.assign(project.value, validProjectFormat(width, height, frameRate))
    markChanged()
  }

  /**
   * Clusters are editable contexts, not just folded groups: entering one opens a timeline tab whose
   * layer list is that cluster's children. Because a cluster can hold another cluster, tabs stack.
   */
  const openClusterTabs = ref<string[]>([])
  const activeClusterId = ref<string | null>(null)

  interface EditorHistorySnapshot {
    id: string
    label: string
    createdAt: number
    state: SerializedEditorState
    workspace: WorkspaceId
    currentTime: number
    selectedLayerId: string | null
    selectedKeyframeId: string | null
    selectedNodeId: string
    selectedConnectionId: string | null
    renderRootNodeId: string | null
    selectedSceneId: string
    selectedSceneEntityId: string
    openClusterTabs: string[]
    activeClusterId: string | null
  }

  const undoStack = ref<EditorHistorySnapshot[]>([])
  const redoStack = ref<EditorHistorySnapshot[]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  let historyPresent: EditorHistorySnapshot | null = null
  let historySequence = 0
  let restoringHistory = false
  /**
   * Depth of in-flight viewport drags.
   *
   * A drag writes to a property on every pointer move, which would otherwise leave one undo step per
   * frame and make the gesture impossible to take back. History stands down while one is running,
   * and the whole drag lands as a single entry when it ends.
   */
  let interactiveEdits = 0

  function captureHistorySnapshot(label = 'Edit project'): EditorHistorySnapshot {
    return {
      id: `history-${Date.now()}-${++historySequence}`,
      label,
      createdAt: Date.now(),
      state: JSON.parse(serializeEditorState(currentState())) as SerializedEditorState,
      workspace: workspace.value,
      currentTime: currentTime.value,
      selectedLayerId: selectedLayerId.value,
      selectedKeyframeId: selectedKeyframeId.value,
      selectedNodeId: selectedNodeId.value,
      selectedConnectionId: selectedConnectionId.value,
      renderRootNodeId: renderRootNodeId.value,
      selectedSceneId: selectedSceneId.value,
      selectedSceneEntityId: selectedSceneEntityId.value,
      openClusterTabs: [...openClusterTabs.value],
      activeClusterId: activeClusterId.value,
    }
  }

  function resetEditorHistory() {
    undoStack.value = []
    redoStack.value = []
    historyPresent = captureHistorySnapshot('Project opened')
  }

  function historySignature(snapshot: EditorHistorySnapshot) {
    const { id: _id, label: _label, createdAt: _createdAt, ...content } = snapshot
    return JSON.stringify({
      ...content,
      state: { ...snapshot.state, project: { ...snapshot.state.project, updatedAt: 0 } },
    })
  }

  function layerCount(list: EditorLayer[]): number {
    return list.reduce((count, layer) => count + 1 + layerCount(layer.children ?? []), 0)
  }

  function describeHistoryChange(previous: EditorHistorySnapshot, current: EditorHistorySnapshot) {
    const before = previous.state
    const after = current.state
    const beforeLayers = layerCount(before.layers)
    const afterLayers = layerCount(after.layers)
    if (afterLayers > beforeLayers) return 'Add layer'
    if (afterLayers < beforeLayers) return 'Delete layer'
    if (after.assets.length > before.assets.length) return 'Import asset'
    if (after.assets.length < before.assets.length) return 'Delete asset'
    if (after.nodes.length > before.nodes.length) return 'Add node'
    if (after.nodes.length < before.nodes.length) return 'Delete node'
    if (after.nodeConnections.length > before.nodeConnections.length) return 'Connect nodes'
    if (after.nodeConnections.length < before.nodeConnections.length) return 'Disconnect nodes'
    if (after.scenes3D.length > before.scenes3D.length) return 'Add 3D scene'
    if (after.scenes3D.length < before.scenes3D.length) return 'Delete 3D scene'
    if (after.project.duration !== before.project.duration || after.project.width !== before.project.width
      || after.project.height !== before.project.height || after.project.frameRate !== before.project.frameRate) return 'Change project settings'
    const selected = findLayerDeep(after.layers, current.selectedLayerId ?? '')
    return selected ? `Edit ${selected.name}` : `Edit ${current.workspace}`
  }

  const historyEntries = computed(() => {
    const sequence = [
      ...undoStack.value,
      ...(historyPresent ? [historyPresent] : []),
      ...[...redoStack.value].reverse(),
    ]
    return sequence.map((snapshot, index) => ({
      id: snapshot.id,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
      workspace: snapshot.workspace,
      current: snapshot.id === historyPresent?.id,
      position: index,
    }))
  })

  function recordHistoryChange() {
    if (restoringHistory || interactiveEdits > 0) return
    const current = captureHistorySnapshot()
    if (historyPresent && historySignature(historyPresent) === historySignature(current)) return
    if (historyPresent) {
      current.label = describeHistoryChange(historyPresent, current)
      const previousInEditingWorkspace = { ...historyPresent, workspace: current.workspace }
      undoStack.value = [...undoStack.value.slice(-99), previousInEditingWorkspace]
    }
    historyPresent = current
    redoStack.value = []
  }

  /** Opens a viewport gesture; every edit until the matching end lands as one undo step. */
  function beginInteractiveEdit() {
    interactiveEdits += 1
  }

  function endInteractiveEdit() {
    if (!interactiveEdits) return
    interactiveEdits -= 1
    if (!interactiveEdits) markChanged()
  }

  function restoreHistorySnapshot(snapshot: EditorHistorySnapshot) {
    restoringHistory = true
    const state = JSON.parse(JSON.stringify(snapshot.state)) as SerializedEditorState
    project.value = state.project
    layers.value = state.layers
    scenes3D.value = state.scenes3D
    assets.value = state.assets
    nodes.value = state.nodes
    nodeConnections.value = state.nodeConnections
    rigs.value = state.rigs ?? []
    if (!rigs.value.some((rig) => rig.bones.some((bone) => bone.id === selectedRigBoneId.value))) selectedRigBoneId.value = null
    workspace.value = snapshot.workspace
    currentTime.value = Math.max(0, Math.min(project.value.duration, snapshot.currentTime))
    selectedLayerId.value = findLayerDeep(layers.value, snapshot.selectedLayerId ?? '')?.id ?? layers.value[0]?.id ?? null
    selectedKeyframeId.value = snapshot.selectedKeyframeId
    selectedNodeId.value = nodes.value.some((node) => node.id === snapshot.selectedNodeId) ? snapshot.selectedNodeId : nodes.value[0]?.id ?? ''
    selectedConnectionId.value = nodeConnections.value.some((connection) => connection.id === snapshot.selectedConnectionId) ? snapshot.selectedConnectionId : null
    renderRootNodeId.value = nodes.value.some((node) => node.id === snapshot.renderRootNodeId) ? snapshot.renderRootNodeId : null
    selectedSceneId.value = scenes3D.value.some((scene) => scene.id === snapshot.selectedSceneId) ? snapshot.selectedSceneId : scenes3D.value[0]?.id ?? ''
    const scene = scenes3D.value.find((item) => item.id === selectedSceneId.value)
    const entityIds = new Set([...(scene?.objects ?? []), ...(scene?.cameras ?? []), ...(scene?.lights ?? []), ...(scene?.paths ?? [])].map((entity) => entity.id))
    selectedSceneEntityId.value = entityIds.has(snapshot.selectedSceneEntityId)
      ? snapshot.selectedSceneEntityId
      : scene?.objects[0]?.id ?? scene?.cameras[0]?.id ?? scene?.lights[0]?.id ?? scene?.paths[0]?.id ?? ''
    openClusterTabs.value = snapshot.openClusterTabs.filter((id) => findLayerDeep(layers.value, id)?.type === 'cluster')
    activeClusterId.value = snapshot.activeClusterId && openClusterTabs.value.includes(snapshot.activeClusterId) ? snapshot.activeClusterId : null
    playing.value = false
    selectedMaskSegment.value = null
    restoringHistory = false
  }

  function undo() {
    const target = undoStack.value.at(-1)
    if (!target) return false
    const current = historyPresent ?? captureHistorySnapshot()
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value.slice(-99), current]
    restoreHistorySnapshot(target)
    historyPresent = target
    scheduleProjectSave()
    return true
  }

  function redo() {
    const target = redoStack.value.at(-1)
    if (!target) return false
    const current = historyPresent ?? captureHistorySnapshot()
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value.slice(-99), current]
    restoreHistorySnapshot(target)
    historyPresent = target
    scheduleProjectSave()
    return true
  }

  /** Restores any visible history state and rebuilds undo/redo around it. */
  function jumpToHistory(id: string) {
    const sequence = [
      ...undoStack.value,
      ...(historyPresent ? [historyPresent] : []),
      ...[...redoStack.value].reverse(),
    ]
    const targetIndex = sequence.findIndex((snapshot) => snapshot.id === id)
    if (targetIndex < 0) return false
    const target = sequence[targetIndex]!
    undoStack.value = sequence.slice(0, targetIndex)
    redoStack.value = sequence.slice(targetIndex + 1).reverse()
    restoreHistorySnapshot(target)
    historyPresent = target
    scheduleProjectSave()
    return true
  }

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

  function isClusterNameAvailable(name: string, excludeAssetId?: string) {
    const normalized = name.trim().toLocaleLowerCase()
    if (!normalized) return false
    return !assets.value.some((asset) => asset.kind === 'composition'
      && asset.id !== excludeAssetId
      && asset.name.trim().toLocaleLowerCase() === normalized)
  }

  function nextClusterName() {
    let name = ''
    do name = `Cluster ${clusterCounter++}`
    while (!isClusterNameAvailable(name))
    return name
  }

  function validClusterSettings(settings: Partial<ClusterSettings> = {}): ClusterSettings {
    return {
      name: settings.name?.trim() || nextClusterName(),
      width: Math.round(Math.max(16, Math.min(16384, Number.isFinite(settings.width) ? settings.width! : project.value.width))),
      height: Math.round(Math.max(16, Math.min(16384, Number.isFinite(settings.height) ? settings.height! : project.value.height))),
    }
  }

  function renameTimelineLayers(layerIds: string[], name: string) {
    const nextName = name.trim()
    if (!nextName) return false
    const ids = new Set(layerIds)
    const targets = flattenLayers().filter((layer) => ids.has(layer.id))
    if (!targets.length) return false
    const clusterTarget = targets.find((layer) => layer.type === 'cluster')
    if (clusterTarget && !isClusterNameAvailable(nextName, clusterTarget.assetId)) return false
    targets.forEach((layer) => {
      layer.name = nextName
      if (layer.type === 'cluster') publishClusterAsset(layer)
      if (layer.type === '3d-scene' && layer.sceneId) {
        const scene = scenes3D.value.find((item) => item.id === layer.sceneId)
        if (scene) {
          scene.name = nextName
          publish3DSceneAsset(layer, scene)
        }
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

  /**
   * `keepTracks` separates removing a clip from removing the track it sits on. Deleting the last clip
   * of a track would otherwise take the track row with it, because a track exists only as the layers
   * grouped under it — so an empty one is left behind as a placeholder, the same shape `addEmptyTrack`
   * produces. The track context menu still deletes the row outright.
   */
  function deleteTimelineLayers(layerIds: string[], options: { keepTracks?: boolean } = {}) {
    const ids = new Set(layerIds)
    const deleted = layerList().filter((layer) => ids.has(layer.id))
    if (!deleted.length) return false
    const trackKeyOf = (layer: EditorLayer) => layer.trackId ?? layer.id
    const emptiedTracks = new Map<string, { index: number; template: EditorLayer }>()
    layerList().forEach((layer, index) => {
      const key = trackKeyOf(layer)
      if (ids.has(layer.id) && !emptiedTracks.has(key)) emptiedTracks.set(key, { index, template: layer })
    })
    const deletedTree = flattenLayers(deleted)
    const deletedIds = new Set(deletedTree.map((layer) => layer.id))
    if (ripple.value && options.keepTracks) {
      const frameTolerance = (0.5 / project.value.frameRate) + 0.0001
      layerList().filter((layer) => !ids.has(layer.id)).forEach((layer) => {
        const trackId = trackKeyOf(layer)
        const removedBefore = deleted
          .filter((item) => trackKeyOf(item) === trackId && item.start + item.duration <= layer.start + frameTolerance)
          .reduce((duration, item) => duration + item.duration, 0)
        if (removedBefore > 0) shiftLayerTiming(layer, -removedBefore)
      })
    }
    replaceLayerList(layerList().filter((layer) => !ids.has(layer.id)))
    if (options.keepTracks) {
      // Descending, so each insertion index still refers to the position it was recorded at.
      ;[...emptiedTracks.entries()].sort(([, left], [, right]) => right.index - left.index).forEach(([key, { index, template }]) => {
        if (layerList().some((layer) => trackKeyOf(layer) === key)) return
        const placeholder = makeEmptyTrack(template.type === 'audio' ? 'audio' : 'visual', key)
        placeholder.name = template.name
        placeholder.color = template.color
        layerList().splice(Math.min(index, layerList().length), 0, placeholder)
      })
    }
    openClusterTabs.value = openClusterTabs.value.filter((id) => !deletedIds.has(id))
    if (activeClusterId.value && deletedIds.has(activeClusterId.value)) activeClusterId.value = openClusterTabs.value.at(-1) ?? null
    const remaining = flattenLayers()
    const deletedSceneIds = new Set(deletedTree.flatMap((layer) => layer.type === '3d-scene' && layer.sceneId ? [layer.sceneId] : []))
    scenes3D.value = scenes3D.value.filter((scene) => !deletedSceneIds.has(scene.id)
      || remaining.some((layer) => layer.type === '3d-scene' && layer.sceneId === scene.id))
    if (!remaining.some((layer) => layer.id === selectedLayerId.value)) {
      selectedLayerId.value = layerList().find((layer) => !layer.isPlaceholder)?.id ?? activeClusterId.value ?? null
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

  const selectedLayer = computed(() => findLayerDeep(layers.value, selectedLayerId.value ?? '') ?? timelineLayers.value[0] ?? layers.value[0])
  const timelineMarkers = computed(() => project.value.markers ?? [])
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

  function addTimelineMarker(name?: string, color = DEFAULT_TIMELINE_MARKER_COLOR, time = currentTime.value) {
    const marker: TimelineMarker = {
      id: crypto.randomUUID(),
      name: name?.trim() || `Marker ${timelineMarkers.value.length + 1}`,
      time,
      color,
    }
    project.value.markers = normalizeTimelineMarkers([...timelineMarkers.value, marker], project.value.duration)
    markChanged()
    return project.value.markers.find((item) => item.id === marker.id) ?? null
  }

  function updateTimelineMarker(id: string, patch: Partial<Pick<TimelineMarker, 'name' | 'time' | 'color'>>) {
    const marker = timelineMarkers.value.find((item) => item.id === id)
    if (!marker) return false
    const next = normalizeTimelineMarkers([{ ...marker, ...patch }], project.value.duration)[0]
    if (!next) return false
    Object.assign(marker, next)
    project.value.markers = [...timelineMarkers.value].sort((left, right) => left.time - right.time || left.name.localeCompare(right.name))
    markChanged()
    return true
  }

  function deleteTimelineMarker(id: string) {
    if (!timelineMarkers.value.some((marker) => marker.id === id)) return false
    project.value.markers = timelineMarkers.value.filter((marker) => marker.id !== id)
    markChanged()
    return true
  }

  function jumpToAdjacentTimelineMarker(direction: -1 | 1) {
    const marker = adjacentTimelineMarker(timelineMarkers.value, currentTime.value, direction, (0.5 / project.value.frameRate) + 0.0001)
    if (!marker) return false
    setTime(marker.time)
    return true
  }

  function stepFrame(direction: -1 | 1) {
    setTime(currentTime.value + direction / project.value.frameRate)
  }

  /**
   * The composition length is the author's call, not a function of what is on the timeline. Clips
   * are free to run past the end — they simply never play — the same way every other editor treats
   * a work area. Only a single frame is a hard floor, since a zero-length composition has no frames.
   */
  function setProjectDuration(value: number) {
    const minimum = 1 / project.value.frameRate
    project.value.duration = Math.max(minimum, Math.min(86400, Number.isFinite(value) ? value : project.value.duration))
    currentTime.value = Math.min(currentTime.value, project.value.duration)
    project.value.markers = normalizeTimelineMarkers(project.value.markers, project.value.duration)
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
    const result = setNumericPropertyAtTime(channel, value, currentTime.value, project.value.frameRate, {
      autoKey: autoKey.value,
      selectedKeyframeId: selectedKeyframeId.value,
    })
    if (!result.changed) return
    if (result.keyframeId) selectedKeyframeId.value = result.keyframeId
    markChanged()
  }

  function addLayerEffect(kind: LayerEffectKind) {
    const layer = selectedLayer.value
    if (!layer || layer.type === 'audio') return
    layer.effects.push(createLayerEffect(kind))
    markChanged()
  }

  function removeLayerEffect(effectId: string) {
    const layer = selectedLayer.value
    if (!layer) return
    const next = layer.effects.filter((effect) => effect.id !== effectId)
    if (next.length === layer.effects.length) return
    layer.effects = next
    markChanged()
  }

  function toggleLayerEffect(effectId: string) {
    const effect = selectedLayer.value?.effects.find((item) => item.id === effectId)
    if (!effect) return
    effect.enabled = !effect.enabled
    markChanged()
  }

  function moveLayerEffect(effectId: string, direction: -1 | 1) {
    const effects = selectedLayer.value?.effects
    if (!effects) return
    const index = effects.findIndex((effect) => effect.id === effectId)
    const destination = index + direction
    if (index < 0 || destination < 0 || destination >= effects.length) return
    const [effect] = effects.splice(index, 1)
    effects.splice(destination, 0, effect!)
    markChanged()
  }

  function setLayerEffectValue(effectId: string, key: string, value: number) {
    const effect = selectedLayer.value?.effects.find((item) => item.id === effectId)
    const parameter = effect && layerEffectParameters(effect.kind).find((item) => item.key === key)
    if (!effect || !parameter || !Number.isFinite(value)) return
    const next = Math.min(parameter.max ?? Number.POSITIVE_INFINITY, Math.max(parameter.min ?? Number.NEGATIVE_INFINITY, value))
    if (effect.values[key] === next) return
    effect.values[key] = next
    markChanged()
  }

  /**
   * Imports files into the media vault and adds them to the library.
   *
   * The entry appears immediately with an object URL so the Library is not blank while bytes are
   * copied, then adopts the content address the server returns. If the server is unreachable the
   * entry survives without a hash — usable for the session, and visibly missing its media after a
   * reload, which is the honest outcome rather than a silent blank.
   */
  async function addFiles(files: FileList | File[]) {
    const pending = Array.from(files).map((file) => {
      const asset: MediaAsset = {
        id: crypto.randomUUID(),
        name: file.name,
        kind: libraryKind(file),
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        thumbnail: file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : undefined,
        sizeLabel: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
      }
      assets.value.unshift(asset)
      return { asset, file }
    })
    markChanged()

    for (const { asset, file } of pending) {
      try {
        const { asset: stored } = await importAsset(file)
        const entry = assets.value.find((item) => item.id === asset.id)
        if (!entry) continue
        entry.hash = stored.hash
        entry.mimeType = stored.mimeType
        entry.sizeBytes = stored.sizeBytes
        if (stored.width && stored.height) entry.dimensions = `${stored.width} × ${stored.height}`
        // The object URL was a stand-in; the vault copy outlives the tab, so release the blob.
        if (entry.thumbnail?.startsWith('blob:')) URL.revokeObjectURL(entry.thumbnail)
        entry.thumbnail = stored.kind === 'image' || stored.kind === 'video' ? mediaUrl(stored.hash) : undefined
      } catch (error) {
        importFailures.value = [...importFailures.value.filter((item) => item.assetId !== asset.id), {
          assetId: asset.id,
          name: asset.name,
          reason: error instanceof Error ? error.message : 'import failed',
        }]
      }
    }
    markChanged()
  }

  function mediaAssetReferenceCount(assetId: string) {
    const layerReferences = flattenLayers().filter((layer) => layer.assetId === assetId).length
    const sceneReferences = scenes3D.value.reduce((count, scene) => count
      + (scene.environmentAssetId === assetId ? 1 : 0)
      + scene.objects.filter((object) => object.assetId === assetId).length, 0)
    return layerReferences + sceneReferences
  }

  /** Removes a Library entry while leaving authored layers/scenes in place and explicitly unlinked. */
  function deleteMediaAsset(assetId: string) {
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset) return false
    flattenLayers().forEach((layer) => {
      if (layer.assetId !== assetId) return
      delete layer.assetId
      if (layer.type === 'cluster' || layer.type === '3d-scene') layer.libraryPublished = false
    })
    scenes3D.value.forEach((scene) => {
      if (scene.environmentAssetId === assetId) delete scene.environmentAssetId
      scene.objects.forEach((object) => { if (object.assetId === assetId) delete object.assetId })
    })
    if (asset.thumbnail?.startsWith('blob:')) URL.revokeObjectURL(asset.thumbnail)
    assets.value = assets.value.filter((item) => item.id !== assetId)
    importFailures.value = importFailures.value.filter((failure) => failure.assetId !== assetId)
    markChanged()
    return true
  }

  /**
   * `toRaw` only unwraps the object it is handed, so a cluster still holds reactive children and
   * cannot be structurally cloned. Unwrap the whole tree before copying it.
   */
  function rawLayerTree(layer: EditorLayer): EditorLayer {
    const raw = toRaw(layer)
    return raw.children?.length ? { ...raw, children: raw.children.map(rawLayerTree) } : raw
  }

  const raw3DScene = (scene: Aurora3DScene): Aurora3DScene => JSON.parse(JSON.stringify(scene)) as Aurora3DScene

  /** `atTime` lands the layer where it was dropped on the timeline; without it, at the playhead. */
  function addAssetToTimeline(assetId: string, atTime?: number, trackId?: string | null) {
    const asset = assets.value.find((item) => item.id === assetId)
    if (!asset || asset.kind === 'model3d' || asset.kind === 'hdr' || asset.kind === 'texture') return
    const dropTime = Math.max(0, Math.min(project.value.duration, atTime ?? currentTime.value))
    const reusableTemplate = asset.kind === 'scene3d' ? asset.sceneLayerTemplate : asset.layerTemplate
    if (reusableTemplate) {
      const layer = structuredClone(rawLayerTree(reusableTemplate))
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
      // Templates snapshotted before the link existed carry no assetId; without one the copy reads
      // as a brand new cluster and earns a duplicate Library entry.
      layer.assetId = asset.id
      layer.libraryPublished = true
      layer.name = asset.name
      if (asset.kind === 'scene3d') {
        if (!asset.sceneTemplate) return
        const scene = raw3DScene(asset.sceneTemplate)
        scene.id = crypto.randomUUID()
        scene.name = asset.name
        scene.revision += 1
        layer.sceneId = scene.id
        scenes3D.value.push(scene)
        selectedSceneId.value = scene.id
        selectedSceneEntityId.value = scene.objects[0]?.id ?? scene.cameras[0]?.id ?? scene.lights[0]?.id ?? scene.paths[0]?.id ?? ''
      }
      layerList().splice(0, 0, layer)
      project.value.duration = Math.max(project.value.duration, layer.start + layer.duration)
      selectedLayerId.value = layer.id
      selectedKeyframeId.value = null
      attachLayerToCompositeGraph(layer)
      markChanged()
      return layer
    }
    const type = asset.kind === 'composition' ? 'image' : asset.kind === 'scene3d' ? '3d-scene' : asset.kind

    /*
     * A 3D layer without a scene of its own is unrenderable: the frame graph keys its three-webgl
     * pass on `sceneId`, and a pass whose scene cannot be resolved is dropped, so the layer would
     * sit on the timeline and never appear in the Motion viewport. Library scenes that reach this
     * path carry no reusable layer template but still carry the scene, so instantiate from that —
     * and refuse the drop outright when there is no scene to instantiate.
     */
    const droppedScene = asset.kind === 'scene3d' && asset.sceneTemplate ? raw3DScene(asset.sceneTemplate) : null
    if (asset.kind === 'scene3d' && !droppedScene) return
    if (droppedScene) {
      droppedScene.id = crypto.randomUUID()
      droppedScene.name = asset.name
      droppedScene.revision += 1
      scenes3D.value.push(droppedScene)
      selectedSceneId.value = droppedScene.id
      selectedSceneEntityId.value = droppedScene.objects[0]?.id ?? droppedScene.cameras[0]?.id ?? droppedScene.lights[0]?.id ?? ''
    }

    const layer: EditorLayer = {
      id: crypto.randomUUID(), name: asset.name.replace(/\.[^.]+$/, ''), type,
      ...(droppedScene ? { sceneId: droppedScene.id } : {}),
      // The link back to the library entry, and through it to the media the vault serves.
      assetId: asset.id,
      start: dropTime, duration: Math.min(asset.duration ?? 6, Math.max(1 / project.value.frameRate, project.value.duration - dropTime)),
      color: type === 'audio' ? '#5c9b82' : type === 'image' ? '#6b99d5' : '#5477a8',
      visible: true, locked: false, muted: false, expanded: false,
      transform: makeProjectTransform(crypto.randomUUID()), effects: [],
    }

    /*
     * Dropping onto an existing track joins it, provided the clip fits in the gap it was aimed at.
     * Anything else — an occupied stretch, or a drop past the ends — becomes a track of its own,
     * which is what the timeline previews while the drag is in flight.
     */
    const list = layerList()
    const target = trackId ? list.filter((item) => (item.trackId ?? item.id) === trackId) : []
    const occupant = target.find((item) => !item.isPlaceholder
      && dropTime < item.start + item.duration && item.start < dropTime + layer.duration)
    if (trackId && target.length && !occupant && (target[0]!.type === 'audio') === (type === 'audio')) {
      layer.trackId = trackId
      const placeholder = target.findIndex((item) => item.isPlaceholder)
      if (placeholder >= 0) list.splice(list.indexOf(target[placeholder]!), 1)
      list.splice(list.indexOf(target.at(-1)!) + 1, 0, layer)
    } else {
      list.splice(type === 'audio' ? list.length : 0, 0, layer)
    }
    selectedLayerId.value = layer.id
    attachLayerToCompositeGraph(layer)
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
      transform: makeProjectTransform(id),
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
      transform: makeProjectTransform(id),
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
      transform: makeProjectTransform(id),
      effects: preset === 'cinematic-grade'
        ? [createLayerEffect('colorMatrix', crypto.randomUUID(), { temperature: -8, contrast: 1.12 }), createLayerEffect('vignette')]
        : [],
    }

    if (preset === '3d-scene') {
      const sceneNumber = scenes3D.value.length + 1
      const scene = createStarter3DScene(`3D Scene ${sceneNumber}`)
      scenes3D.value.push(scene)
      layer.name = scene.name
      layer.sceneId = scene.id
      selectedSceneId.value = scene.id
      selectedSceneEntityId.value = scene.cameras[0]!.id
      publish3DSceneAsset(layer, scene)
    }

    layerList().splice(isAudio ? layerList().length : 0, 0, layer)
    selectedLayerId.value = layer.id
    selectedKeyframeId.value = null
    attachLayerToCompositeGraph(layer)
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
      transform: makeProjectTransform(id),
      effects: [],
    }
  }

  /** Moves a clip and every piece of timing data that belongs to it by the same amount. */
  function shiftLayerTiming(layer: EditorLayer, delta: number) {
    if (!delta) return
    layer.start = Math.max(0, layer.start + delta)
    ;(Object.keys(layer.transform) as Array<keyof EditorLayer['transform']>).forEach((key) => {
      layer.transform[key].keyframes.forEach((keyframe) => { keyframe.time = Math.max(0, keyframe.time + delta) })
    })
    layer.children?.forEach((child) => shiftLayerTiming(child, delta))
  }

  /** Shifts clips at or after a cut point on one track. Used by ripple trims and ripple deletes. */
  function rippleTrackSegments(trackId: string, fromTime: number, delta: number, excludedLayerIds: string[] = []) {
    if (!ripple.value || Math.abs(delta) < 0.000001) return 0
    const excluded = new Set(excludedLayerIds)
    const tolerance = (0.5 / project.value.frameRate) + 0.0001
    const targets = layerList().filter((layer) => !layer.isPlaceholder
      && !excluded.has(layer.id)
      && (layer.trackId ?? layer.id) === trackId
      && layer.start >= fromTime - tolerance)
    targets.forEach((layer) => shiftLayerTiming(layer, delta))
    if (!activeClusterId.value && delta > 0 && targets.length) {
      project.value.duration = Math.max(project.value.duration, ...targets.map((layer) => layer.start + layer.duration))
    }
    return targets.length
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
    cluster.libraryPublished = true
    const count = cluster.children?.filter((child) => !child.isPlaceholder).length ?? 0
    const existing = cluster.assetId ? assets.value.find((asset) => asset.id === cluster.assetId) : undefined
    if (existing) {
      existing.name = cluster.name
      existing.duration = cluster.duration
      existing.dimensions = `${cluster.width ?? project.value.width} × ${cluster.height ?? project.value.height}`
      existing.sizeLabel = `${count} reusable ${count === 1 ? 'layer' : 'layers'}`
      existing.layerTemplate = structuredClone(rawLayerTree(cluster))
      return existing
    }
    /*
     * The link is written onto the cluster before it is snapshotted, so the template carries it too.
     * Snapshotting first leaves every copy dropped from this entry with no idea which entry it came
     * from, and `ensureClusterAssets` then hands each one a Library entry of its own — one more
     * identical row per drop.
     */
    const asset: MediaAsset = {
      id: crypto.randomUUID(),
      name: cluster.name,
      kind: 'composition',
      duration: cluster.duration,
      dimensions: `${cluster.width ?? project.value.width} × ${cluster.height ?? project.value.height}`,
      sizeLabel: `${count} reusable ${count === 1 ? 'layer' : 'layers'}`,
      layerTemplate: undefined,
    }
    cluster.assetId = asset.id
    cluster.libraryPublished = true
    asset.layerTemplate = structuredClone(rawLayerTree(cluster))
    assets.value.unshift(asset)
    return asset
  }

  function updateClusterSettings(assetId: string, requestedSettings: ClusterSettings) {
    const asset = assets.value.find((item) => item.id === assetId && item.kind === 'composition')
    if (!asset) return false
    const settings = validClusterSettings(requestedSettings)
    if (!isClusterNameAvailable(settings.name, assetId)) return false
    const linked = flattenLayers().filter((layer) => layer.type === 'cluster' && layer.assetId === assetId)
    linked.forEach((cluster) => {
      cluster.name = settings.name
      cluster.width = settings.width
      cluster.height = settings.height
      publishClusterAsset(cluster)
    })
    asset.name = settings.name
    asset.dimensions = `${settings.width} × ${settings.height}`
    if (asset.layerTemplate) {
      asset.layerTemplate.name = settings.name
      asset.layerTemplate.width = settings.width
      asset.layerTemplate.height = settings.height
    }
    markChanged()
    return true
  }

  /** Publishes a 3D layer and its scene as a reusable Library asset. */
  function publish3DSceneAsset(layer: EditorLayer, scene?: Aurora3DScene) {
    if (layer.type !== '3d-scene') return
    layer.libraryPublished = true
    const source = scene ?? scenes3D.value.find((item) => item.id === layer.sceneId)
    if (!source) return
    const existing = layer.assetId ? assets.value.find((asset) => asset.id === layer.assetId) : undefined
    if (existing) {
      existing.name = source.name
      existing.kind = 'scene3d'
      existing.duration = layer.duration
      existing.dimensions = `${project.value.width} × ${project.value.height}`
      existing.sizeLabel = `${source.objects.length} objects · ${source.cameras.length} cameras`
      existing.sceneLayerTemplate = structuredClone(rawLayerTree(layer))
      delete existing.layerTemplate
      existing.sceneTemplate = raw3DScene(source)
      return existing
    }
    const asset: MediaAsset = {
      id: crypto.randomUUID(),
      name: source.name,
      kind: 'scene3d',
      duration: layer.duration,
      dimensions: `${project.value.width} × ${project.value.height}`,
      sizeLabel: `${source.objects.length} objects · ${source.cameras.length} cameras`,
    }
    layer.assetId = asset.id
    layer.libraryPublished = true
    asset.sceneLayerTemplate = structuredClone(rawLayerTree(layer))
    asset.sceneTemplate = raw3DScene(source)
    assets.value.unshift(asset)
    return asset
  }

  function ensure3DSceneAssets(list: EditorLayer[] = layers.value) {
    list.forEach((layer) => {
      if (layer.type === '3d-scene' && layer.libraryPublished !== false && !assets.value.some((asset) => asset.id === layer.assetId)) publish3DSceneAsset(layer)
      if (layer.children?.length) ensure3DSceneAssets(layer.children)
    })
  }

  /**
   * What a composition contains, independent of the identities inside it. Times are measured from
   * the root so that the same cluster dropped at two different points still reads as the same thing.
   */
  function templateSignature(layer: EditorLayer, rootStart: number): string {
    return [
      layer.name, layer.type, layer.shapeKind ?? '',
      (layer.start - rootStart).toFixed(3), layer.duration.toFixed(3),
      (layer.children ?? []).map((child) => templateSignature(child, rootStart)).join('|'),
    ].join('~')
  }

  /**
   * Folds Library entries describing identical compositions back into one.
   *
   * Copies dropped before the template carried its own link each earned an entry, so a project can
   * open with a row per copy. Repairing that here means an affected project heals on load instead of
   * having to be rebuilt. Two entries that describe the same content are the same entry, so the
   * layers pointing at the ones being dropped are moved onto the survivor rather than orphaned.
   */
  function dedupeCompositionAssets() {
    const keepers = new Map<string, MediaAsset>()
    const remap = new Map<string, string>()
    // Oldest first, so the entry that has been around longest is the one that survives.
    for (const asset of [...assets.value].reverse()) {
      if (asset.kind !== 'composition' || !asset.layerTemplate) continue
      const signature = templateSignature(asset.layerTemplate, asset.layerTemplate.start)
      const keeper = keepers.get(signature)
      if (keeper) remap.set(asset.id, keeper.id)
      else keepers.set(signature, asset)
    }
    for (const keeper of keepers.values()) {
      if (keeper.layerTemplate) keeper.layerTemplate.assetId = keeper.id
    }
    if (!remap.size) return 0

    const repoint = (list: EditorLayer[]) => list.forEach((layer) => {
      const next = layer.assetId ? remap.get(layer.assetId) : undefined
      if (next) layer.assetId = next
      if (layer.children?.length) repoint(layer.children)
    })
    repoint(layers.value)
    assets.value = assets.value.filter((asset) => !remap.has(asset.id))
    return remap.size
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
      if (layer.type === 'cluster' && layer.libraryPublished !== false && !assets.value.some((asset) => asset.id === layer.assetId)) publishClusterAsset(layer)
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
  function createEmptyCluster(): EditorLayer
  function createEmptyCluster(requestedSettings: ClusterSettings): EditorLayer | null
  function createEmptyCluster(requestedSettings: Partial<ClusterSettings> = {}) {
    const settings = validClusterSettings(requestedSettings)
    if (!isClusterNameAvailable(settings.name)) return null
    const id = crypto.randomUUID()
    const frameDuration = 1 / project.value.frameRate
    const start = Math.min(currentTime.value, Math.max(0, project.value.duration - frameDuration))
    const cluster: EditorLayer = {
      id,
      name: settings.name,
      type: 'cluster',
      width: settings.width,
      height: settings.height,
      start,
      duration: Math.max(frameDuration, Math.min(5, project.value.duration - start)),
      color: '#7f8fe2',
      visible: true,
      locked: false,
      muted: false,
      expanded: false,
      transform: makeProjectTransform(id),
      effects: [],
      children: [makeEmptyTrack('visual'), makeEmptyTrack('audio')],
    }
    layerList().splice(0, 0, cluster)
    publishClusterAsset(cluster)
    enterCluster(cluster.id)
    markChanged()
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
      name: nextClusterName(),
      type: 'cluster',
      width: project.value.width,
      height: project.value.height,
      start,
      duration: end - start,
      color: '#7f8fe2',
      visible: true,
      locked: false,
      muted: false,
      expanded: false,
      transform: makeProjectTransform(id),
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

  function scheduleProjectSave() {
    changeRevision += 1
    renderRevision.value += 1
    saveStatus.value = 'Saving…'
    if (typeof window === 'undefined') return
    if (saveTimer !== null) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => { void saveProjectNow() }, 250)
  }

  function markChanged() {
    ensureClusterAssets()
    ensure3DSceneAssets()
    syncOpenClusterAssets()
    recordHistoryChange()
    scheduleProjectSave()
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
        await auroraProjectLibrary.saveSnapshot(projectSnapshot())
        updateProjectSummary(project.value)
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

  /** Creates a reusable scene directly from the 3D workspace and opens it for editing. */
  function create3DSceneFromWorkspace() {
    activateTimelineTab(null)
    const layer = addTimelineLayer('3d-scene')
    workspace.value = '3D'
    select3DLayer(layer.id)
    return layer
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
    flattenLayers().filter((layer) => layer.type === '3d-scene' && layer.sceneId === scene.id)
      .forEach((layer) => publish3DSceneAsset(layer, scene))
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

  /** Creates a transform-only parent and optionally places existing objects beneath it. */
  function add3DGroup(objectIds: string[] = []) {
    const scene = selectedScene.value
    if (!scene) return null
    const selected = new Set(objectIds)
    const group = createGroupObject(scene.objects.filter((item) => item.type === 'group').length + 1)
    // If both a parent and its descendant were selected, grouping only the parent preserves the
    // existing subtree instead of needlessly flattening it under the new group.
    const byId = new Map(scene.objects.map((object) => [object.id, object]))
    const roots = scene.objects.filter((object) => {
      if (!selected.has(object.id)) return false
      const visited = new Set<string>()
      for (let parent = object.parentId ? byId.get(object.parentId) : undefined; parent; parent = parent.parentId ? byId.get(parent.parentId) : undefined) {
        if (visited.has(parent.id)) break
        visited.add(parent.id)
        if (selected.has(parent.id)) return false
      }
      return true
    })
    const parentIds = new Set(roots.map((object) => object.parentId ?? ''))
    // A transform can preserve sibling coordinates exactly. Objects from unrelated parent spaces
    // need an explicit reparent operation, so they are not silently moved by this grouping action.
    if (parentIds.size > 1) return null
    const sharedParentId = roots[0]?.parentId
    if (sharedParentId) group.parentId = sharedParentId
    if (roots.length) {
      ;(['x', 'y', 'z'] as const).forEach((axis) => {
        const center = roots.reduce((sum, object) => sum + evaluateNumericProperty(object.transform.position[axis], currentTime.value), 0) / roots.length
        group.transform.position[axis].value = center
        roots.forEach((object) => {
          const position = object.transform.position[axis]
          position.value -= center
          position.keyframes.forEach((keyframe) => { keyframe.value -= center })
        })
      })
    }
    scene.objects.push(group)
    roots.forEach((object) => { object.parentId = group.id })
    selectedSceneEntityId.value = group.id
    markSceneChanged(scene)
    return group
  }

  function composeGroupAndChildTransform(group: Aurora3DObject, child: Aurora3DObject) {
    const channels = (transform: Aurora3DObject['transform']) => (['position', 'rotation', 'scale'] as const)
      .flatMap((section) => (['x', 'y', 'z'] as const).map((axis) => transform[section][axis]))
    const times = new Set<number>([currentTime.value])
    ;[...channels(group.transform), ...channels(child.transform)].forEach((property) => {
      if (property.animated) property.keyframes.forEach((keyframe) => times.add(keyframe.time))
    })
    const sample = (transform: Aurora3DObject['transform'], time: number) => new THREE.Matrix4().compose(
      new THREE.Vector3(...(['x', 'y', 'z'] as const).map((axis) => evaluateNumericProperty(transform.position[axis], time)) as [number, number, number]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(['x', 'y', 'z'] as const).map((axis) => THREE.MathUtils.degToRad(evaluateNumericProperty(transform.rotation[axis], time))) as [number, number, number], 'XYZ')),
      new THREE.Vector3(...(['x', 'y', 'z'] as const).map((axis) => evaluateNumericProperty(transform.scale[axis], time)) as [number, number, number]),
    )
    const sortedTimes = [...times].sort((a, b) => a - b)
    const samples = sortedTimes.map((time) => {
      const position = new THREE.Vector3()
      const rotation = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      sample(group.transform, time).multiply(sample(child.transform, time)).decompose(position, rotation, scale)
      const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ')
      return {
        time,
        position: [position.x, position.y, position.z],
        rotation: [THREE.MathUtils.radToDeg(euler.x), THREE.MathUtils.radToDeg(euler.y), THREE.MathUtils.radToDeg(euler.z)],
        scale: [scale.x, scale.y, scale.z],
      } as const
    })
    ;(['position', 'rotation', 'scale'] as const).forEach((section) => {
      ;(['x', 'y', 'z'] as const).forEach((axis, axisIndex) => {
        const property = child.transform[section][axis]
        const values = samples.map((item) => item[section][axisIndex])
        property.value = values[sortedTimes.indexOf(currentTime.value)] ?? values[0]!
        property.animated = sortedTimes.length > 1
        property.keyframes = property.animated
          ? sortedTimes.map((time, index) => ({ id: crypto.randomUUID(), time, value: values[index]!, interpolation: 'linear' }))
          : []
      })
    })
  }

  function releaseGroupChildren(scene: Aurora3DScene, group: Aurora3DObject) {
    scene.objects.forEach((object) => {
      if (object.parentId !== group.id) return
      composeGroupAndChildTransform(group, object)
      if (group.parentId) object.parentId = group.parentId
      else delete object.parentId
    })
  }

  /** Removes a group node and releases its direct children back to the group's parent. */
  function ungroup3DObject(groupId: string) {
    const scene = selectedScene.value
    const group = scene?.objects.find((object) => object.id === groupId && object.type === 'group')
    if (!scene || !group) return false
    releaseGroupChildren(scene, group)
    scene.objects = scene.objects.filter((object) => object.id !== group.id)
    selectedSceneEntityId.value = group.parentId ?? scene.objects[0]?.id ?? scene.cameras[0]?.id ?? ''
    markSceneChanged(scene)
    return true
  }

  /** Creates an image card whose media can be changed later in the inspector. */
  function add3DImagePlane(assetId?: string) {
    const scene = selectedScene.value
    if (!scene) return null
    const asset = assets.value.find((item) => item.id === assetId && (item.kind === 'image' || item.kind === 'texture'))
      ?? assets.value.find((item) => item.kind === 'image' || item.kind === 'texture')
    const object = createPrimitiveObject('plane', scene.objects.length + 1)
    object.name = asset ? `${asset.name.replace(/\.[^.]+$/, '')} Plane` : `Image Plane ${scene.objects.length + 1}`
    object.assetId = asset?.id
    object.receiveShadow = false
    object.material.metalness.value = 0
    object.material.roughness.value = 1
    object.material.emissive = '#000000'
    object.material.emissiveIntensity.value = 0
    scene.objects.push(object)
    selectedSceneEntityId.value = object.id
    markSceneChanged(scene)
    return object
  }

  /**
   * Places an imported mesh in the scene.
   *
   * The file keeps its own materials and internal hierarchy, so the object is a host rather than a
   * primitive: Aurora's PBR sliders and influences do not apply to it.
   */
  function add3DModel(assetId?: string) {
    const scene = selectedScene.value
    if (!scene) return null
    const asset = assets.value.find((item) => item.id === assetId && item.kind === 'model3d')
      ?? assets.value.find((item) => item.kind === 'model3d')
    if (!asset) return null
    const object = createPrimitiveObject('model', scene.objects.length + 1)
    object.name = asset.name.replace(/\.[^.]+$/, '')
    object.assetId = asset.id
    scene.objects.push(object)
    selectedSceneEntityId.value = object.id
    markSceneChanged(scene)
    return object
  }

  /** New aimed lights point at the authored content, so adding one lights the scene immediately. */
  function sceneAimTarget(scene: Aurora3DScene): [number, number, number] {
    const roots = scene.objects.filter((object) => !object.parentId)
    if (!roots.length) return [0, 0, 0]
    const mean = (axis: 'x' | 'y' | 'z') => roots
      .reduce((sum, object) => sum + evaluateNumericProperty(object.transform.position[axis], currentTime.value), 0) / roots.length
    return [mean('x'), mean('y'), mean('z')]
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
      intensity: numericProperty(`${id}-intensity`, type === 'spot' ? 80 : type === 'point' ? 18 : 1.5),
      transform: makeTransform3D(id, type === 'ambient' ? [0, 0, 0] : [4, 5, 3]),
      castShadow: type !== 'ambient',
    }
    if (type === 'spot') {
      light.angle = numericProperty(`${id}-angle`, 32)
      light.distance = numericProperty(`${id}-distance`, 0)
      light.penumbra = numericProperty(`${id}-penumbra`, .25)
    }
    if (type === 'directional' || type === 'spot') {
      const [rotationX, rotationY, rotationZ] = aimRotationDegrees([4, 5, 3], sceneAimTarget(scene))
      light.transform.rotation.x.value = rotationX
      light.transform.rotation.y.value = rotationY
      light.transform.rotation.z.value = rotationZ
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
      if (entity.value.type !== 'mesh' || entity.value.primitive === 'model') return [...transformProperties, ...influenceProperties]
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
      const objectConstraint = entity.value.objectConstraint
      const objectConstraintProperties = objectConstraint
        ? [
            objectConstraint.positionOffset.x, objectConstraint.positionOffset.y, objectConstraint.positionOffset.z,
            objectConstraint.rotationOffset.x, objectConstraint.rotationOffset.y, objectConstraint.rotationOffset.z,
          ]
        : []
      return [
        ...transformProperties, entity.value.fov, ...constraintProperties, ...objectConstraintProperties,
        entity.value.focusDistance, entity.value.fStop,
      ].filter((property): property is AnimatableProperty<number> => Boolean(property))
    }
    if (entity.kind === 'path') return transformProperties
    return [
      ...transformProperties,
      entity.value.intensity,
      entity.value.angle,
      entity.value.distance,
      entity.value.penumbra,
    ].filter((property): property is AnimatableProperty<number> => Boolean(property))
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
    if (entity?.kind !== 'object' || entity.value.type !== 'mesh' || entity.value.primitive === 'model') return
    if (apply3DPropertyValue(entity.value.material[key], value)) markSceneChanged()
  }

  function set3DObjectImage(assetId: string | null) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'object' || entity.value.primitive !== 'plane') return false
    const asset = assetId ? assets.value.find((item) => item.id === assetId && (item.kind === 'image' || item.kind === 'texture')) : undefined
    if (assetId && !asset) return false
    entity.value.assetId = asset?.id
    markSceneChanged()
    return true
  }

  /** Points the scene at a radiance map, which lights every material and can also be the backdrop. */
  function set3DEnvironmentMap(assetId: string | null) {
    const scene = selectedScene.value
    if (!scene) return false
    const asset = assetId ? assets.value.find((item) => item.id === assetId && item.kind === 'hdr') : undefined
    if (assetId && !asset) return false
    if (asset) scene.environmentAssetId = asset.id
    else {
      delete scene.environmentAssetId
      scene.environmentBackground = false
    }
    markSceneChanged(scene)
    return true
  }

  function set3DEnvironmentBackground(visible: boolean) {
    const scene = selectedScene.value
    if (!scene || !scene.environmentAssetId) return false
    scene.environmentBackground = visible
    markSceneChanged(scene)
    return true
  }

  function set3DObjectModel(assetId: string | null) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'object' || entity.value.primitive !== 'model') return false
    const asset = assetId ? assets.value.find((item) => item.id === assetId && item.kind === 'model3d') : undefined
    if (assetId && !asset) return false
    entity.value.assetId = asset?.id
    markSceneChanged()
    return true
  }

  function set3DLightIntensity(value: number) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'light') return
    if (apply3DPropertyValue(entity.value.intensity, value)) markSceneChanged()
  }

  function set3DCameraLens(key: 'focusDistance' | 'fStop', value: number) {
    const entity = selectedSceneEntity.value
    const property = entity?.kind === 'camera' ? entity.value[key] : undefined
    if (!property || !Number.isFinite(value)) return
    const clamped = key === 'focusDistance'
      ? Math.max(.01, Math.min(1000, value))
      : Math.max(1, Math.min(22, value))
    if (apply3DPropertyValue(property, clamped)) markSceneChanged()
  }

  function set3DCameraDepthOfField(enabled: boolean) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'camera') return false
    entity.value.depthOfField = enabled
    entity.value.focusDistance ??= numericProperty(`${entity.value.id}-focus-distance`, 8)
    entity.value.fStop ??= numericProperty(`${entity.value.id}-f-stop`, 2.8)
    markSceneChanged()
    return true
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

  function set3DLightCone(key: 'angle' | 'distance' | 'penumbra', value: number) {
    const entity = selectedSceneEntity.value
    const property = entity?.kind === 'light' && entity.value.type === 'spot' ? entity.value[key] : undefined
    if (!property || !Number.isFinite(value)) return
    const clamped = key === 'angle'
      ? Math.max(1, Math.min(89, value))
      : key === 'distance'
        ? Math.max(0, Math.min(1000, value))
        : Math.max(0, Math.min(1, value))
    if (apply3DPropertyValue(property, clamped)) markSceneChanged()
  }

  function add3DInfluence(type: AuroraInfluenceType) {
    const object = selectedObject()
    // An imported subtree carries its own geometry, so nothing in the influence stack can reach it.
    if (!object || object.primitive === 'model') return null
    if (object.type !== 'mesh' && type !== 'array') return null
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
      const object = scene.objects[objectIndex]!
      if (object.type === 'group') releaseGroupChildren(scene, object)
      scene.objects.splice(objectIndex, 1)
      scene.objects.forEach((object) => { if (object.parentId === entityId) delete object.parentId })
      scene.cameras.forEach((camera) => {
        if (camera.pathConstraint?.lookAtEntityId === entityId) delete camera.pathConstraint.lookAtEntityId
        if (camera.objectConstraint?.objectId === entityId) delete camera.objectConstraint
        else if (camera.objectConstraint?.lookAtEntityId === entityId) delete camera.objectConstraint.lookAtEntityId
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
    else {
      delete camera.objectConstraint
      if (camera.pathConstraint) camera.pathConstraint.pathId = pathId
      else camera.pathConstraint = createCameraPathConstraint(camera.id, pathId)
    }
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

  function setCameraObjectConstraint(objectId: string | null) {
    const camera = selectedCamera()
    if (!camera) return
    if (!objectId) delete camera.objectConstraint
    else {
      delete camera.pathConstraint
      if (camera.objectConstraint) camera.objectConstraint.objectId = objectId
      else camera.objectConstraint = createCameraObjectConstraint(camera.id, objectId)
    }
    markSceneChanged()
  }

  function setCameraObjectOrientation(orientation: AuroraObjectFollowOrientation) {
    const constraint = selectedCamera()?.objectConstraint
    if (!constraint) return
    constraint.orientation = orientation
    markSceneChanged()
  }

  function setCameraObjectLookAtTarget(entityId: string | null) {
    const constraint = selectedCamera()?.objectConstraint
    if (!constraint) return
    if (entityId) constraint.lookAtEntityId = entityId
    else delete constraint.lookAtEntityId
    markSceneChanged()
  }

  function setCameraObjectOffset(group: 'positionOffset' | 'rotationOffset', axis: 'x' | 'y' | 'z', value: number) {
    const constraint = selectedCamera()?.objectConstraint
    if (!constraint || !Number.isFinite(value)) return
    if (apply3DPropertyValue(constraint[group][axis], value)) markSceneChanged()
  }

  function resetCameraObjectOffset(group: 'positionOffset' | 'rotationOffset') {
    const constraint = selectedCamera()?.objectConstraint
    if (!constraint) return
    let changed = false
    ;(['x', 'y', 'z'] as const).forEach((axis) => { changed = apply3DPropertyValue(constraint[group][axis], 0) || changed })
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

  /**
   * Sizes a mask node's segment list to the shape it is masking. Segments that have never been given
   * a width inherit the node's own Feather socket, so connecting a shape behaves like the single
   * global feather it replaced until an individual segment is edited.
   */
  function ensureMaskSegments(nodeId: string, segmentCount: number) {
    const node = nodes.value.find((item) => item.id === nodeId && item.kind === 'mask')
    if (!node || segmentCount < 1) return
    const fallback = Math.max(0, node.inputs[2]?.value ?? 0)
    const current = node.maskSegmentFeather ?? []
    if (current.length === segmentCount) return
    node.maskSegmentFeather = Array.from({ length: segmentCount }, (_, index) => current[index] ?? fallback)
    markChanged()
  }

  /** Feather is a per-segment width in project pixels. Negative widths are not meaningful. */
  function setMaskSegmentFeather(nodeId: string, segmentIndex: number, feather: number) {
    const node = nodes.value.find((item) => item.id === nodeId && item.kind === 'mask')
    const values = node?.maskSegmentFeather
    if (!values || segmentIndex < 0 || segmentIndex >= values.length) return
    const next = Number.isFinite(feather) ? Math.max(0, feather) : 0
    if (values[segmentIndex] === next) return
    values[segmentIndex] = next
    markChanged()
  }

  function setMaskSegmentFeatherAll(nodeId: string, feather: number) {
    const node = nodes.value.find((item) => item.id === nodeId && item.kind === 'mask')
    if (!node?.maskSegmentFeather) return
    const next = Number.isFinite(feather) ? Math.max(0, feather) : 0
    node.maskSegmentFeather = node.maskSegmentFeather.map(() => next)
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

  const selectedLayerRig = computed(() => rigs.value.find((rig) => rig.id === selectedLayer.value?.rigId) ?? null)
  const selected3DObjectRig = computed(() => {
    const entity = selectedSceneEntity.value
    return entity?.kind === 'object' ? rigs.value.find((rig) => rig.id === entity.value.rigId) ?? null : null
  })
  const selectedRigBone = computed(() => {
    const rig = selectedLayerRig.value ?? selected3DObjectRig.value
    return rig?.bones.find((bone) => bone.id === selectedRigBoneId.value) ?? null
  })

  const findRig = (rigId: string | null | undefined) => rigs.value.find((rig) => rig.id === rigId) ?? null
  const findRigBone = (rigId: string, boneId: string) => findRig(rigId)?.bones.find((bone) => bone.id === boneId) ?? null

  function addRig(name?: string) {
    const rig = createRig(name?.trim() || `Rig ${rigs.value.length + 1}`)
    rigs.value = [...rigs.value, rig]
    markChanged()
    return rig
  }

  function renameRig(rigId: string, name: string) {
    const rig = findRig(rigId)
    if (!rig || !name.trim()) return
    rig.name = name.trim()
    markChanged()
  }

  /** Removing a rig also releases whatever it was bending, so nothing is left claiming a missing rig. */
  function deleteRig(rigId: string) {
    if (!findRig(rigId)) return
    rigs.value = rigs.value.filter((rig) => rig.id !== rigId)
    const release = (list: EditorLayer[]) => list.forEach((layer) => {
      if (layer.rigId === rigId) delete layer.rigId
      if (layer.children) release(layer.children)
    })
    release(layers.value)
    scenes3D.value.forEach((scene) => {
      let touched = false
      scene.objects.forEach((object) => {
        if (object.rigId !== rigId) return
        delete object.rigId
        touched = true
      })
      if (touched) scene.revision += 1
    })
    if (selectedRigBoneId.value) selectedRigBoneId.value = null
    markChanged()
  }

  function setRigGrid(rigId: string, columns: number, rows: number) {
    const rig = findRig(rigId)
    if (!rig) return
    const clamp = (value: number, fallback: number) => Math.max(MIN_RIG_CELLS, Math.min(MAX_RIG_CELLS, Math.round(Number.isFinite(value) ? value : fallback)))
    rig.columns = clamp(columns, rig.columns)
    rig.rows = clamp(rows, rig.rows)
    markChanged()
  }

  /** Attaching is exclusive per target: a layer or object bends under one skeleton at a time. */
  function attachRigToLayer(rigId: string | null) {
    const layer = selectedLayer.value
    if (!layer) return
    if (rigId && findRig(rigId)) layer.rigId = rigId
    else delete layer.rigId
    selectedRigBoneId.value = null
    markChanged()
  }

  function attachRigToObject(rigId: string | null) {
    const entity = selectedSceneEntity.value
    if (entity?.kind !== 'object') return
    if (rigId && findRig(rigId)) entity.value.rigId = rigId
    else delete entity.value.rigId
    selectedRigBoneId.value = null
    markSceneChanged()
  }

  function addRigBone(rigId: string, seed: Parameters<typeof createRigBone>[1] = {}) {
    const rig = findRig(rigId)
    if (!rig) return null
    const bone = createRigBone(rig.bones.length + 1, seed)
    rig.bones = [...rig.bones, bone]
    selectedRigBoneId.value = bone.id
    markChanged()
    return bone
  }

  /** A deleted bone hands its children to its own parent, so a limb never detaches from the chain. */
  function deleteRigBone(rigId: string, boneId: string) {
    const rig = findRig(rigId)
    const bone = rig?.bones.find((item) => item.id === boneId)
    if (!rig || !bone) return
    rig.bones = rig.bones.filter((item) => item.id !== boneId)
    rig.bones.forEach((item) => {
      if (item.parentId !== boneId) return
      if (bone.parentId) item.parentId = bone.parentId
      else delete item.parentId
    })
    if (selectedRigBoneId.value === boneId) selectedRigBoneId.value = rig.bones[0]?.id ?? null
    markChanged()
  }

  function renameRigBone(rigId: string, boneId: string, name: string) {
    const bone = findRigBone(rigId, boneId)
    if (!bone || !name.trim()) return
    bone.name = name.trim()
    markChanged()
  }

  /** Refuses a parent that is already downstream, which would otherwise make the chain unposable. */
  function setRigBoneParent(rigId: string, boneId: string, parentId: string | null) {
    const rig = findRig(rigId)
    const bone = rig?.bones.find((item) => item.id === boneId)
    if (!rig || !bone) return
    if (!parentId) {
      delete bone.parentId
      markChanged()
      return
    }
    if (parentId === boneId) return
    const byId = new Map(rig.bones.map((item) => [item.id, item]))
    for (let ancestor = byId.get(parentId); ancestor; ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined) {
      if (ancestor.id === boneId) return
    }
    bone.parentId = parentId
    markChanged()
  }

  function setRigBoneRest(rigId: string, boneId: string, patch: Partial<Pick<AuroraRigBone, 'x' | 'y' | 'angle' | 'length' | 'falloff'>>) {
    const bone = findRigBone(rigId, boneId)
    if (!bone) return
    let changed = false
    ;(Object.entries(patch) as Array<[keyof typeof patch, number | undefined]>).forEach(([key, value]) => {
      if (value === undefined || !Number.isFinite(value)) return
      const next = key === 'length' || key === 'falloff' ? Math.max(0, value) : value
      if (bone[key] === next) return
      bone[key] = next
      changed = true
    })
    if (changed) markChanged()
  }

  function setRigBonePose(rigId: string, boneId: string, channel: RigBoneChannelKey, value: number) {
    const bone = findRigBone(rigId, boneId)
    if (!bone || !Number.isFinite(value)) return
    if (apply3DPropertyValue(bone[channel], channel === 'stretch' ? Math.max(.01, value) : value)) markChanged()
  }

  function resetRigBonePose(rigId: string, boneId: string) {
    const bone = findRigBone(rigId, boneId)
    if (!bone) return
    let changed = false
    ;([['rotation', 0], ['offsetX', 0], ['offsetY', 0], ['stretch', 1]] as Array<[RigBoneChannelKey, number]>)
      .forEach(([channel, value]) => { changed = apply3DPropertyValue(bone[channel], value) || changed })
    if (changed) markChanged()
  }

  /** Bones the given one can legally hang from: anything that is not itself or one of its descendants. */
  function rigParentCandidates(rigId: string, boneId: string) {
    const rig = findRig(rigId)
    if (!rig) return []
    const descendants = new Set([boneId])
    let grew = true
    while (grew) {
      grew = false
      rig.bones.forEach((bone) => {
        if (bone.parentId && descendants.has(bone.parentId) && !descendants.has(bone.id)) {
          descendants.add(bone.id)
          grew = true
        }
      })
    }
    return rig.bones.filter((bone) => !descendants.has(bone.id))
  }

  /** Everything the offline renderers need, detached from the reactive store. */
  function exportComposition() {
    return {
      project: toRaw(project.value),
      layers: toRaw(layers.value),
      scenes3D: toRaw(scenes3D.value),
      assets: toRaw(assets.value),
      nodes: toRaw(nodes.value),
      nodeConnections: toRaw(nodeConnections.value),
      renderRootNodeId: renderRootNodeId.value,
      rigs: toRaw(rigs.value),
    }
  }

  /** Shared plumbing for the offline renderers: one at a time, cancellable, with real progress. */
  async function runExport(label: string, extension: string, filename: string, render: (report: (frame: number, total: number) => void, signal: AbortSignal) => Promise<Blob>) {
    if (exportStatus.value === 'rendering') return
    const controller = new AbortController()
    exportAbort = controller
    exportStatus.value = 'rendering'
    exportMessage.value = ''
    exportProgress.value = 1
    try {
      const blob = await render(
        (frame, total) => { exportProgress.value = Math.max(1, Math.round((frame / total) * 100)) },
        controller.signal,
      )
      const name = filename.trim() || project.value.name
      downloadBlob(blob, name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`)
      exportProgress.value = 100
      exportStatus.value = 'done'
      exportMessage.value = `${(blob.size / 1024 / 1024).toFixed(1)} MB written`
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      exportProgress.value = 0
      exportStatus.value = cancelled ? 'idle' : 'error'
      exportMessage.value = cancelled ? '' : error instanceof Error ? error.message : `The ${label} render failed.`
    } finally {
      exportAbort = null
    }
  }

  /** Renders every frame of the composition into a WebM video and downloads it. */
  async function exportVideo(options: { filename: string; maxWidth: number; frameRate: number; quality: 'web' | 'high' | 'master'; codec?: 'vp9' | 'vp8' | 'av1'; startTime?: number; endTime?: number }) {
    await runExport('video', '.webm', options.filename, async (onProgress, signal) => {
      const { exportProjectVideo } = await import('@/engine/rendering/videoExport')
      return exportProjectVideo({
        composition: exportComposition(),
        maxWidth: options.maxWidth,
        frameRate: options.frameRate,
        quality: options.quality,
        codec: options.codec,
        startTime: options.startTime,
        endTime: options.endTime,
        signal,
        onProgress,
      })
    })
  }

  /** Renders every frame of the composition into an animated GIF and downloads it. */
  async function exportGif(options: { filename: string; maxWidth: number; frameRate: number; colors: number; loop: boolean; startTime?: number; endTime?: number }) {
    await runExport('GIF', '.gif', options.filename, async (onProgress, signal) => {
      const { exportProjectGif } = await import('@/engine/rendering/gifExport')
      return exportProjectGif({
        composition: exportComposition(),
        maxWidth: options.maxWidth,
        frameRate: options.frameRate,
        colors: options.colors,
        loop: options.loop,
        startTime: options.startTime,
        endTime: options.endTime,
        signal,
        onProgress,
      })
    })
  }

  function cancelExport() {
    exportAbort?.abort()
  }

  resetEditorHistory()

  return {
    project, availableProjects, projectBrowserBusy, projectBrowserError, renderRevision,
    frameCacheStatus, frameCacheFrames, frameCacheProjectId, frameCacheRevision, frameCacheScope,
    frameCacheProgress, frameCacheRange, frameCacheRequestId, frameCacheCancelId, frameCacheClearId,
    workspace, currentTime, playing, loop, autoKey, snap, ripple, selectedLayerId, selectedKeyframeId, timelineMarkers,
    canUndo, canRedo, historyEntries, undo, redo, jumpToHistory, beginInteractiveEdit, endInteractiveEdit,
    selectedNodeId, selectedSceneId, selectedSceneEntityId, zoom, saveStatus, exportProgress, exportStatus, exportMessage, assets, layers, scenes3D,
    nodes, nodeConnections, selectedConnectionId, renderRootNodeId,
    rigs, selectedRigBoneId, selectedLayerRig, selected3DObjectRig, selectedRigBone,
    addRig, renameRig, deleteRig, setRigGrid, attachRigToLayer, attachRigToObject,
    addRigBone, deleteRigBone, renameRigBone, setRigBoneParent, setRigBoneRest, setRigBonePose, resetRigBonePose,
    rigParentCandidates, findRig,
    selectNode, selectNodeConnection, addNode, moveNode, deleteNode, connectNodes, disconnectNodes,
    setNodeSource, setNodeSocketValue, setNodeProperty, toggleNodeMuted, setRenderRootNode,
    ensureMaskSegments, setMaskSegmentFeather, setMaskSegmentFeatherAll, selectedMaskSegment,
    selectedLayer, selectedScene, selectedSceneEntity,
    togglePlayback, setTime, stepFrame, setProjectDuration, addTimelineMarker, updateTimelineMarker, deleteTimelineMarker, jumpToAdjacentTimelineMarker, addKeyframe, setLayerValue,
    addLayerEffect, removeLayerEffect, toggleLayerEffect, moveLayerEffect, setLayerEffectValue, addFiles,
    deleteMediaAsset, mediaAssetReferenceCount,
    importFailures, draggingAssetId, addAssetToTimeline, addGeneratedLayer, addPathLayer, addTimelineLayer, reorderTrack, moveSegmentToTrack, moveSegmentToNewTrack, addEmptyTrack, rippleTrackSegments,
    renameTimelineLayers, setTimelineLayersVisible, deleteTimelineLayers,
    createCluster, releaseCluster, createEmptyCluster, updateClusterSettings, isClusterNameAvailable,
    openClusterTabs, activeClusterId, activeCluster, timelineLayers, clusterTabs,
    enterCluster, activateTimelineTab, closeClusterTab, fitClusterToChildren, publishClusterAsset, ensureClusterAssets, dedupeCompositionAssets,
    splitLayerAt, splitSelectedLayer, markChanged, saveProjectNow, flushProjectSave, initializePersistence,
    requestFrameCacheRange, cancelFrameCache, requestFrameCacheClear, beginFrameCache,
    recordFrameCached, updateFrameCacheProgress, finishFrameCache, resetFrameCacheDisplay,
    refreshProjects, openProject, createEmptyProject, setProjectFormat, setWorkspace, create3DSceneFromWorkspace, exportVideo, exportGif, cancelExport,
    publish3DSceneAsset, ensure3DSceneAssets,
    selectSceneEntity, select3DLayer, markSceneChanged, add3DPrimitive, add3DGroup, ungroup3DObject, add3DImagePlane, add3DModel, add3DLight, add3DCamera, set3DEntityTransform,
    rename3DEntity, set3DEntityVisible, delete3DEntity,
    update3DEntityTransform, set3DObjectMaterial, set3DObjectImage, set3DObjectModel, set3DLightIntensity, set3DLightCone, set3DEnvironmentMap, set3DEnvironmentBackground, set3DCameraFov, set3DCameraLens, set3DCameraDepthOfField,
    toggle3DKeyframe, keySelected3DTransform, move3DKeyframe, delete3DKeyframe, setActive3DCamera,
    add3DCameraCut, set3DCameraCutCamera, move3DCameraCut, delete3DCameraCut,
    add3DPath, delete3DPath, findScenePath, move3DPathPoint, set3DPathPointAxis, set3DPathPointMode,
    add3DPathPoint, add3DPathEndpoint, delete3DPathPoint, toggle3DPathClosed, set3DPathColor, set3DPathLocked,
    setCameraPathConstraint, setCameraPathOrientation, setCameraPathTarget, setCameraPathProgress, setCameraPathBank,
    setCameraPathOffset, resetCameraPathOffset,
    setCameraObjectConstraint, setCameraObjectOrientation, setCameraObjectLookAtTarget, setCameraObjectOffset, resetCameraObjectOffset,
    toggleLayerPropertyKeyframe, toggle3DPropertyKeyframe, stepToAdjacentKeyframe, hasAdjacentKeyframe, isKeyedAtPlayhead,
    add3DInfluence, remove3DInfluence, toggle3DInfluence, move3DInfluence, set3DInfluenceParameter,
  }
})
