<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  AudioLines, Box, ChevronDown, ChevronRight, Circle, CircleDot, Eye, EyeOff, Film, FolderPlus, Gauge, GripVertical, Image as ImageIcon, KeyRound,
  Link2, Lock, Magnet, Minus, MousePointer2, Plus, Scissors, Search,
  Pencil, SlidersHorizontal, Sparkles, SquareStack, Trash2, Type as TypeIcon, Unlock, Video, Volume2, VolumeX, X,
} from '@lucide/vue'
import { useEditorStore, type TimelineLayerPreset } from '@/stores/editor'
import type { EditorLayer, Keyframe } from '@/models/editor'
import IconButton from './common/IconButton.vue'
import CurveEditor from './CurveEditor.vue'
import MDialog from './common/MDialog.vue'
import NumberField from './common/NumberField.vue'

const store = useEditorStore()
const {
  project, currentTime, layers, timelineLayers, clusterTabs, activeClusterId,
  selectedLayer, selectedLayerId, selectedKeyframeId, autoKey, snap, ripple, workspace, draggingAssetId,
} = storeToRefs(store)
const activeBottomTab = ref('Timeline')
const timelineZoom = ref(100)
const timelineRef = ref<HTMLElement>()
const tracksScroll = ref<HTMLElement>()
const timelineViewportWidth = ref(900)
const isPanning = ref(false)
const isScrubbing = ref(false)
const isCutMode = ref(false)
const cutGhost = ref({ visible: false, overClip: false, trackId: null as string | null, x: 0, y: 0, levelY: 0, height: 0, time: 0 })
const draggedTrackId = ref<string | null>(null)
const trackDropTarget = ref<{ id: string; before: boolean } | null>(null)
const clipDropTrackId = ref<string | null>(null)
const clipInvalidTrackId = ref<string | null>(null)
const draggingClipId = ref<string | null>(null)
const clipDragGhost = ref({ visible: false, x: 0, y: 0, width: 0, color: '', label: '', valid: false, invalid: false })
const newTrackDropCategory = ref<'visual' | 'audio' | null>(null)
const selectedTrackIds = ref<string[]>([])
const selectedLayerIds = ref<string[]>(selectedLayerId.value ? [selectedLayerId.value] : [])
const selectionAnchorId = ref(selectedLayerId.value)
const addLayerMenuOpen = ref(false)
const addLayerTrigger = ref<HTMLElement>()
const addLayerMenuStyle = ref<Record<string, string>>({ top: '29px' })
const layerMarqueeRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const trackContextMenu = ref<{ trackId: string; layerIds: string[]; clipId: string | null; x: number; y: number } | null>(null)
const trackDialog = ref<{ mode: 'rename' | 'delete'; scope: 'track' | 'clips'; layerIds: string[]; name: string; clipCount: number } | null>(null)
const trackRenameValue = ref('')
const tabs = ['Timeline', 'Graph Editor', 'Audio Mixer', 'Scopes']

const layerPresets = [
  { kind: 'adjustment', label: 'Adjustment Layer', detail: 'Empty effects layer', icon: SlidersHorizontal, group: 'Effects' },
  { kind: 'cinematic-grade', label: 'Cinematic Grade', detail: 'Color Matrix + Vignette', icon: Sparkles, group: 'Effects' },
  { kind: '3d-scene', label: '3D Scene', detail: 'Scene, camera, and light', icon: Box, group: 'Generated' },
  { kind: 'text', label: 'Text', detail: 'Editable text layer', icon: TypeIcon, group: 'Generated' },
  { kind: 'rectangle', label: 'Rectangle', detail: 'Shape layer', icon: SquareStack, group: 'Generated' },
  { kind: 'ellipse', label: 'Ellipse', detail: 'Shape layer', icon: Circle, group: 'Generated' },
  { kind: 'image', label: 'Image Layer', detail: 'Empty media layer', icon: ImageIcon, group: 'Media' },
  { kind: 'video', label: 'Video Layer', detail: 'Empty media layer', icon: Video, group: 'Media' },
  { kind: 'audio', label: 'Audio Layer', detail: 'Empty audio layer', icon: AudioLines, group: 'Media' },
] satisfies Array<{ kind: TimelineLayerPreset; label: string; detail: string; icon: typeof Box; group: 'Effects' | 'Generated' | 'Media' }>

interface PanState {
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
}

interface ClipDragState {
  layer: EditorLayer
  mode: 'move' | 'trim-start' | 'trim-end'
  startX: number
  startY: number
  originalStart: number
  originalDuration: number
  originalProjectDuration: number
  originalViewDuration: number
  originalTrackId: string
  targetTrackId: string | null
  newTrackCategory: 'visual' | 'audio' | null
  dropAllowed: boolean
  keyframeTimes: Map<string, number>
  childStarts: Map<string, number>
  childKeyframeTimes: Map<string, number>
  moved: boolean
}

type TransformKey = keyof EditorLayer['transform']

interface KeyframeEntry {
  property: TransformKey
  keyframe: Keyframe<number>
}

interface LayerKeyframeSummary {
  id: string
  time: number
  channels: number
  entries: KeyframeEntry[]
}

interface KeyframeDragState {
  layer: EditorLayer
  entries: Array<KeyframeEntry & { originalTime: number }>
  startX: number
  moved: boolean
}

interface TimelineTrack {
  id: string
  segments: EditorLayer[]
}

interface LayerMarqueeState {
  startX: number
  startY: number
  lastClientX: number
  baseSelection: string[]
  moved: boolean
}

const propertyTracks: { key: TransformKey; label: string; suffix: string }[] = [
  { key: 'x', label: 'Position X', suffix: ' px' },
  { key: 'y', label: 'Position Y', suffix: ' px' },
  { key: 'scaleX', label: 'Scale X', suffix: '%' },
  { key: 'scaleY', label: 'Scale Y', suffix: '%' },
  { key: 'rotation', label: 'Rotation', suffix: '°' },
  { key: 'opacity', label: 'Opacity', suffix: '%' },
]

let panState: PanState | null = null
let clipDragState: ClipDragState | null = null
let keyframeDragState: KeyframeDragState | null = null
let layerMarqueeState: LayerMarqueeState | null = null
let resizeObserver: ResizeObserver | null = null

/**
 * Inside a cluster the timeline reads relative to that cluster: its first frame is 0. Children keep
 * absolute project times, so moving the cluster on the main timeline moves the cluster and its
 * children together and the view inside is unchanged — which is the point.
 */
const viewOrigin = computed(() => store.activeCluster?.start ?? 0)
const viewDuration = computed(() => Math.max(1 / project.value.frameRate, store.activeCluster?.duration ?? project.value.duration))
const toFraction = (time: number) => (time - viewOrigin.value) / viewDuration.value
const fromFraction = (fraction: number) => viewOrigin.value + fraction * viewDuration.value
const clampToView = (time: number) => Math.max(viewOrigin.value, Math.min(viewOrigin.value + viewDuration.value, time))

const timelineLaneWidth = computed(() => {
  const fitWidth = Math.max(240, timelineViewportWidth.value - 220)
  return Math.max(fitWidth, fitWidth * (timelineZoom.value / 100))
})
const timelineContentWidth = computed(() => 220 + timelineLaneWidth.value)
const timelineContentStyle = computed(() => ({ width: `${timelineContentWidth.value}px` }))
const timelineTracks = computed<TimelineTrack[]>(() => {
  const tracks = new Map<string, TimelineTrack>()
  timelineLayers.value.forEach((layer) => {
    const trackId = layer.trackId ?? layer.id
    const track = tracks.get(trackId)
    if (track) track.segments.push(layer)
    else tracks.set(trackId, { id: trackId, segments: [layer] })
  })
  const ordered = [...tracks.values()].map((track) => ({ ...track, segments: track.segments.sort((left, right) => left.start - right.start) }))
  return [...ordered.filter((track) => track.segments[0]?.type !== 'audio'), ...ordered.filter((track) => track.segments[0]?.type === 'audio')]
})
const visualTrackCount = computed(() => timelineTracks.value.filter((track) => track.segments[0]?.type !== 'audio').length)
const clusterableSelectionCount = computed(() => selectedLayerIds.value.filter((id) => {
  const layer = timelineLayers.value.find((item) => item.id === id)
  return layer && layer.type !== 'audio' && !layer.isPlaceholder
}).length)

const ticks = computed(() => {
  const tickCount = Math.max(5, Math.min(40, Math.round(9 * timelineZoom.value / 100)))
  return Array.from({ length: tickCount + 1 }, (_, index) => {
    const relative = index * (viewDuration.value / tickCount)
    return {
      time: viewOrigin.value + relative,
      fraction: index / tickCount,
      label: `${String(Math.floor(relative / 60)).padStart(2, '0')}:${String(Math.floor(relative) % 60).padStart(2, '0')}`,
    }
  })
})

const playheadStyle = computed(() => ({
  left: `${220 + timelineLaneWidth.value * Math.max(0, Math.min(1, toFraction(currentTime.value)))}px`,
}))
const layerIcon = (type: EditorLayer['type']) => type === 'audio' ? AudioLines : type === 'video' ? Film : type === 'text' ? KeyRound : type === 'adjustment' ? Sparkles : SquareStack

function trackDisplayLayer(track: TimelineTrack) {
  return track.segments.find((segment) => segment.id === selectedLayerId.value) ?? track.segments[0]!
}

function selectTrack(track: TimelineTrack, event?: MouseEvent) {
  if (event?.ctrlKey || event?.metaKey) {
    selectedTrackIds.value = selectedTrackIds.value.includes(track.id)
      ? selectedTrackIds.value.filter((id) => id !== track.id)
      : [...selectedTrackIds.value, track.id]
  } else {
    selectedTrackIds.value = [track.id]
  }
  const primary = trackDisplayLayer(track)
  const layerIds = timelineTracks.value
    .filter((item) => selectedTrackIds.value.includes(item.id))
    .flatMap((item) => item.segments.filter((segment) => !segment.isPlaceholder).map((segment) => segment.id))
  if (layerIds.length) {
    publishLayerSelection(layerIds, primary.isPlaceholder ? undefined : primary.id)
    if (!primary.isPlaceholder) selectionAnchorId.value = primary.id
  } else {
    selectedLayerIds.value = []
    selectedLayerId.value = primary.id
  }
}

function publishLayerSelection(ids: string[], primaryId?: string) {
  const availableIds = new Set(timelineLayers.value.filter((layer) => !layer.isPlaceholder).map((layer) => layer.id))
  selectedLayerIds.value = [...new Set(ids)].filter((id) => availableIds.has(id))
  selectedTrackIds.value = [...new Set(selectedLayerIds.value.map((id) => {
    const layer = timelineLayers.value.find((item) => item.id === id)!
    return layer.trackId ?? layer.id
  }))]
  const primary = primaryId && selectedLayerIds.value.includes(primaryId)
    ? primaryId
    : selectedLayerIds.value.at(-1)
  if (primary) selectedLayerId.value = primary
}

function selectLayerFromPointer(event: PointerEvent, layer: EditorLayer) {
  const selectableLayers = timelineLayers.value.filter((item) => !item.isPlaceholder)
  const orderedIds = selectableLayers.map((item) => item.id)
  const toggle = event.ctrlKey || event.metaKey
  if (event.shiftKey && selectionAnchorId.value) {
    const anchorIndex = orderedIds.indexOf(selectionAnchorId.value)
    const targetIndex = orderedIds.indexOf(layer.id)
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const range = orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
      publishLayerSelection(toggle ? [...selectedLayerIds.value, ...range] : range, layer.id)
      return
    }
  }
  if (toggle) {
    const alreadySelected = selectedLayerIds.value.includes(layer.id)
    const next = alreadySelected
      ? selectedLayerIds.value.filter((id) => id !== layer.id)
      : [...selectedLayerIds.value, layer.id]
    publishLayerSelection(next, alreadySelected ? undefined : layer.id)
    if (!alreadySelected) selectionAnchorId.value = layer.id
    return
  }
  if (!selectedLayerIds.value.includes(layer.id)) publishLayerSelection([layer.id], layer.id)
  else selectedLayerId.value = layer.id
  selectionAnchorId.value = layer.id
}

function toggleCluster() {
  if (selectedLayer.value?.type === 'cluster') {
    const children = selectedLayer.value.children ?? []
    if (store.releaseCluster(selectedLayer.value.id)) {
      selectedTrackIds.value = children.map((child) => child.trackId ?? child.id)
      publishLayerSelection(children.map((child) => child.id), children[0]?.id)
    }
    return
  }
  const layerIds = selectedLayerIds.value.filter((id) => {
    const layer = timelineLayers.value.find((item) => item.id === id)
    return layer && layer.type !== 'audio' && !layer.isPlaceholder
  })
  const cluster = store.createCluster(layerIds)
  if (cluster) {
    selectedTrackIds.value = [cluster.id]
    publishLayerSelection([cluster.id], cluster.id)
  }
}

/**
 * The timeline sits at the bottom of the window, so a menu that always drops downwards would be
 * clipped. Measure the trigger and open towards whichever side has more room, capped to fit.
 */
function toggleAddLayerMenu() {
  if (addLayerMenuOpen.value) {
    addLayerMenuOpen.value = false
    return
  }
  const bounds = addLayerTrigger.value?.getBoundingClientRect()
  if (!bounds) return
  const margin = 10
  const below = window.innerHeight - bounds.bottom - margin
  const above = bounds.top - margin
  const dropUp = below < Math.min(320, above)
  addLayerMenuStyle.value = {
    left: `${Math.round(Math.max(margin, Math.min(bounds.left, window.innerWidth - 234)))}px`,
    ...(dropUp
      ? { bottom: `${Math.round(window.innerHeight - bounds.top + 4)}px`, maxHeight: `${Math.max(140, Math.floor(above))}px` }
      : { top: `${Math.round(bounds.bottom + 4)}px`, maxHeight: `${Math.max(140, Math.floor(below))}px` }),
  }
  addLayerMenuOpen.value = true
}

function addLayer(preset: TimelineLayerPreset) {
  const layer = store.addTimelineLayer(preset)
  addLayerMenuOpen.value = false
  selectedTrackIds.value = [layer.trackId ?? layer.id]
  publishLayerSelection([layer.id], layer.id)
  selectionAnchorId.value = layer.id
}

function toggleTrackExpanded(track: TimelineTrack) {
  const expanded = !trackDisplayLayer(track).expanded
  track.segments.forEach((segment) => { segment.expanded = expanded })
}

function toggleTrackVisible(track: TimelineTrack, event: MouseEvent) {
  event.stopPropagation()
  const visible = !trackDisplayLayer(track).visible
  track.segments.forEach((segment) => { segment.visible = visible })
}

function toggleTrackLock(track: TimelineTrack, event: MouseEvent) {
  event.stopPropagation()
  const locked = !trackDisplayLayer(track).locked
  track.segments.forEach((segment) => { segment.locked = locked })
}

function toggleTrackMuted(track: TimelineTrack, event: MouseEvent) {
  event.stopPropagation()
  const muted = !trackDisplayLayer(track).muted
  track.segments.forEach((segment) => { segment.muted = muted })
}

function contextTrack() {
  const menu = trackContextMenu.value
  return menu ? timelineTracks.value.find((track) => track.id === menu.trackId) ?? null : null
}

function openTrackContextMenu(event: MouseEvent, track: TimelineTrack) {
  event.preventDefault()
  // Right-clicking a clip should offer that clip, not silently target the whole track it sits on.
  const clipId = (event.target as Element | null)?.closest('[data-layer-id]')?.getAttribute('data-layer-id') ?? null
  const clip = clipId ? track.segments.find((segment) => segment.id === clipId && !segment.isPlaceholder) ?? null : null
  if (clip && !selectedLayerIds.value.includes(clip.id)) publishLayerSelection([clip.id], clip.id)
  else if (!clip) selectTrack(track, event)
  trackContextMenu.value = {
    trackId: track.id,
    layerIds: track.segments.map((segment) => segment.id),
    clipId: clip?.id ?? null,
    x: Math.min(event.clientX, window.innerWidth - 174),
    y: Math.min(event.clientY, window.innerHeight - 124),
  }
}

const trackDialogDescription = computed(() => {
  const target = trackDialog.value
  if (!target) return ''
  if (target.mode === 'rename') return 'The new name is applied to every clip on this track.'
  if (target.scope === 'clips') {
    return target.clipCount > 1
      ? `This removes ${target.clipCount} clips from the timeline.`
      : `This removes “${target.name}” from the timeline.`
  }
  return target.clipCount > 1
    ? `This removes “${target.name}” and all ${target.clipCount} clips on its track.`
    : `This removes “${target.name}” from the timeline.`
})

const contextClipDeleteLabel = computed(() => {
  const clipId = trackContextMenu.value?.clipId
  const multiple = clipId && selectedLayerIds.value.includes(clipId) && selectedLayerIds.value.length > 1
  return multiple ? `Delete ${selectedLayerIds.value.length} clips` : 'Delete clip'
})

/** Deletes what is selected when the click landed on a clip, falling back to the whole track. */
function deleteContextClips() {
  const menu = trackContextMenu.value
  if (!menu?.clipId) return
  const selection = selectedLayerIds.value.includes(menu.clipId) ? selectedLayerIds.value : [menu.clipId]
  trackContextMenu.value = null
  requestDeleteLayers(selection)
}

function renameContextTrack() {
  const track = contextTrack()
  const menu = trackContextMenu.value
  if (!track || !menu) return
  const name = trackDisplayLayer(track).name
  trackRenameValue.value = name
  trackDialog.value = { mode: 'rename', scope: 'track', layerIds: menu.layerIds, name, clipCount: track.segments.length }
  trackContextMenu.value = null
}

function toggleContextTrackVisible() {
  const track = contextTrack()
  const menu = trackContextMenu.value
  if (!track || !menu) return
  store.setTimelineLayersVisible(menu.layerIds, !track.segments.every((segment) => segment.visible))
  trackContextMenu.value = null
}

function deleteContextTrack() {
  const track = contextTrack()
  const menu = trackContextMenu.value
  if (!track || !menu) return
  const label = trackDisplayLayer(track).name
  trackDialog.value = { mode: 'delete', scope: 'track', layerIds: menu.layerIds, name: label, clipCount: track.segments.length }
  trackContextMenu.value = null
}

function confirmTrackDialog() {
  const target = trackDialog.value
  if (!target) return
  if (target.mode === 'rename') store.renameTimelineLayers(target.layerIds, trackRenameValue.value)
  // Deleting clips leaves their track behind; deleting the track removes the row as well.
  else store.deleteTimelineLayers(target.layerIds, { keepTracks: target.scope === 'clips' })
  trackDialog.value = null
}

function trackLabel(track: TimelineTrack, index: number) {
  return `${track.segments[0]?.type === 'audio' ? 'A' : 'V'}${track.segments[0]?.type === 'audio' ? index - visualTrackCount.value + 1 : index + 1}`
}

function beginTrackDrag(event: DragEvent, track: TimelineTrack) {
  draggedTrackId.value = track.id
  event.dataTransfer?.setData('application/x-aurora-track', track.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function updateTrackDrop(event: DragEvent, track: TimelineTrack) {
  // This handler stops propagation so track reordering does not fight the lane beneath it, which
  // means a library drag would never reach the timeline's own handler. Hand it over explicitly.
  if (draggingAssetId.value) {
    updateAssetDrop(event)
    return
  }
  const source = timelineTracks.value.find((item) => item.id === draggedTrackId.value)
  if (!source || source.id === track.id || (source.segments[0]?.type === 'audio') !== (track.segments[0]?.type === 'audio')) {
    trackDropTarget.value = null
    return
  }
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  trackDropTarget.value = { id: track.id, before: event.clientY < bounds.top + bounds.height / 2 }
}

function dropTrack(event: DragEvent, track: TimelineTrack) {
  event.preventDefault()
  if (draggingAssetId.value) {
    dropAsset(event)
    return
  }
  const sourceId = event.dataTransfer?.getData('application/x-aurora-track') || draggedTrackId.value
  if (sourceId && trackDropTarget.value?.id === track.id) store.reorderTrack(sourceId, track.id, trackDropTarget.value.before)
  endTrackDrag()
}

function endTrackDrag() {
  draggedTrackId.value = null
  trackDropTarget.value = null
}

function clipStyle(layer: EditorLayer) {
  return { left: `${toFraction(layer.start) * 100}%`, width: `${(layer.duration / viewDuration.value) * 100}%`, backgroundColor: layer.color }
}

function layerKeyframes(layer: EditorLayer) {
  const uniqueTimes = new Map<number, LayerKeyframeSummary>()
  propertyTracks.forEach(({ key }) => {
    layer.transform[key].keyframes.forEach((keyframe) => {
      const existing = uniqueTimes.get(keyframe.time)
      if (existing) {
        existing.channels += 1
        existing.entries.push({ property: key, keyframe })
      } else {
        uniqueTimes.set(keyframe.time, { id: keyframe.id, time: keyframe.time, channels: 1, entries: [{ property: key, keyframe }] })
      }
    })
  })
  return [...uniqueTimes.values()].sort((left, right) => left.time - right.time)
}

function clipKeyframeStyle(layer: EditorLayer, time: number) {
  return { left: `${Math.max(0, Math.min(100, ((time - layer.start) / layer.duration) * 100))}%` }
}

function descendantLayers(layer: EditorLayer): EditorLayer[] {
  return (layer.children ?? []).flatMap((child) => [child, ...descendantLayers(child)])
}

function seekAtClientX(clientX: number) {
  const element = timelineRef.value
  if (!element) return
  store.setTime(timeAtClientX(clientX, true))
}

function timeAtClientX(clientX: number, magnetic = false) {
  const element = timelineRef.value
  if (!element) return 0
  const rect = element.getBoundingClientRect()
  const x = Math.max(0, clientX - rect.left + element.scrollLeft - 220)
  const rawTime = fromFraction(x / timelineLaneWidth.value)
  const frameDuration = 1 / project.value.frameRate
  let nextTime = snap.value ? Math.round(rawTime / frameDuration) * frameDuration : rawTime
  if (snap.value && magnetic) {
    const keyframeTimes = timelineLayers.value.flatMap((layer) => propertyTracks.flatMap(({ key }) => layer.transform[key].keyframes.map((keyframe) => keyframe.time)))
    const nearestKeyframeTime = keyframeTimes.reduce<number | null>((nearest, time) => nearest === null || Math.abs(time - rawTime) < Math.abs(nearest - rawTime) ? time : nearest, null)
    const magneticTolerance = (viewDuration.value / timelineLaneWidth.value) * 6
    if (nearestKeyframeTime !== null && Math.abs(nearestKeyframeTime - rawTime) <= magneticTolerance) nextTime = nearestKeyframeTime
  }
  return Math.max(0, clampToView(nextTime))
}

function isKeyframeAtPlayhead(time: number) {
  return Math.abs(time - currentTime.value) <= (0.5 / project.value.frameRate) + 0.0001
}

function beginSeek(event: PointerEvent) {
  if (event.button !== 0 || isCutMode.value) return
  event.preventDefault()
  isScrubbing.value = true
  seekAtClientX(event.clientX)
}

function timelineContentPoint(clientX: number, clientY: number) {
  const element = timelineRef.value
  if (!element) return { x: 0, y: 0 }
  const bounds = element.getBoundingClientRect()
  return {
    x: clientX - bounds.left + element.scrollLeft,
    y: clientY - bounds.top + element.scrollTop,
  }
}

function beginLayerMarquee(event: PointerEvent) {
  if (event.button !== 0 || isCutMode.value || !timelineRef.value) return
  event.preventDefault()
  event.stopPropagation()
  const point = timelineContentPoint(event.clientX, event.clientY)
  const additive = event.ctrlKey || event.metaKey || event.shiftKey
  layerMarqueeState = {
    startX: point.x,
    startY: point.y,
    lastClientX: event.clientX,
    baseSelection: additive ? [...selectedLayerIds.value] : [],
    moved: false,
  }
  if (!additive) publishLayerSelection([])
  layerMarqueeRect.value = { left: point.x, top: point.y, width: 0, height: 0 }
}

function updateLayerMarquee(event: PointerEvent) {
  const element = timelineRef.value
  if (!layerMarqueeState || !element) return
  const point = timelineContentPoint(event.clientX, event.clientY)
  layerMarqueeState.lastClientX = event.clientX
  if (!layerMarqueeState.moved && Math.hypot(point.x - layerMarqueeState.startX, point.y - layerMarqueeState.startY) < 4) return
  layerMarqueeState.moved = true
  const rect = {
    left: Math.min(layerMarqueeState.startX, point.x),
    top: Math.min(layerMarqueeState.startY, point.y),
    width: Math.abs(point.x - layerMarqueeState.startX),
    height: Math.abs(point.y - layerMarqueeState.startY),
  }
  layerMarqueeRect.value = rect
  const timelineBounds = element.getBoundingClientRect()
  const hits = [...element.querySelectorAll<HTMLElement>('.timeline-clip[data-layer-id]')]
    .filter((clip) => {
      const bounds = clip.getBoundingClientRect()
      const left = bounds.left - timelineBounds.left + element.scrollLeft
      const top = bounds.top - timelineBounds.top + element.scrollTop
      return left < rect.left + rect.width
        && left + bounds.width > rect.left
        && top < rect.top + rect.height
        && top + bounds.height > rect.top
    })
    .map((clip) => clip.dataset.layerId)
    .filter((id): id is string => Boolean(id))
  publishLayerSelection([...layerMarqueeState.baseSelection, ...hits], hits.at(-1))
}

function toggleCutMode() {
  isCutMode.value = !isCutMode.value
  cutGhost.value.visible = false
  endPointerInteraction()
}

function updateCutGhost(event: PointerEvent) {
  const element = timelineRef.value
  if (!isCutMode.value || !element) return
  const bounds = element.getBoundingClientRect()
  const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom
  if (!inside) {
    cutGhost.value.visible = false
    return
  }
  const hitElements = document.elementsFromPoint(event.clientX, event.clientY)
  const clip = hitElements.map((hit) => hit.closest<HTMLElement>('.timeline-clip')).find(Boolean)
  const track = hitElements.map((hit) => hit.closest<HTMLElement>('.track-row')).find(Boolean)
  const trackBounds = track?.getBoundingClientRect()
  cutGhost.value = {
    visible: true,
    overClip: Boolean(clip),
    trackId: track?.dataset.trackId ?? null,
    x: event.clientX - bounds.left + element.scrollLeft,
    y: element.scrollTop,
    levelY: trackBounds ? trackBounds.top - bounds.top + trackBounds.height / 2 : event.clientY - bounds.top,
    height: element.clientHeight,
    time: timeAtClientX(event.clientX),
  }
}

function cutLayerAtPointer(event: PointerEvent, layer: EditorLayer) {
  if (!isCutMode.value || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  selectedLayerId.value = layer.id
  selectedKeyframeId.value = null
  store.splitLayerAt(layer.id, timeAtClientX(event.clientX))
}

function onClipPointerDown(event: PointerEvent, layer: EditorLayer) {
  if (isCutMode.value) cutLayerAtPointer(event, layer)
  else {
    selectLayerFromPointer(event, layer)
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) beginClipDrag(event, layer)
  }
}

function onTimelinePointerDown(event: PointerEvent) {
  if (event.button !== 1 || !timelineRef.value) return
  event.preventDefault()
  isPanning.value = true
  panState = {
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: timelineRef.value.scrollLeft,
    scrollTop: timelineRef.value.scrollTop,
  }
}

function beginClipDrag(event: PointerEvent, layer: EditorLayer, mode: ClipDragState['mode'] = 'move') {
  if (event.button !== 0 || layer.locked) return
  event.preventDefault()
  event.stopPropagation()
  selectedLayerId.value = layer.id
  selectedKeyframeId.value = null
  clipDragState = {
    layer,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    originalStart: layer.start,
    originalDuration: layer.duration,
    originalProjectDuration: project.value.duration,
    originalViewDuration: viewDuration.value,
    originalTrackId: layer.trackId ?? layer.id,
    targetTrackId: null,
    newTrackCategory: null,
    dropAllowed: true,
    keyframeTimes: new Map(propertyTracks.flatMap(({ key }) => layer.transform[key].keyframes.map((keyframe) => [keyframe.id, keyframe.time] as const))),
    childStarts: new Map(descendantLayers(layer).map((child) => [child.id, child.start])),
    childKeyframeTimes: new Map(descendantLayers(layer).flatMap((child) => propertyTracks.flatMap(({ key }) => child.transform[key].keyframes.map((keyframe) => [keyframe.id, keyframe.time] as const)))),
    moved: false,
  }
}

function updateClipDragGhost(layer: EditorLayer, row: HTMLElement | null | undefined, valid: boolean, invalid = false) {
  const timeline = timelineRef.value
  if (!timeline || !row) return
  const timelineBounds = timeline.getBoundingClientRect()
  const rowBounds = row.getBoundingClientRect()
  clipDragGhost.value = {
    visible: true,
    x: 220 + toFraction(layer.start) * timelineLaneWidth.value,
    y: rowBounds.top - timelineBounds.top + timeline.scrollTop + 3,
    width: Math.max(10, (layer.duration / viewDuration.value) * timelineLaneWidth.value),
    color: layer.color,
    label: layer.name,
    valid,
    invalid,
  }
}

/**
 * The drop target for a brand-new track only exists once the pointer actually leaves the stack it
 * would join — above the topmost visual track, or below the last track — so starting a drag no
 * longer inserts a row and shoves the whole timeline down.
 */
function newTrackCategoryBeyondTracks(clientY: number, draggedCategory: 'visual' | 'audio') {
  const rows = [...(timelineRef.value?.querySelectorAll<HTMLElement>('.track-row[data-track-id]') ?? [])]
  if (!rows.length) return null
  if (draggedCategory === 'visual') return clientY < rows[0]!.getBoundingClientRect().top ? 'visual' : null
  return clientY > rows[rows.length - 1]!.getBoundingClientRect().bottom ? 'audio' : null
}

function commitNewTrackDrop(category: 'visual' | 'audio') {
  if (clipDragState) {
    const draggedCategory = clipDragState.layer.type === 'audio' ? 'audio' : 'visual'
    const compatible = clipDragState.mode === 'move' && draggedCategory === category
    clipDragState.targetTrackId = null
    clipDragState.newTrackCategory = compatible ? category : null
    clipDragState.dropAllowed = compatible
    clipDragState.moved = true
  }
  endPointerInteraction()
}

function beginKeyframeDrag(event: PointerEvent, layer: EditorLayer, entries: KeyframeEntry[]) {
  if (event.button !== 0 || layer.locked || !entries.length) return
  event.preventDefault()
  event.stopPropagation()
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  selectedLayerId.value = layer.id
  selectedKeyframeId.value = entries[0]?.keyframe.id ?? null
  isScrubbing.value = false
  keyframeDragState = {
    layer,
    entries: entries.map((entry) => ({ ...entry, originalTime: entry.keyframe.time })),
    startX: event.clientX,
    moved: false,
  }
}

async function onPointerMove(event: PointerEvent) {
  updateCutGhost(event)
  const element = timelineRef.value
  if (panState && element) {
    element.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX)
    element.scrollTop = panState.scrollTop - (event.clientY - panState.startY)
    return
  }
  if (layerMarqueeState) {
    updateLayerMarquee(event)
    return
  }
  if (isScrubbing.value) {
    seekAtClientX(event.clientX)
    return
  }
  if (keyframeDragState) {
    const pointerDistance = Math.abs(event.clientX - keyframeDragState.startX)
    if (!keyframeDragState.moved && pointerDistance < 5) return
    keyframeDragState.moved = true
    const rawDelta = ((event.clientX - keyframeDragState.startX) / timelineLaneWidth.value) * viewDuration.value
    const frameDuration = 1 / project.value.frameRate
    const firstEntry = keyframeDragState.entries[0]
    if (!firstEntry) return
    const quantizedFirstTime = snap.value
      ? Math.round((firstEntry.originalTime + rawDelta) / frameDuration) * frameDuration
      : firstEntry.originalTime + rawDelta
    const requestedDelta = quantizedFirstTime - firstEntry.originalTime
    const earliest = Math.min(...keyframeDragState.entries.map((entry) => entry.originalTime))
    const latest = Math.max(...keyframeDragState.entries.map((entry) => entry.originalTime))
    const boundedDelta = Math.max(keyframeDragState.layer.start - earliest, Math.min(keyframeDragState.layer.start + keyframeDragState.layer.duration - latest, requestedDelta))
    keyframeDragState.entries.forEach((entry) => { entry.keyframe.time = entry.originalTime + boundedDelta })
    return
  }
  if (!clipDragState) return
  const pointerDistance = Math.hypot(event.clientX - clipDragState.startX, event.clientY - clipDragState.startY)
  if (!clipDragState.moved && pointerDistance < 5) return
  if (!clipDragState.moved) {
    clipDragState.moved = true
    draggingClipId.value = clipDragState.layer.id
  }
  const hitElements = document.elementsFromPoint(event.clientX, event.clientY)
  const targetRow = hitElements
    .map((element) => element.closest<HTMLElement>('.track-row'))
    .find(Boolean)
  const targetTrackId = targetRow?.dataset.trackId ?? null
  const targetTrack = timelineTracks.value.find((track) => track.id === targetTrackId)
  const draggedCategory: 'visual' | 'audio' = clipDragState.layer.type === 'audio' ? 'audio' : 'visual'
  const compatibleNewTrack = clipDragState.mode === 'move'
    && newTrackCategoryBeyondTracks(event.clientY, draggedCategory) === draggedCategory

  // Reveal the new-track target before measuring the ghost against it.
  const nextNewTrackCategory = compatibleNewTrack ? draggedCategory : null
  if (newTrackDropCategory.value !== nextNewTrackCategory) {
    newTrackDropCategory.value = nextNewTrackCategory
    await nextTick()
    if (!clipDragState) return
  }
  const newTrackZone = compatibleNewTrack
    ? timelineRef.value?.querySelector<HTMLElement>(`.new-track-zone[data-category="${draggedCategory}"]`) ?? undefined
    : undefined
  const compatibleCategory = Boolean(targetTrack && (targetTrack.segments[0]?.type === 'audio') === (clipDragState.layer.type === 'audio'))
  const deltaTime = ((event.clientX - clipDragState.startX) / timelineLaneWidth.value) * clipDragState.originalViewDuration
  const frameDuration = 1 / project.value.frameRate
  const quantize = (value: number) => snap.value ? Math.round(value / frameDuration) * frameDuration : value
  if (clipDragState.mode === 'move') {
    const nextStart = quantize(Math.max(0, clipDragState.originalStart + deltaTime))
    const appliedDelta = nextStart - clipDragState.originalStart
    clipDragState.layer.start = nextStart
    if (!activeClusterId.value) project.value.duration = Math.max(project.value.duration, nextStart + clipDragState.layer.duration)
    propertyTracks.forEach(({ key }) => {
      clipDragState?.layer.transform[key].keyframes.forEach((keyframe) => {
        keyframe.time = (clipDragState?.keyframeTimes.get(keyframe.id) ?? keyframe.time) + appliedDelta
      })
    })
    descendantLayers(clipDragState.layer).forEach((child) => {
      child.start = (clipDragState?.childStarts.get(child.id) ?? child.start) + appliedDelta
      propertyTracks.forEach(({ key }) => child.transform[key].keyframes.forEach((keyframe) => {
        keyframe.time = (clipDragState?.childKeyframeTimes.get(keyframe.id) ?? keyframe.time) + appliedDelta
      }))
    })
  } else if (clipDragState.mode === 'trim-start') {
    const maximumStart = clipDragState.originalStart + clipDragState.originalDuration - frameDuration
    const nextStart = quantize(Math.max(0, Math.min(maximumStart, clipDragState.originalStart + deltaTime)))
    clipDragState.layer.start = nextStart
    clipDragState.layer.duration = clipDragState.originalDuration + clipDragState.originalStart - nextStart
  } else {
    clipDragState.layer.duration = quantize(Math.max(frameDuration, clipDragState.originalDuration + deltaTime))
    if (!activeClusterId.value) project.value.duration = Math.max(project.value.duration, clipDragState.originalStart + clipDragState.layer.duration)
  }
  const collision = Boolean(targetTrack && compatibleCategory && targetTrack.segments.some((segment) => {
    if (segment.id === clipDragState?.layer.id || segment.isPlaceholder) return false
    const frame = 1 / project.value.frameRate
    return clipDragState!.layer.start < segment.start + segment.duration - frame / 2
      && clipDragState!.layer.start + clipDragState!.layer.duration > segment.start + frame / 2
  }))
  const allowedTrackDrop = Boolean(targetTrack && compatibleCategory && !collision && clipDragState.mode === 'move')
  const sameTrack = targetTrack?.id === clipDragState.originalTrackId
  clipDragState.targetTrackId = allowedTrackDrop && !sameTrack ? targetTrack!.id : null
  clipDragState.newTrackCategory = compatibleNewTrack ? draggedCategory : null
  clipDragState.dropAllowed = compatibleNewTrack || (Boolean(targetTrack) && compatibleCategory && !collision && (clipDragState.mode === 'move' || sameTrack))
  clipDropTrackId.value = allowedTrackDrop && !sameTrack ? targetTrack!.id : null
  clipInvalidTrackId.value = targetTrack && (!compatibleCategory || collision) ? targetTrack.id : null
  const sourceRow = timelineRef.value?.querySelector<HTMLElement>(`.track-row[data-track-id="${clipDragState.originalTrackId}"]`)
  const ghostRow = newTrackZone ?? targetRow ?? sourceRow
  updateClipDragGhost(clipDragState.layer, ghostRow, clipDragState.dropAllowed, !clipDragState.dropAllowed)
}

function endPointerInteraction() {
  if (layerMarqueeState) {
    if (!layerMarqueeState.moved) seekAtClientX(layerMarqueeState.lastClientX)
    layerMarqueeState = null
    layerMarqueeRect.value = null
  }
  if (clipDragState?.moved) {
    if (!clipDragState.dropAllowed) {
      clipDragState.layer.start = clipDragState.originalStart
      clipDragState.layer.duration = clipDragState.originalDuration
      project.value.duration = clipDragState.originalProjectDuration
      propertyTracks.forEach(({ key }) => clipDragState?.layer.transform[key].keyframes.forEach((keyframe) => {
        keyframe.time = clipDragState?.keyframeTimes.get(keyframe.id) ?? keyframe.time
      }))
      descendantLayers(clipDragState.layer).forEach((child) => {
        child.start = clipDragState?.childStarts.get(child.id) ?? child.start
        propertyTracks.forEach(({ key }) => child.transform[key].keyframes.forEach((keyframe) => {
          keyframe.time = clipDragState?.childKeyframeTimes.get(keyframe.id) ?? keyframe.time
        }))
      })
    } else {
      // A child dragged past the end of the cluster grows the cluster, not the project.
      store.fitClusterToChildren(activeClusterId.value)
      const movedToTrack = clipDragState.newTrackCategory
        ? store.moveSegmentToNewTrack(clipDragState.layer.id, clipDragState.newTrackCategory)
        : clipDragState.targetTrackId
          ? store.moveSegmentToTrack(clipDragState.layer.id, clipDragState.targetTrackId)
          : false
      if (!movedToTrack) store.markChanged()
    }
  }
  if (keyframeDragState?.moved) {
    const affectedProperties = new Set(keyframeDragState.entries.map((entry) => entry.property))
    affectedProperties.forEach((property) => keyframeDragState?.layer.transform[property].keyframes.sort((left, right) => left.time - right.time))
    store.markChanged()
  }
  clipDragState = null
  clipDropTrackId.value = null
  clipInvalidTrackId.value = null
  newTrackDropCategory.value = null
  draggingClipId.value = null
  clipDragGhost.value.visible = false
  keyframeDragState = null
  panState = null
  isPanning.value = false
  isScrubbing.value = false
}

/** Deleting is not undoable yet, so it always goes through the same confirmation the track menu uses. */
function requestDeleteLayers(layerIds: string[]) {
  const targets = timelineTracks.value.flatMap((track) => track.segments).filter((layer) => layerIds.includes(layer.id) && !layer.isPlaceholder)
  if (!targets.length) return
  trackDialog.value = {
    mode: 'delete',
    scope: 'clips',
    layerIds: targets.map((layer) => layer.id),
    name: targets.length === 1 ? targets[0]!.name : `${targets.length} clips`,
    clipCount: targets.length,
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    // Nodes has its own Delete, and a field being typed into owns the key outright.
    const target = event.target as Element | null
    if (workspace.value !== 'Motion' || target?.closest('input, textarea, select, [contenteditable="true"]')) return
    if (trackDialog.value || !selectedLayerIds.value.length) return
    event.preventDefault()
    requestDeleteLayers(selectedLayerIds.value)
    return
  }
  if (event.key === 'Escape') {
    addLayerMenuOpen.value = false
    trackContextMenu.value = null
    if (isCutMode.value) {
      isCutMode.value = false
      cutGhost.value.visible = false
    }
  }
}

function onWindowPointerDown(event: PointerEvent) {
  if (!(event.target as Element | null)?.closest('.add-layer-control')) addLayerMenuOpen.value = false
  if (!(event.target as Element | null)?.closest('.timeline-context-menu')) trackContextMenu.value = null
}

async function setZoom(nextZoom: number, anchorClientX?: number) {
  const element = timelineRef.value
  const previousLaneWidth = timelineLaneWidth.value
  const clamped = Math.max(100, Math.min(800, Math.round(nextZoom)))
  if (!element || clamped === timelineZoom.value) return
  const rect = element.getBoundingClientRect()
  const localX = anchorClientX === undefined ? Math.max(220, rect.width / 2) : anchorClientX - rect.left
  const contentX = element.scrollLeft + localX
  const timeRatio = Math.max(0, (contentX - 220) / previousLaneWidth)
  timelineZoom.value = clamped
  await nextTick()
  const nextContentX = 220 + timeRatio * timelineLaneWidth.value
  element.scrollLeft = Math.max(0, nextContentX - localX)
}

function onWheel(event: WheelEvent) {
  if (!event.ctrlKey) return
  event.preventDefault()
  const direction = event.deltaY < 0 ? 1 : -1
  void setZoom(timelineZoom.value + direction * Math.max(5, Math.round(timelineZoom.value * .1)), event.clientX)
}

function onZoomSlider(event: Event) {
  void setZoom(Number((event.target as HTMLInputElement).value))
}

function onDurationChange(value: number) {
  store.setProjectDuration(value)
}

/** Where a library drag would land, and how wide the clip would be, in seconds. */
const assetDrop = ref<{ trackId: string | null; time: number; duration: number; insertTop: number | null } | null>(null)

const draggingAsset = computed(() => (draggingAssetId.value
  ? store.assets.find((asset) => asset.id === draggingAssetId.value) ?? null
  : null))

const assetGhostStyle = computed(() => {
  const drop = assetDrop.value
  if (!drop) return { display: 'none' }
  return {
    left: `${(drop.time / project.value.duration) * timelineLaneWidth.value}px`,
    width: `${Math.max(6, (drop.duration / project.value.duration) * timelineLaneWidth.value)}px`,
  }
})

function trackAcceptsAsset(track: TimelineTrack, time: number, duration: number, kind: string) {
  const isAudioTrack = track.segments[0]?.type === 'audio'
  if (isAudioTrack !== (kind === 'audio')) return false
  return !track.segments.some((segment) => !segment.isPlaceholder
    && time < segment.start + segment.duration && segment.start < time + duration)
}

/**
 * Previews a library drag: the clip is shown where it would land, on the track it would join, or in
 * a phantom row of its own when it would make a new one. Dropping blind and finding out afterwards
 * is the part that felt wrong.
 */
function updateAssetDrop(event: DragEvent) {
  const asset = draggingAsset.value
  if (!asset) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'

  const bounds = timelineRef.value?.getBoundingClientRect()
  const overLane = bounds ? event.clientX - bounds.left + (timelineRef.value?.scrollLeft ?? 0) > 220 : false
  const time = overLane ? timeAtClientX(event.clientX) : currentTime.value
  const kind = asset.kind === 'composition' ? 'image' : asset.kind
  const duration = Math.min(asset.duration ?? 6, Math.max(1 / project.value.frameRate, project.value.duration - time))

  /*
   * The target is found by geometry rather than from the event's target element. Reading the element
   * under the pointer sounds equivalent, but the preview is drawn into that same layout: a phantom
   * row inserted in the flow moves every row below it, which changes what the pointer is over, which
   * removes the phantom, which moves them back. Measuring rows instead breaks that loop, and the
   * preview below is an overlay so it cannot displace anything either.
   */
  const container = tracksScroll.value
  const rows = [...(container?.querySelectorAll<HTMLElement>('.track-row[data-track-id]') ?? [])]
  const hovered = rows.find((row) => {
    const rect = row.getBoundingClientRect()
    return event.clientY >= rect.top && event.clientY <= rect.bottom
  })
  const track = hovered?.dataset.trackId
    ? timelineTracks.value.find((item) => item.id === hovered.dataset.trackId) ?? null
    : null
  const joins = Boolean(track && trackAcceptsAsset(track, time, duration, kind))

  // Where the new track would appear, as an offset inside the scroller, when the drop cannot join one.
  let insertTop: number | null = null
  if (!joins && container) {
    const box = container.getBoundingClientRect()
    const anchor = kind === 'audio' ? rows.at(-1) : rows[0]
    const rect = anchor?.getBoundingClientRect()
    insertTop = rect ? (kind === 'audio' ? rect.bottom : rect.top) - box.top : 0
  }
  assetDrop.value = { trackId: joins ? track!.id : null, time, duration, insertTop }
}

/**
 * dragleave fires for every child the pointer crosses, so it cannot be trusted on its own — the
 * preview would flicker off each time the drag passed between two clips. The pointer has only really
 * left once it is outside the timeline's own rectangle.
 */
function onTimelineDragLeave(event: DragEvent) {
  const bounds = timelineRef.value?.getBoundingClientRect()
  if (!bounds) return clearAssetDrop()
  const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
    && event.clientY >= bounds.top && event.clientY <= bounds.bottom
  if (!inside) clearAssetDrop()
}

function clearAssetDrop() {
  assetDrop.value = null
}

/** A drag cancelled with Escape or released outside the window still has to clear the preview. */
function onDragEnd() {
  clearAssetDrop()
  draggingAssetId.value = null
}

function dropAsset(event: DragEvent) {
  const assetId = event.dataTransfer?.getData('application/x-aurora-asset') || draggingAssetId.value
  const drop = assetDrop.value
  clearAssetDrop()
  draggingAssetId.value = null
  if (!assetId) return
  // Land the clip where it was released rather than at the playhead.
  const overLane = event.clientX - (timelineRef.value?.getBoundingClientRect().left ?? 0) + (timelineRef.value?.scrollLeft ?? 0) > 220
  store.addAssetToTimeline(assetId, drop?.time ?? (overLane ? timeAtClientX(event.clientX) : undefined), drop?.trackId ?? null)
}

function observeTimeline() {
  resizeObserver?.disconnect()
  const element = timelineRef.value
  if (!element) return
  const measuredWidth = element.getBoundingClientRect().width
  if (measuredWidth > 300) timelineViewportWidth.value = measuredWidth
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width > 300) timelineViewportWidth.value = entry.contentRect.width
  })
  resizeObserver.observe(element)
}

watch(activeBottomTab, async (tab) => {
  if (tab !== 'Timeline') return
  if (timelineZoom.value < 100) timelineZoom.value = 100
  await nextTick()
  observeTimeline()
})

watch(selectedLayerId, (id) => {
  // Clearing the selection elsewhere — clicking empty composition, say — clears the clips too.
  if (!id) {
    selectedLayerIds.value = []
    selectedTrackIds.value = []
    return
  }
  if (!selectedLayerIds.value.includes(id)) {
    selectedLayerIds.value = [id]
    selectionAnchorId.value = id
  }
})

watch(timelineLayers, (nextLayers) => {
  const available = new Set(nextLayers.filter((layer) => !layer.isPlaceholder).map((layer) => layer.id))
  selectedLayerIds.value = selectedLayerIds.value.filter((id) => available.has(id))
}, { deep: false })

onMounted(() => {
  observeTimeline()
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endPointerInteraction)
  // Capture phase: clips, grips and the playhead all stop pointerdown from bubbling, so a bubble-phase
  // listener never sees a click that lands on one and the menu would sit there open.
  window.addEventListener('pointerdown', onWindowPointerDown, true)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('dragend', onDragEnd)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endPointerInteraction)
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('dragend', onDragEnd)
})
</script>

<template>
  <section class="timeline-panel">
    <div class="timeline-tabbar">
      <button v-for="tab in tabs" :key="tab" type="button" :class="{ active: activeBottomTab === tab }" @click="activeBottomTab = tab">{{ tab }}</button>
      <span class="tab-spacer" />
      <span class="timeline-status"><span class="status-led" /> Main Composition</span>
      <IconButton :icon="Plus" label="Open panel" />
    </div>

    <template v-if="activeBottomTab === 'Timeline'">
      <div class="context-tabs" role="tablist" aria-label="Timeline contexts">
        <button type="button" role="tab" :class="{ active: !activeClusterId }" :aria-selected="!activeClusterId" title="Project timeline" @click="store.activateTimelineTab(null)"><Film :size="10" /> Main</button>
        <button v-for="tab in clusterTabs" :key="tab.id" type="button" role="tab" class="cluster-tab" :class="{ active: activeClusterId === tab.id }" :aria-selected="activeClusterId === tab.id" :title="`Editing inside ${tab.name}`" @click="store.activateTimelineTab(tab.id)">
          <SquareStack :size="10" /> {{ tab.name }}
          <span class="close-tab" role="button" :aria-label="`Close ${tab.name}`" @click.stop="store.closeClusterTab(tab.id)"><X :size="9" /></span>
        </button>
        <span class="context-hint">Double-click a cluster to edit inside it</span>
      </div>
      <div class="timeline-toolbar">
        <IconButton :icon="MousePointer2" label="Selection tool (V)" active />
        <div class="add-layer-control">
          <button ref="addLayerTrigger" class="toggle-control add-layer-trigger" type="button" :class="{ active: addLayerMenuOpen }" aria-haspopup="menu" :aria-expanded="addLayerMenuOpen" @click.stop="toggleAddLayerMenu"><Plus :size="12" /> Add Layer <ChevronDown :size="10" /></button>
          <Teleport to="body">
          <div v-if="addLayerMenuOpen" class="add-layer-menu" role="menu" :style="addLayerMenuStyle">
            <template v-for="group in ['Effects', 'Generated', 'Media'] as const" :key="group">
              <div class="add-layer-group">{{ group }}</div>
              <button v-for="preset in layerPresets.filter((item) => item.group === group)" :key="preset.kind" type="button" role="menuitem" @click="addLayer(preset.kind)">
                <component :is="preset.icon" :size="14" />
                <span><strong>{{ preset.label }}</strong><small>{{ preset.detail }}</small></span>
              </button>
            </template>
          </div>
          </Teleport>
        </div>
        <IconButton class="razor-tool" :icon="Scissors" label="Razor tool — click clips to split (Esc to exit)" :active="isCutMode" @click="toggleCutMode" />
        <IconButton :icon="SquareStack" :label="selectedLayer?.type === 'cluster' ? 'Release cluster' : 'Cluster selected clips (Ctrl/Shift-click or drag a selection box)'" :active="selectedLayer?.type === 'cluster'" :disabled="selectedLayer?.type !== 'cluster' && clusterableSelectionCount < 2" @click="toggleCluster" />
        <IconButton :icon="FolderPlus" label="New empty cluster — opens it as a tab to build inside" @click="store.createEmptyCluster()" />
        <span v-if="selectedLayerIds.length > 1" class="selection-count">{{ selectedLayerIds.length }} selected</span>
        <span class="divider" />
        <button class="toggle-control" type="button" :class="{ active: autoKey }" @click="autoKey = !autoKey"><CircleDot :size="12" /> Auto Key</button>
        <button class="toggle-control" type="button" :class="{ active: snap }" @click="snap = !snap"><Magnet :size="12" /> Snap</button>
        <button class="toggle-control" type="button" :class="{ active: ripple }" @click="ripple = !ripple"><Link2 :size="12" /> Ripple</button>
        <span class="divider" />
        <button class="timecode-button" type="button">00:00:{{ String(Math.floor(currentTime)).padStart(2, '0') }}:{{ String(Math.floor(currentTime % 1 * project.frameRate)).padStart(2, '0') }}</button>
        <label class="duration-control" title="Composition duration in seconds"><span>Duration</span><NumberField :model-value="project.duration" :min="1" :max="86400" :step=".5" label="Composition duration" @update:model-value="onDurationChange" /><small>s</small></label>
        <span class="toolbar-spacer" />
        <IconButton :icon="Search" label="Search layers" />
        <IconButton :icon="Minus" label="Zoom out timeline" @click="setZoom(timelineZoom - 10)" />
        <input :value="timelineZoom" class="zoom-slider" type="range" min="100" max="800" step="5" aria-label="Timeline zoom" @input="onZoomSlider" />
        <IconButton :icon="Plus" label="Zoom in timeline" @click="setZoom(timelineZoom + 10)" />
        <span class="zoom-value">{{ timelineZoom }}%</span>
      </div>

      <div
        ref="timelineRef"
        class="timeline-main"
        :class="{ panning: isPanning, scrubbing: isScrubbing, 'razor-mode': isCutMode }"
        @pointerdown="onTimelinePointerDown"
        @auxclick.prevent
        @wheel="onWheel"
        @dragover="updateAssetDrop"
        @dragleave="onTimelineDragLeave"
        @drop.prevent="dropAsset"
      >
        <div class="timeline-content" :style="timelineContentStyle">
        <div class="ruler-row">
          <div class="track-column-heading">
            <span>Layers</span><small>{{ timelineTracks.length }} tracks · {{ timelineLayers.filter((layer) => !layer.isPlaceholder).length }} clips</small>
            <div class="header-icons"><Eye :size="11" /><Lock :size="10" /><Volume2 :size="11" /></div>
          </div>
          <div class="time-ruler" @pointerdown="beginSeek">
            <span v-for="tick in ticks" :key="tick.time" :style="{ left: `${tick.fraction * 100}%` }"><i />{{ tick.label }}</span>
            <div class="work-area"><i /><i /></div>
          </div>
        </div>

        <div ref="tracksScroll" class="tracks-scroll">
          <div v-if="assetDrop && assetDrop.insertTop !== null" class="asset-insert-line" :style="{ top: `${assetDrop.insertTop}px` }"><div class="asset-ghost" :style="assetGhostStyle"><span>{{ draggingAsset?.name }}</span></div></div>
          <template v-for="(track, index) in timelineTracks" :key="track.id">
            <div v-if="index === 0" class="track-section-label"><span>Visual layers</span><button type="button" title="Add empty visual track" aria-label="Add empty visual track" @click.stop="store.addEmptyTrack('visual')"><Plus :size="10" /><span>Add track</span></button><small>{{ visualTrackCount }}</small></div>
            <div v-if="index === 0 && newTrackDropCategory === 'visual'" class="new-track-zone active" data-category="visual" @pointerup.stop="commitNewTrackDrop('visual')"><Plus :size="10" /><span>Drop into new visual layer</span></div>
            <div v-if="index === visualTrackCount" class="track-section-label audio"><span>Audio layers</span><button type="button" title="Add empty audio track" aria-label="Add empty audio track" @click.stop="store.addEmptyTrack('audio')"><Plus :size="10" /><span>Add track</span></button><small>{{ timelineTracks.length - visualTrackCount }}</small></div>
            <div
              class="track-row"
              :class="{
                'asset-drop-target': assetDrop?.trackId === track.id,
                selected: track.segments.some((segment) => segment.id === selectedLayerId),
                'multi-selected': selectedTrackIds.includes(track.id),
                'cut-target': isCutMode && cutGhost.trackId === track.id,
                'clip-drop-target': clipDropTrackId === track.id,
                'clip-invalid-target': clipInvalidTrackId === track.id,
                dragging: draggedTrackId === track.id,
                'drop-before': trackDropTarget?.id === track.id && trackDropTarget.before,
                'drop-after': trackDropTarget?.id === track.id && !trackDropTarget.before,
              }"
              :data-track-id="track.id"
              :data-track-label="trackLabel(track, index)"
              @click="selectTrack(track, $event)"
              @contextmenu="openTrackContextMenu($event, track)"
              @dragover.prevent.stop="updateTrackDrop($event, track)"
              @drop.stop="dropTrack($event, track)"
            >
              <div class="track-header">
                <span class="track-drag-handle" draggable="true" title="Drag vertically to reorder layer" @click.stop @dragstart="beginTrackDrag($event, track)" @dragend="endTrackDrag"><GripVertical :size="10" /></span>
                <button type="button" class="expand" :title="trackDisplayLayer(track).expanded ? 'Collapse properties' : 'Expand properties'" @click.stop="toggleTrackExpanded(track)"><ChevronDown v-if="trackDisplayLayer(track).expanded" :size="11" /><ChevronRight v-else :size="11" /></button>
                <span class="track-index">{{ trackLabel(track, index) }}</span>
                <component :is="layerIcon(trackDisplayLayer(track).type)" :size="12" :style="{ color: trackDisplayLayer(track).color }" />
                <strong :title="trackDisplayLayer(track).name">{{ trackDisplayLayer(track).name }}</strong>
                <small v-if="trackDisplayLayer(track).type === 'cluster'" class="cluster-count">{{ trackDisplayLayer(track).children?.length ?? 0 }} items</small>
                <small v-if="track.segments.length > 1" class="segment-count">{{ track.segments.length }}</small>
                <button type="button" :class="{ off: !trackDisplayLayer(track).visible }" :title="trackDisplayLayer(track).visible ? 'Hide timeline layer' : 'Show timeline layer'" @click="toggleTrackVisible(track, $event)"><Eye v-if="trackDisplayLayer(track).visible" :size="10" /><EyeOff v-else :size="10" /></button>
                <button type="button" :class="{ active: trackDisplayLayer(track).locked }" title="Toggle track lock" @click="toggleTrackLock(track, $event)"><Lock v-if="trackDisplayLayer(track).locked" :size="10" /><Unlock v-else :size="10" /></button>
                <button type="button" :class="{ active: trackDisplayLayer(track).muted }" title="Mute track" @click="toggleTrackMuted(track, $event)"><VolumeX :size="10" /></button>
              </div>
              <div class="track-lane" @pointerdown="beginLayerMarquee">
              <div v-if="assetDrop?.trackId === track.id" class="asset-ghost" :style="assetGhostStyle"><span>{{ draggingAsset?.name }}</span></div>
                <template v-for="segment in track.segments" :key="segment.id">
                <button v-if="!segment.isPlaceholder" class="timeline-clip" :class="[segment.type, { 'selected-clip': selectedLayerIds.includes(segment.id), 'clip-drag-source': draggingClipId === segment.id }]" type="button" :data-layer-id="segment.id" :aria-pressed="selectedLayerIds.includes(segment.id)" :style="clipStyle(segment)" @pointerdown="onClipPointerDown($event, segment)" @click.stop @dblclick.stop="store.enterCluster(segment.id)">
                  <span class="clip-grip left" @pointerdown="beginClipDrag($event, segment, 'trim-start')" />
                  <span v-if="segment.type === 'video'" class="filmstrip"><i v-for="n in 14" :key="n" :style="{ backgroundImage: 'url(/demo/aurora-ridge.png)' }" /></span>
                  <span v-if="segment.type === 'audio'" class="waveform"><i v-for="n in 72" :key="n" :style="{ height: `${6 + ((n * 13) % 18)}px` }" /></span>
                  <span class="clip-label"><component :is="layerIcon(segment.type)" :size="9" />{{ segment.name }}</span>
                  <span v-if="segment.effects.length" class="fx-badge">fx</span>
                  <span v-if="layerKeyframes(segment).length" class="clip-keyframes" aria-label="Animation keyframes">
                    <i
                      v-for="keyframe in layerKeyframes(segment)"
                      :key="keyframe.id"
                      :class="{ stacked: keyframe.channels > 1, selected: keyframe.entries.some((entry) => entry.keyframe.id === selectedKeyframeId), 'at-playhead': isKeyframeAtPlayhead(keyframe.time) }"
                      :style="clipKeyframeStyle(segment, keyframe.time)"
                      :title="`${keyframe.channels} animated ${keyframe.channels === 1 ? 'property' : 'properties'} at ${keyframe.time.toFixed(2)}s`"
                      @pointerdown.stop.prevent="beginKeyframeDrag($event, segment, keyframe.entries)"
                    />
                  </span>
                  <span class="clip-grip right" @pointerdown="beginClipDrag($event, segment, 'trim-end')" />
                </button>
                </template>
              </div>
            </div>

            <template v-if="trackDisplayLayer(track).expanded">
              <div v-for="property in propertyTracks" :key="`${track.id}-${property.key}`" class="property-track" :class="{ animated: trackDisplayLayer(track).transform[property.key].animated }">
                <div class="property-track-header">
                  <span />
                  <Diamond :size="9" :fill="trackDisplayLayer(track).transform[property.key].animated ? 'currentColor' : 'none'" />
                  <strong>{{ property.label }}</strong>
                  <small>{{ trackDisplayLayer(track).transform[property.key].value.toFixed(1) }}{{ property.suffix }}<b v-if="trackDisplayLayer(track).transform[property.key].keyframes.length">{{ trackDisplayLayer(track).transform[property.key].keyframes.length }} keys</b></small>
                </div>
                <div class="property-key-lane" @pointerdown="beginSeek">
                  <button v-for="keyframe in trackDisplayLayer(track).transform[property.key].keyframes" :key="keyframe.id" type="button" :class="{ selected: selectedKeyframeId === keyframe.id, 'at-playhead': isKeyframeAtPlayhead(keyframe.time) }" :style="{ left: `${toFraction(keyframe.time) * 100}%` }" :title="`${property.label}: ${keyframe.value}${property.suffix} at ${keyframe.time.toFixed(2)}s`" @pointerdown.stop.prevent="beginKeyframeDrag($event, trackDisplayLayer(track), [{ property: property.key, keyframe }])"><Diamond :size="10" fill="currentColor" /></button>
                  <span v-if="trackDisplayLayer(track).transform[property.key].keyframes.length > 1" class="key-line" :style="{ left: `${toFraction(trackDisplayLayer(track).transform[property.key].keyframes[0]!.time) * 100}%`, width: `${((trackDisplayLayer(track).transform[property.key].keyframes.at(-1)!.time - trackDisplayLayer(track).transform[property.key].keyframes[0]!.time) / viewDuration) * 100}%` }" />
                  <span v-if="trackDisplayLayer(track).transform[property.key].animated && !trackDisplayLayer(track).transform[property.key].keyframes.length" class="no-keys">Animated · no keys</span>
                </div>
              </div>
            </template>
            <div v-if="index === timelineTracks.length - 1 && newTrackDropCategory === 'audio'" class="new-track-zone audio active" data-category="audio" @pointerup.stop="commitNewTrackDrop('audio')"><Plus :size="10" /><span>Drop into new audio layer</span></div>
          </template>
          <div class="drop-hint"><Plus :size="12" /> Drag media here to add a layer</div>
        </div>
        <div v-if="layerMarqueeRect" class="layer-selection-marquee" :style="{ left: `${layerMarqueeRect.left}px`, top: `${layerMarqueeRect.top}px`, width: `${layerMarqueeRect.width}px`, height: `${layerMarqueeRect.height}px` }" />
        <div class="playhead" :class="{ muted: isCutMode }" :style="playheadStyle"><span title="Drag playhead" @pointerdown="beginSeek" /><i /></div>
        </div>
        <div v-if="clipDragGhost.visible" class="clip-drag-ghost" :class="{ valid: clipDragGhost.valid, invalid: clipDragGhost.invalid }" :style="{ left: `${clipDragGhost.x}px`, top: `${clipDragGhost.y}px`, width: `${clipDragGhost.width}px`, backgroundColor: clipDragGhost.color }"><Move :size="9" /><span>{{ clipDragGhost.label }}</span></div>
        <div v-if="cutGhost.visible" class="razor-ghost" :class="{ valid: cutGhost.overClip, 'over-track': cutGhost.trackId }" :style="{ left: `${cutGhost.x}px`, top: `${cutGhost.y}px`, height: `${cutGhost.height}px`, '--level-y': `${cutGhost.levelY}px` }">
          <span class="razor-cursor-head"><Scissors :size="7" :stroke-width="2" /></span>
          <span class="razor-guide" />
          <span class="razor-horizontal" />
          <span class="razor-crosshair" />
          <small>{{ cutGhost.time.toFixed(2) }}s</small>
        </div>
      </div>
      <Teleport to="body">
        <div v-if="trackContextMenu" class="timeline-context-menu" :style="{ left: `${trackContextMenu.x}px`, top: `${trackContextMenu.y}px` }" role="menu" @contextmenu.prevent>
          <button type="button" role="menuitem" @click="renameContextTrack"><Pencil :size="11" /> Rename</button>
          <button type="button" role="menuitem" @click="toggleContextTrackVisible"><EyeOff v-if="contextTrack()?.segments.every((segment) => segment.visible)" :size="11" /><Eye v-else :size="11" /> {{ contextTrack()?.segments.every((segment) => segment.visible) ? 'Hide' : 'Show' }}</button>
          <span />
          <button v-if="trackContextMenu?.clipId" type="button" class="danger" role="menuitem" @click="deleteContextClips"><Trash2 :size="11" /> {{ contextClipDeleteLabel }}</button>
          <button type="button" class="danger" role="menuitem" @click="deleteContextTrack"><Trash2 :size="11" /> Delete track</button>
        </div>
      </Teleport>
      <MDialog
        :open="Boolean(trackDialog)"
        :title="trackDialog?.mode === 'rename' ? 'Rename timeline layer' : trackDialog?.scope === 'clips' ? 'Delete clips' : 'Delete timeline layer'"
        :description="trackDialogDescription"
        :confirm-label="trackDialog?.mode === 'delete' ? 'Delete' : 'Rename'"
        :danger="trackDialog?.mode === 'delete'"
        :confirm-disabled="trackDialog?.mode === 'rename' && !trackRenameValue.trim()"
        @close="trackDialog = null"
        @confirm="confirmTrackDialog"
      >
        <input v-if="trackDialog?.mode === 'rename'" v-model="trackRenameValue" autofocus aria-label="New layer name" @focus="($event.target as HTMLInputElement).select()" />
        <p v-else class="dialog-warning">This action cannot be undone.</p>
      </MDialog>
    </template>

    <CurveEditor v-else-if="activeBottomTab === 'Graph Editor'" />
    <div v-else class="panel-placeholder"><component :is="activeBottomTab === 'Scopes' ? Gauge : AudioLines" :size="28" /><strong>{{ activeBottomTab }}</strong><span>{{ activeBottomTab === 'Scopes' ? 'Histogram follows the current composition output.' : 'Track and master controls share the same audio graph.' }}</span></div>
  </section>
</template>

<style scoped>
.timeline-panel { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: #101217; }.timeline-tabbar { display: flex; height: 29px; flex: 0 0 auto; align-items: flex-end; gap: 1px; padding: 0 5px; border-bottom: 1px solid var(--border-subtle); background: #13151b; }.timeline-tabbar > button { position: relative; height: 27px; padding: 0 10px; color: var(--text-muted); background: transparent; border: 0; font: inherit; font-size: 10px; cursor: pointer; }.timeline-tabbar > button:hover { color: var(--text-primary); }.timeline-tabbar > button.active { color: var(--text-primary); background: #191c23; }.timeline-tabbar > button.active::after { position: absolute; right: 5px; bottom: -1px; left: 5px; height: 2px; background: var(--accent); content: ''; }.tab-spacer { flex: 1; }.timeline-status { display: flex; height: 28px; align-items: center; gap: 5px; color: var(--text-muted); font-size: 8.5px; }.status-led { width: 5px; height: 5px; border-radius: 50%; background: var(--success); }
:global(.timeline-context-menu) { position: fixed; z-index: 600; display: grid; width: 164px; padding: 4px; background: #171920; border: 1px solid #3b3f4b; border-radius: 4px; box-shadow: 0 10px 26px rgb(0 0 0 / .5); }
:global(.timeline-context-menu > button) { display: flex; height: 26px; align-items: center; gap: 7px; padding: 0 7px; color: #aeb3bf; background: transparent; border: 0; border-radius: 3px; font: inherit; font-size: 9px; text-align: left; cursor: pointer; }
:global(.timeline-context-menu > button:hover) { color: #eef0ff; background: var(--bg-selected); }
:global(.timeline-context-menu > button.danger) { color: #d88991; }
:global(.timeline-context-menu > span) { height: 1px; margin: 3px 2px; background: var(--border-subtle); }
.dialog-warning { margin: 0; color: var(--text-secondary); font-size: 9px; }
.timeline-toolbar { position: relative; z-index: 25; display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 2px; padding: 0 6px; border-bottom: 1px solid var(--border-subtle); }.divider { width: 1px; height: 20px; margin: 0 4px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.toggle-control { display: flex; height: 25px; align-items: center; gap: 4px; padding: 0 6px; color: var(--text-muted); background: transparent; border: 1px solid transparent; border-radius: 4px; font: inherit; font-size: 9px; cursor: pointer; white-space: nowrap; }.toggle-control:hover { color: var(--text-primary); background: var(--bg-hover); }.toggle-control.active { color: #cdd5ff; background: var(--bg-selected); border-color: var(--accent-border); }.timecode-button { height: 24px; padding: 0 8px; color: var(--text-primary); background: #090b0f; border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 9.5px; font-variant-numeric: tabular-nums; }.zoom-slider { width: 72px; height: 2px; accent-color: var(--button-accent); }.zoom-value { width: 34px; color: var(--text-muted); font-size: 8px; text-align: right; }
.context-tabs { display: flex; height: 24px; flex: 0 0 auto; align-items: stretch; gap: 2px; padding: 0 6px; background: #0f1116; border-bottom: 1px solid var(--border-subtle); }.context-tabs > button { display: flex; align-items: center; gap: 4px; padding: 0 8px; color: var(--text-muted); background: transparent; border: 0; border-bottom: 2px solid transparent; font: inherit; font-size: 8.5px; cursor: pointer; white-space: nowrap; }.context-tabs > button:hover { color: var(--text-secondary); }.context-tabs > button.active { color: #dce1ff; border-bottom-color: var(--accent); }.context-tabs .cluster-tab { padding-right: 4px; }.close-tab { display: grid; width: 14px; height: 14px; place-items: center; color: inherit; border-radius: 2px; opacity: .55; }.close-tab:hover { background: rgb(255 255 255 / .1); opacity: 1; }.context-hint { display: flex; align-items: center; margin-left: auto; color: #5b6170; font-size: 7.5px; }
.add-layer-control { position: relative; height: 25px; }.add-layer-trigger { color: #b8c1ee; background: rgb(140 155 255 / .06); border-color: rgb(140 155 255 / .2); }.add-layer-trigger:hover, .add-layer-trigger.active { color: #eef0ff; background: rgb(140 155 255 / .16); border-color: #6370ad; }.add-layer-menu { position: fixed; z-index: 400; width: 224px; overflow-y: auto; overscroll-behavior: contain; padding: 5px; background: #171920; border: 1px solid #3b3f4b; border-radius: 5px; box-shadow: 0 10px 26px rgb(0 0 0 / .48); }.add-layer-group { padding: 6px 7px 3px; color: #686f7e; font-size: 7px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }.add-layer-menu > button { display: grid; width: 100%; min-height: 34px; grid-template-columns: 22px 1fr; align-items: center; padding: 3px 6px; color: #9da5b7; background: transparent; border: 0; border-radius: 3px; font: inherit; text-align: left; cursor: pointer; }.add-layer-menu > button:hover, .add-layer-menu > button:focus-visible { color: #e8ebf6; background: var(--bg-hover); outline: 0; }.add-layer-menu > button svg { color: #8f9ee8; }.add-layer-menu > button span { display: flex; min-width: 0; flex-direction: column; gap: 1px; }.add-layer-menu > button strong { color: inherit; font-size: 9px; font-weight: 560; }.add-layer-menu > button small { color: #6f7685; font-size: 7.5px; }.selection-count { padding: 2px 5px; color: #cbd2ff; background: rgb(140 155 255 / .1); border: 1px solid rgb(165 180 252 / .25); border-radius: 3px; font-size: 7.5px; white-space: nowrap; }
.duration-control { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 5px; color: var(--text-muted); background: #12141a; border: 1px solid var(--border-strong); border-radius: 3px; font-size: 8px; white-space: nowrap; }.duration-control :deep(.number-field) { width: 48px; flex: 0 0 auto; }.duration-control :deep(input) { padding: 0; color: #dce1ec; background: transparent; border: 0; outline: 0; font: inherit; font-size: 8.5px; font-variant-numeric: tabular-nums; text-align: right; }.duration-control small { color: #6f7580; font-size: 7.5px; }
.timeline-toolbar .razor-tool.active { color: #ff8796; background: rgb(255 117 135 / .1); border-color: rgb(255 135 150 / .5); }
.timeline-main { --track-header: 220px; position: relative; min-height: 0; flex: 1; overflow: auto; background: #101217; overscroll-behavior: contain; scrollbar-gutter: stable; }.timeline-main.panning { cursor: grabbing; user-select: none; }.timeline-main.scrubbing { cursor: col-resize; user-select: none; }.timeline-content { position: relative; min-height: 100%; background-image: linear-gradient(90deg, transparent calc(var(--track-header) - 1px), var(--border-strong) var(--track-header), transparent calc(var(--track-header) + 1px)); }.ruler-row { position: sticky; z-index: 12; top: 0; display: grid; width: 100%; height: 25px; grid-template-columns: var(--track-header) 1fr; border-bottom: 1px solid var(--border-subtle); }.track-column-heading { position: sticky; z-index: 14; left: 0; display: flex; align-items: center; gap: 6px; padding: 0 8px; color: var(--text-secondary); background: #15171d; border-right: 1px solid var(--border-strong); box-shadow: 2px 0 4px rgb(0 0 0 / .18); font-size: 9px; font-weight: 600; text-transform: uppercase; }.track-column-heading small { color: var(--text-muted); font-weight: 400; }.header-icons { display: flex; margin-left: auto; gap: 11px; color: var(--text-muted); }.time-ruler { position: relative; cursor: col-resize; background: #111319; }.time-ruler > span { position: absolute; bottom: 4px; color: #777c87; font-size: 7.5px; font-variant-numeric: tabular-nums; transform: translateX(-1px); }.time-ruler > span i { position: absolute; bottom: -4px; left: 0; width: 1px; height: 4px; background: #4b4f58; }.work-area { position: absolute; top: 1px; right: 1%; left: 1%; height: 3px; background: #676f9f; }.work-area i { position: absolute; top: -1px; width: 3px; height: 5px; background: #b1b8e4; }.work-area i:last-child { right: 0; }
.timeline-main.razor-mode, .timeline-main.razor-mode * { cursor: none !important; }.timeline-main.razor-mode .timeline-clip > * { pointer-events: none; }.razor-ghost { --razor-color: #8993a5; position: absolute; z-index: 30; width: 1px; color: var(--razor-color); pointer-events: none; filter: drop-shadow(0 1px 2px #050609); }.razor-ghost.valid { --razor-color: #ff8796; }.razor-cursor-head { position: absolute; z-index: 2; top: 0; left: -7px; display: grid; width: 14px; height: 12px; place-items: center; color: #15171d; background: var(--razor-color); clip-path: polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%); }.razor-cursor-head svg { margin-top: -2px; }.razor-ghost small { position: absolute; z-index: 2; top: calc(var(--level-y) + 7px); left: 8px; padding: 2px 4px; color: #cbd0dc; background: rgb(12 14 19 / .92); border: 1px solid #353a45; border-radius: 3px; font-size: 7.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }.razor-guide { position: absolute; inset: 0; width: 1px; background: var(--razor-color); box-shadow: 0 0 4px var(--razor-color); opacity: .45; }.razor-horizontal { position: absolute; top: var(--level-y); left: -200vw; width: 400vw; height: 1px; background: var(--razor-color); box-shadow: 0 0 3px var(--razor-color); opacity: .28; }.razor-crosshair { position: absolute; top: calc(var(--level-y) - 4px); left: -4px; width: 9px; height: 9px; background: #11141a; border: 1px solid var(--razor-color); box-shadow: 0 0 0 2px rgb(10 12 16 / .65); transform: rotate(45deg); }.razor-ghost.over-track .razor-horizontal { opacity: .72; }.razor-ghost.valid .razor-guide, .razor-ghost.valid .razor-horizontal { opacity: 1; }
.tracks-scroll { min-height: calc(100% - 25px); overflow: visible; }.track-row, .property-track { display: grid; width: 100%; grid-template-columns: var(--track-header) 1fr; }.track-row { height: 31px; border-bottom: 1px solid #20232a; }.track-row.selected { background: rgb(52 60 91 / .22); }.track-header { position: sticky; z-index: 7; left: 0; display: flex; min-width: 0; align-items: center; gap: 5px; padding: 0 4px; background: #14161b; border-right: 1px solid var(--border-strong); box-shadow: 2px 0 4px rgb(0 0 0 / .14); }.track-row.selected .track-header { background: var(--bg-selected); box-shadow: inset 2px 0 var(--accent), 2px 0 4px rgb(0 0 0 / .14); }.track-header button { display: grid; width: 17px; height: 20px; flex: 0 0 auto; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.track-header button:hover { color: var(--text-primary); background: var(--bg-hover); }.track-header button.active { color: var(--keyframe); }.track-header button.off { opacity: .3; }.track-header .expand { width: 13px; }.track-index { width: 18px; color: #626773; font-size: 7.5px; }.track-header strong { min-width: 0; flex: 1; overflow: hidden; color: var(--text-secondary); font-size: 9px; font-weight: 520; text-overflow: ellipsis; white-space: nowrap; }.track-lane { position: relative; overflow: hidden; background-image: linear-gradient(90deg, rgb(255 255 255 / .022) 1px, transparent 1px); background-size: 10% 100%; cursor: default; }
.timeline-clip { position: absolute; top: 3px; height: 25px; min-width: 10px; overflow: hidden; color: #f1f3fa; text-align: left; border: 1px solid rgb(221 226 245 / .16); border-radius: 3px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); cursor: grab; }.timeline-clip:hover { border-color: rgb(226 230 255 / .5); }.track-row.selected .timeline-clip { outline: 1px solid #a5b4fc; outline-offset: 0; }.clip-grip { position: absolute; z-index: 5; top: 0; bottom: 0; width: 4px; background: rgb(245 247 255 / .18); opacity: 0; cursor: ew-resize; }.timeline-clip:hover .clip-grip { opacity: 1; }.clip-grip.left { left: 0; }.clip-grip.right { right: 0; }.clip-label { position: relative; z-index: 2; display: flex; height: 100%; align-items: center; gap: 4px; padding: 0 6px 6px; overflow: hidden; font-size: 8.5px; font-weight: 560; text-shadow: 0 1px 2px rgb(0 0 0 / .6); text-overflow: ellipsis; white-space: nowrap; }.filmstrip { position: absolute; inset: 0; display: flex; opacity: .32; }.filmstrip i { width: 44px; flex: 0 0 44px; background-position: center; background-size: cover; border-right: 1px solid rgb(0 0 0 / .4); }.waveform { position: absolute; inset: 0 4px; display: flex; align-items: center; gap: 1px; opacity: .48; }.waveform i { width: 2px; flex: 0 0 2px; background: #c2e9dc; }.fx-badge { position: absolute; z-index: 4; right: 4px; top: 3px; color: #f0e2c9; font-size: 7px; font-style: italic; }.clip-keyframes { position: absolute; z-index: 6; right: 5px; bottom: 2px; left: 5px; height: 7px; pointer-events: none; }.clip-keyframes i { position: absolute; bottom: 0; width: 7px; height: 7px; background: var(--keyframe); border: 1px solid rgb(46 36 24 / .75); box-shadow: 0 0 0 1px rgb(255 220 159 / .2); transform: translateX(-50%) rotate(45deg); pointer-events: auto; cursor: ew-resize; }.clip-keyframes i:hover { background: #ffd18b; box-shadow: 0 0 0 2px rgb(255 209 139 / .3); }.clip-keyframes i.selected { background: #fff0cf; border-color: #fff; box-shadow: 0 0 0 2px rgb(255 209 139 / .48); }.clip-keyframes i.stacked { width: 8px; height: 8px; background: #f0bd70; box-shadow: 0 0 0 1px #624c2d, 2px -2px 0 rgb(240 189 112 / .55); }.timeline-clip.text { background-image: linear-gradient(90deg, rgb(255 255 255 / .05) 50%, transparent 50%); background-size: 8px 8px; }
.property-track { height: 24px; border-bottom: 1px solid #1d2026; }.property-track.animated { background: rgb(225 173 100 / .025); }.property-track-header { position: sticky; z-index: 7; left: 0; display: grid; grid-template-columns: 36px 15px 1fr auto; align-items: center; padding-right: 8px; color: var(--text-muted); background: #111318; border-right: 1px solid var(--border-strong); box-shadow: 2px 0 4px rgb(0 0 0 / .14); }.property-track.animated .property-track-header { color: #ba9766; }.property-track-header strong { font-size: 8.5px; font-weight: 450; }.property-track.animated .property-track-header strong { color: var(--text-secondary); }.property-track-header small { display: flex; align-items: center; gap: 6px; font-size: 7.5px; }.property-track-header small b { color: var(--keyframe); font-size: 7px; font-weight: 550; white-space: nowrap; }.property-track-header svg { color: #625943; }.property-track.animated .property-track-header svg { color: var(--keyframe); }.property-key-lane { position: relative; background: #0f1116; cursor: col-resize; }.property-key-lane button { position: absolute; z-index: 2; top: 5px; display: grid; width: 14px; height: 14px; place-items: center; padding: 0; color: var(--keyframe); background: rgb(28 23 18 / .72); border: 0; border-radius: 2px; filter: drop-shadow(0 0 2px rgb(225 173 100 / .38)); transform: translateX(-50%); cursor: ew-resize; }.property-key-lane button:hover { color: #ffd18b; background: #30271c; }.property-key-lane button.selected { color: #fff0cf; background: #59462b; outline: 1px solid #f0bd70; }.key-line { position: absolute; top: 12px; height: 1px; background: #9a7748; }.no-keys { position: absolute; top: 7px; left: 6px; color: #6f6251; font-size: 7.5px; }.drop-hint { display: flex; width: calc(100% - var(--track-header)); height: 31px; align-items: center; justify-content: center; gap: 5px; margin-left: var(--track-header); color: #555a65; border-bottom: 1px solid #1f2229; font-size: 8.5px; }
.playhead { position: absolute; z-index: 13; top: 2px; bottom: 0; width: 1px; background: #e4b767; pointer-events: none; transition: background-color 120ms ease, opacity 120ms ease; }.playhead span { position: sticky; top: 0; display: block; margin-left: -6px; width: 13px; height: 11px; background: #e4b767; clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%); pointer-events: auto; cursor: col-resize; transition: background-color 120ms ease; }.playhead i { position: absolute; top: 0; bottom: 0; left: -2px; width: 5px; background: rgb(228 183 103 / .06); }.playhead.muted { background: #686d77; opacity: .48; }.playhead.muted span { background: #858a94; }.playhead.muted i { background: rgb(133 138 148 / .05); }
.layer-selection-marquee { position: absolute; z-index: 22; background: rgb(140 155 255 / .1); border: 1px solid #a5b4fc; box-shadow: 0 0 0 1px rgb(29 34 55 / .45); pointer-events: none; }
.clip-keyframes i, .property-key-lane button { touch-action: none; user-select: none; }.clip-keyframes i.at-playhead { background: #fff7e8; border-color: #fff; box-shadow: 0 0 0 2px rgb(228 183 103 / .62); }.property-key-lane button.at-playhead { color: #fff7e8; background: #654d2d; outline: 1px solid #f4c778; }
.curve-editor { position: relative; flex: 1; overflow: hidden; background: #0e1015; }.curve-grid { position: absolute; inset: 0 0 27px 0; background-image: linear-gradient(rgb(255 255 255 / .045) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .045) 1px, transparent 1px); background-size: 12.5% 20%; }.curve-grid > span, .curve-grid > i { position: absolute; background: #282c35; }.curve { position: absolute; height: 2px; border-radius: 50%; transform-origin: left; }.curve-a { top: 64%; left: 8%; width: 42%; background: #9caaff; transform: rotate(-17deg); box-shadow: 90px -24px 0 #9caaff; }.curve-b { top: 32%; left: 50%; width: 38%; background: #d5a66b; transform: rotate(12deg); }.curve-key { position: absolute; display: grid; padding: 0; color: var(--keyframe); background: transparent; border: 0; }.k1 { top: 62%; left: 8%; }.k2 { top: 27%; left: 50%; }.k3 { top: 44%; left: 88%; }.curve-toolbar { position: absolute; right: 0; bottom: 0; left: 0; display: flex; height: 27px; align-items: center; gap: 4px; padding: 0 7px; color: var(--text-muted); background: #15171d; border-top: 1px solid var(--border-subtle); font-size: 8.5px; }.curve-toolbar span { margin-right: auto; color: var(--text-secondary); }.curve-toolbar button { height: 20px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 8px; }
.panel-placeholder { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 7px; color: var(--text-muted); }.panel-placeholder svg { color: var(--accent); }.panel-placeholder strong { color: var(--text-primary); font-size: 11px; }.panel-placeholder span { font-size: 9px; }
.segment-count { min-width: 14px; padding: 1px 3px; color: #9ca6d9; background: rgb(140 155 255 / .09); border: 1px solid rgb(165 180 252 / .24); border-radius: 3px; font-size: 7px; text-align: center; }.track-row.selected .timeline-clip { outline: none; }.timeline-clip:hover { z-index: 2; }.timeline-clip.selected-clip { z-index: 3; outline: 1px solid #a5b4fc !important; outline-offset: 0; }.track-row.cut-target { outline: 1px solid rgb(255 135 150 / .36); outline-offset: -1px; }.track-row.cut-target .track-header { color: #e5e7ef; background: rgb(255 135 150 / .08); box-shadow: inset 3px 0 #ff8796, 2px 0 4px rgb(0 0 0 / .14); }.track-row.cut-target .track-lane { background-color: rgb(255 135 150 / .075); }
.track-section-label { position: relative; display: flex; height: 23px; align-items: center; gap: 7px; padding: 0 8px; color: #808797; background: #0d0f14; border-bottom: 1px solid #292d35; font-size: 7.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }.track-section-label::after { order: 2; height: 1px; flex: 1; background: #262a32; content: ''; }.track-section-label small { order: 3; color: #5f6673; font-size: 7px; }.track-section-label > button { display: flex; height: 17px; order: 1; flex: 0 0 auto; align-items: center; gap: 3px; padding: 0 5px; color: #aeb7e4; background: rgb(140 155 255 / .07); border: 1px solid #414963; border-radius: 3px; font: inherit; font-size: 7px; letter-spacing: 0; text-transform: none; cursor: pointer; white-space: nowrap; }.track-section-label > button:hover { color: #f0f2ff; background: rgb(140 155 255 / .17); border-color: #7180cb; }.track-section-label.audio { color: #75a792; border-top: 1px solid #33433d; }.track-section-label.audio > button { color: #91bca9; background: rgb(92 155 130 / .07); border-color: #385248; }.track-section-label.audio > button:hover { color: #d5f0e5; background: rgb(92 155 130 / .17); border-color: #5c9b82; }
.new-track-zone { position: relative; display: flex; height: 27px; align-items: center; justify-content: center; gap: 5px; color: #7782b9; background: rgb(140 155 255 / .035); border: 1px dashed rgb(140 155 255 / .28); border-width: 1px 0; font-size: 8px; transition: background-color 90ms ease, color 90ms ease; }.new-track-zone::before { position: absolute; top: 0; bottom: 0; left: 219px; width: 1px; background: #343947; content: ''; }.new-track-zone.active { color: #dce1ff; background: rgb(140 155 255 / .13); border-color: #8c9bff; box-shadow: inset 3px 0 #8c9bff; }.new-track-zone.audio { color: #6f9987; background: rgb(92 155 130 / .035); border-color: rgb(92 155 130 / .28); }.new-track-zone.audio.active { color: #c6ebdc; background: rgb(92 155 130 / .13); border-color: #5c9b82; box-shadow: inset 3px 0 #5c9b82; }.new-track-zone.incompatible { color: #8e5d64; background: rgb(255 117 135 / .035); border-color: rgb(255 117 135 / .2); }
.track-drag-handle { display: grid; width: 10px; height: 20px; flex: 0 0 10px; place-items: center; color: #555b67; cursor: grab; }.track-drag-handle:hover { color: #aeb6d9; }.track-drag-handle:active { cursor: grabbing; }.track-row.dragging { opacity: .38; }.track-row.drop-before::before, .track-row.drop-after::after { position: absolute; z-index: 20; right: 0; left: 0; height: 2px; background: #8c9bff; box-shadow: 0 0 5px rgb(140 155 255 / .65); content: ''; }.track-row { position: relative; }.track-row.drop-before::before { top: -1px; }.track-row.drop-after::after { bottom: -1px; }
.track-row.clip-drop-target { outline: 1px solid #8c9bff; outline-offset: -1px; }.track-row.clip-drop-target .track-header { background: rgb(140 155 255 / .12); box-shadow: inset 3px 0 #8c9bff, 2px 0 4px rgb(0 0 0 / .14); }.track-row.clip-drop-target .track-lane { background-color: rgb(140 155 255 / .08); }
.track-row.clip-invalid-target { outline: 1px solid rgb(255 135 150 / .72); outline-offset: -1px; }.track-row.clip-invalid-target .track-header { background: rgb(255 117 135 / .1); box-shadow: inset 3px 0 #ff8796, 2px 0 4px rgb(0 0 0 / .14); }.track-row.clip-invalid-target .track-lane { background-color: rgb(255 117 135 / .085); }
.timeline-clip.clip-drag-source { opacity: .16; }.clip-drag-ghost { position: absolute; z-index: 28; display: flex; height: 25px; min-width: 10px; align-items: center; gap: 4px; padding: 0 6px; overflow: hidden; color: #f4f6ff; border: 1px dashed rgb(218 224 255 / .72); border-radius: 3px; box-shadow: 0 5px 14px rgb(0 0 0 / .42); opacity: .72; pointer-events: none; }.clip-drag-ghost.valid { border-style: solid; border-color: #b5c0ff; box-shadow: 0 0 0 1px rgb(140 155 255 / .35), 0 5px 14px rgb(0 0 0 / .42); opacity: .92; }.clip-drag-ghost.invalid { background: #7f3540 !important; border-color: #ff8796; box-shadow: 0 0 0 1px rgb(255 117 135 / .32), 0 5px 14px rgb(0 0 0 / .42); opacity: .9; }.clip-drag-ghost span { min-width: 0; overflow: hidden; font-size: 8px; font-weight: 560; text-overflow: ellipsis; text-shadow: 0 1px 2px #090a0e; white-space: nowrap; }
.razor-cursor-head { left: -5px; width: 10px; height: 9px; }.razor-guide { box-shadow: none; opacity: .3; }.razor-horizontal { box-shadow: none; }.razor-crosshair { top: calc(var(--level-y) - 2px); left: -2px; width: 5px; height: 5px; box-shadow: none; }.razor-ghost small { left: 6px; padding: 1px 3px; font-size: 7px; }
.track-row.multi-selected .track-header { outline: 1px solid rgb(165 180 252 / .42); outline-offset: -1px; }.cluster-count { padding: 1px 4px; color: #c3cafd; background: rgb(127 143 226 / .13); border: 1px solid rgb(165 180 252 / .3); border-radius: 3px; font-size: 7px; white-space: nowrap; }.timeline-clip.cluster { background-image: repeating-linear-gradient(135deg, rgb(255 255 255 / .08) 0 4px, transparent 4px 8px); }
.tracks-scroll { position: relative; }
/* An overlay, never in the flow: a preview that displaced the rows would change what the pointer is over. */
.asset-insert-line { position: absolute; z-index: 8; right: 0; left: 220px; height: 0; border-top: 2px solid #a5b4fc; pointer-events: none; }
.asset-insert-line .asset-ghost { top: -13px; height: 26px; bottom: auto; }
.asset-ghost { position: absolute; top: 3px; bottom: 3px; z-index: 6; display: flex; align-items: center; overflow: hidden; padding: 0 5px; background: rgb(140 155 255 / .3); border: 1px solid #a5b4fc; border-radius: 3px; pointer-events: none; }
.asset-ghost span { overflow: hidden; color: #eef1ff; font-size: 7.5px; text-overflow: ellipsis; white-space: nowrap; }
.track-row.asset-drop-target { background: rgb(140 155 255 / .08); box-shadow: inset 0 0 0 1px var(--accent-border); }
</style>
