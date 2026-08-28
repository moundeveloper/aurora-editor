<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Activity, ChevronDown, Focus, Move, Spline, TimerReset, ZoomIn, ZoomOut } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { influenceParameters } from '@/engine/scene3d/influences'
import { rigBoneChannels } from '@/engine/rig/rigFactory'
import type { AnimatableProperty, EditorLayer, Keyframe } from '@/models/editor'

type TransformKey = keyof EditorLayer['transform']
type GraphMode = 'value' | 'speed'

interface ChannelOption { key: string; label: string; color: string; suffix: string; property: AnimatableProperty<number> }
interface GraphPoint { keyframe: Keyframe<number>; x: number; y: number; value: number }
interface GraphDragState {
  type: 'key' | 'in' | 'out'
  keyframe: Keyframe<number>
  property: AnimatableProperty<number>
  moved: boolean
  startX: number
  startY: number
  originals: Array<{ keyframe: Keyframe<number>; time: number; value: number }>
  minDeltaTime: number
  maxDeltaTime: number
}
interface GraphPanState { startX: number; startY: number; originX: number; originY: number }
interface MarqueeState { startX: number; startY: number; baseSelection: string[]; moved: boolean }

const props = withDefaults(defineProps<{ mode?: 'motion' | '3d' }>(), { mode: 'motion' })
const store = useEditorStore()
const { project, selectedLayer, selectedSceneEntity, selectedKeyframeId, snap, rigs } = storeToRefs(store)
const graphRef = ref<HTMLElement>()
const graphSize = ref({ width: 900, height: 220 })
const activeProperty = ref('')
const graphMode = ref<GraphMode>('value')
const showPropertyMenu = ref(false)
const graphPan = ref({ x: 0, y: 0 })
const graphZoom = ref({ x: 1, y: 1 })
const isPanning = ref(false)
const selectedKeyframeIds = ref<string[]>([])
const marqueeRect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
let resizeObserver: ResizeObserver | null = null
let dragState: GraphDragState | null = null
let panState: GraphPanState | null = null
let marqueeState: MarqueeState | null = null

const motionChannelDefinitions = [
  { key: 'x' as TransformKey, label: 'Position X', color: '#7fa7e7', suffix: 'px' },
  { key: 'y' as TransformKey, label: 'Position Y', color: '#d59a68', suffix: 'px' },
  { key: 'scaleX' as TransformKey, label: 'Scale X', color: '#9a91e8', suffix: '%' },
  { key: 'scaleY' as TransformKey, label: 'Scale Y', color: '#7f9fe4', suffix: '%' },
  { key: 'rotation' as TransformKey, label: 'Rotation', color: '#d37e8c', suffix: '°' },
  { key: 'opacity' as TransformKey, label: 'Opacity', color: '#70b596', suffix: '%' },
]

/** Every bone's pose channels, so a rigged image can be tuned in the graph like any other curve. */
function rigChannels(rigId: string | undefined): ChannelOption[] {
  const rig = rigs.value.find((item) => item.id === rigId)
  if (!rig) return []
  return rig.bones.flatMap((bone) => rigBoneChannels(bone).map((channel) => ({
    key: channel.property.id,
    label: `${bone.name} · ${channel.label}`,
    color: '#c79ae0',
    suffix: channel.suffix,
    property: channel.property,
  })))
}

const channelDefinitions = computed<ChannelOption[]>(() => {
  if (props.mode === 'motion') {
    const transform = selectedLayer.value?.transform
    if (!transform) return []
    return [
      ...motionChannelDefinitions.map((definition) => ({ ...definition, key: transform[definition.key].id, property: transform[definition.key] })),
      ...rigChannels(selectedLayer.value?.rigId),
    ]
  }
  const selected = selectedSceneEntity.value
  if (!selected) return []
  const colors = { x: '#df7886', y: '#6bb88f', z: '#7998e4' }
  const rows: ChannelOption[] = []
  ;(['position', 'rotation', 'scale'] as const).forEach((group) => {
    ;(['x', 'y', 'z'] as const).forEach((axis) => {
      const property = selected.value.transform[group][axis]
      rows.push({ key: property.id, label: `${group[0]!.toUpperCase()}${group.slice(1)} ${axis.toUpperCase()}`, color: colors[axis], suffix: group === 'rotation' ? '°' : '', property })
    })
  })
  if (selected.kind === 'object') {
    ;(['metalness', 'roughness', 'opacity', 'emissiveIntensity'] as const).forEach((key) => {
      const property = selected.value.material[key]
      rows.push({ key: property.id, label: key === 'emissiveIntensity' ? 'Emissive intensity' : `${key[0]!.toUpperCase()}${key.slice(1)}`, color: '#b69bd7', suffix: '', property })
    })
    ;(selected.value.influences ?? []).forEach((influence) => influenceParameters(influence).forEach((parameter) => rows.push({
      key: parameter.property.id, label: `${influence.name} · ${parameter.definition.label}`, color: influence.enabled ? '#8fd3b6' : '#5d6470', suffix: parameter.definition.suffix ?? '', property: parameter.property,
    })))
    rows.push(...rigChannels(selected.value.rigId))
  } else if (selected.kind === 'camera') {
    rows.push({ key: selected.value.fov.id, label: 'Field of view', color: '#8ca9e8', suffix: '°', property: selected.value.fov })
    const constraint = selected.value.pathConstraint
    if (constraint) {
      rows.push({ key: constraint.progress.id, label: 'Path progress', color: '#7ee0c0', suffix: '', property: constraint.progress })
      rows.push({ key: constraint.bank.id, label: 'Path bank', color: '#7ee0c0', suffix: '°', property: constraint.bank })
      ;(['x', 'y', 'z'] as const).forEach((axis) => rows.push({ key: constraint.offset[axis].id, label: `Path offset ${axis.toUpperCase()}`, color: colors[axis], suffix: '', property: constraint.offset[axis] }))
    }
    const objectConstraint = selected.value.objectConstraint
    if (objectConstraint) {
      ;(['x', 'y', 'z'] as const).forEach((axis) => rows.push({ key: objectConstraint.positionOffset[axis].id, label: `Follow position ${axis.toUpperCase()}`, color: colors[axis], suffix: '', property: objectConstraint.positionOffset[axis] }))
      ;(['x', 'y', 'z'] as const).forEach((axis) => rows.push({ key: objectConstraint.rotationOffset[axis].id, label: `Follow rotation ${axis.toUpperCase()}`, color: colors[axis], suffix: '°', property: objectConstraint.rotationOffset[axis] }))
    }
  } else if (selected.kind === 'light') {
    rows.push({ key: selected.value.intensity.id, label: 'Intensity', color: '#d3aa72', suffix: '', property: selected.value.intensity })
  }
  return rows
})

const animatedChannels = computed(() => channelDefinitions.value.filter((definition) => definition.property.animated))
const activeDefinition = computed(() => channelDefinitions.value.find((definition) => definition.key === activeProperty.value) ?? animatedChannels.value[0] ?? channelDefinitions.value[0])
const activeChannel = computed(() => activeDefinition.value?.property)
const sortedKeys = computed(() => [...(activeChannel.value?.keyframes ?? [])].sort((left, right) => left.time - right.time))
const displayedValues = computed(() => sortedKeys.value.map((keyframe, index, keys) => {
  if (graphMode.value === 'value') return keyframe.value
  const previous = keys[index - 1]
  const next = keys[index + 1]
  if (previous && next) return ((keyframe.value - previous.value) / Math.max(.0001, keyframe.time - previous.time) + (next.value - keyframe.value) / Math.max(.0001, next.time - keyframe.time)) / 2
  if (next) return (next.value - keyframe.value) / Math.max(.0001, next.time - keyframe.time)
  if (previous) return (keyframe.value - previous.value) / Math.max(.0001, keyframe.time - previous.time)
  return 0
}))
const padding = { left: 48, right: 22, top: 18, bottom: 30 }
const plotWidth = computed(() => Math.max(1, graphSize.value.width - padding.left - padding.right))
const plotHeight = computed(() => Math.max(1, graphSize.value.height - padding.top - padding.bottom))
const timeBounds = computed(() => ({
  min: props.mode === '3d' ? 0 : selectedLayer.value?.start ?? 0,
  max: props.mode === '3d' ? project.value.duration : (selectedLayer.value?.start ?? 0) + (selectedLayer.value?.duration ?? project.value.duration),
}))
const automaticValueBounds = computed(() => {
  const values = displayedValues.value
  const rawMin = values.length ? Math.min(...values) : 0
  const rawMax = values.length ? Math.max(...values) : 100
  const spread = Math.max(10, rawMax - rawMin)
  return { min: rawMin - spread * .2, max: rawMax + spread * .2 }
})
const valueBounds = ref({ min: 0, max: 100 })
const zoomPercent = computed(() => Math.round(graphZoom.value.x * 100))

function toX(time: number) {
  return padding.left + graphPan.value.x + ((time - timeBounds.value.min) / Math.max(.0001, timeBounds.value.max - timeBounds.value.min)) * plotWidth.value * graphZoom.value.x
}

function toY(value: number) {
  return padding.top + graphPan.value.y + (1 - ((value - valueBounds.value.min) / Math.max(.0001, valueBounds.value.max - valueBounds.value.min))) * plotHeight.value * graphZoom.value.y
}

const points = computed<GraphPoint[]>(() => sortedKeys.value.map((keyframe, index) => ({ keyframe, x: toX(keyframe.time), y: toY(displayedValues.value[index] ?? keyframe.value), value: displayedValues.value[index] ?? keyframe.value })))
const selectedIndex = computed(() => points.value.findIndex((point) => point.keyframe.id === selectedKeyframeId.value))
const selectedPoint = computed(() => points.value[selectedIndex.value])
const selectedKeys = computed(() => sortedKeys.value.filter((keyframe) => selectedKeyframeIds.value.includes(keyframe.id)))

function publishSelection(ids: string[], primaryId?: string | null) {
  selectedKeyframeIds.value = [...new Set(ids)]
  const primary = primaryId && selectedKeyframeIds.value.includes(primaryId) ? primaryId : selectedKeyframeIds.value.at(-1) ?? null
  selectedKeyframeId.value = primary
}

function isSelected(keyframeId: string) {
  return selectedKeyframeIds.value.includes(keyframeId)
}

function easingFor(keyframe: Keyframe<number>) {
  return keyframe.easing ?? { inX: .67, inY: 1, outX: .33, outY: 0 }
}

const curvePath = computed(() => {
  const graphPoints = points.value
  if (!graphPoints.length) return ''
  let path = `M ${graphPoints[0]!.x} ${graphPoints[0]!.y}`
  for (let index = 0; index < graphPoints.length - 1; index += 1) {
    const left = graphPoints[index]!
    const right = graphPoints[index + 1]!
    if (left.keyframe.interpolation === 'hold') {
      path += ` H ${right.x} V ${right.y}`
      continue
    }
    if (left.keyframe.interpolation === 'linear') {
      path += ` L ${right.x} ${right.y}`
      continue
    }
    const outgoing = easingFor(left.keyframe)
    const incoming = easingFor(right.keyframe)
    const dx = right.x - left.x
    const dy = right.y - left.y
    path += ` C ${left.x + dx * outgoing.outX} ${left.y + dy * outgoing.outY}, ${left.x + dx * incoming.inX} ${left.y + dy * incoming.inY}, ${right.x} ${right.y}`
  }
  return path
})

const incomingHandle = computed(() => {
  const index = selectedIndex.value
  const current = points.value[index]
  const previous = points.value[index - 1]
  if (!current || !previous || index <= 0 || previous.keyframe.interpolation !== 'bezier') return null
  const easing = easingFor(current.keyframe)
  return { x: previous.x + (current.x - previous.x) * easing.inX, y: previous.y + (current.y - previous.y) * easing.inY }
})

const outgoingHandle = computed(() => {
  const index = selectedIndex.value
  const current = points.value[index]
  const next = points.value[index + 1]
  if (!current || !next || current.keyframe.interpolation !== 'bezier') return null
  const easing = easingFor(current.keyframe)
  return { x: current.x + (next.x - current.x) * easing.outX, y: current.y + (next.y - current.y) * easing.outY }
})

const verticalGrid = computed(() => Array.from({ length: 13 }, (_, index) => ({
  x: padding.left + graphPan.value.x + plotWidth.value * graphZoom.value.x * index / 12,
  time: timeBounds.value.min + (timeBounds.value.max - timeBounds.value.min) * index / 12,
})))
const horizontalGrid = computed(() => Array.from({ length: 7 }, (_, index) => ({
  y: padding.top + graphPan.value.y + plotHeight.value * graphZoom.value.y * index / 6,
  value: valueBounds.value.max - (valueBounds.value.max - valueBounds.value.min) * index / 6,
})))

watch(animatedChannels, (channels) => {
  if (channels.length && !channels.some((channel) => channel.key === activeProperty.value)) activeProperty.value = channels[0]!.key
  else if (!channels.length && channelDefinitions.value.length && !channelDefinitions.value.some((channel) => channel.key === activeProperty.value)) activeProperty.value = channelDefinitions.value[0]!.key
}, { immediate: true })
watch([channelDefinitions, selectedKeyframeId], ([channels, keyframeId]) => {
  if (!keyframeId) return
  const selectedChannel = channels.find((channel) => channel.property.keyframes.some((keyframe) => keyframe.id === keyframeId))
  if (selectedChannel) activeProperty.value = selectedChannel.key
}, { immediate: true })
watch(selectedKeyframeId, (keyframeId) => {
  if (!keyframeId) {
    if (selectedKeyframeIds.value.length <= 1) selectedKeyframeIds.value = []
    return
  }
  if (!selectedKeyframeIds.value.includes(keyframeId)) selectedKeyframeIds.value = [keyframeId]
}, { immediate: true })
watch(activeProperty, () => {
  const available = new Set(sortedKeys.value.map((keyframe) => keyframe.id))
  const retained = selectedKeyframeIds.value.filter((id) => available.has(id))
  if (retained.length !== selectedKeyframeIds.value.length) publishSelection(retained)
})
watch([activeProperty, graphMode], () => {
  valueBounds.value = { ...automaticValueBounds.value }
  graphPan.value = { x: 0, y: 0 }
  graphZoom.value = { x: 1, y: 1 }
}, { flush: 'post', immediate: true })

function graphCoordinates(event: PointerEvent) {
  const bounds = graphRef.value?.getBoundingClientRect()
  if (!bounds) return null
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

function beginDrag(event: PointerEvent, type: GraphDragState['type'], keyframe: Keyframe<number>) {
  if (event.button !== 0 || !activeChannel.value) return
  event.preventDefault()
  event.stopPropagation()
  const toggle = event.ctrlKey || event.metaKey
  const additive = toggle || event.shiftKey
  if (type === 'key') {
    if (toggle && isSelected(keyframe.id)) {
      publishSelection(selectedKeyframeIds.value.filter((id) => id !== keyframe.id))
      return
    }
    if (additive) publishSelection([...selectedKeyframeIds.value, keyframe.id], keyframe.id)
    else if (!isSelected(keyframe.id)) publishSelection([keyframe.id], keyframe.id)
    else selectedKeyframeId.value = keyframe.id
  } else {
    selectedKeyframeId.value = keyframe.id
  }
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  const originals = type === 'key'
    ? selectedKeys.value.map((item) => ({ keyframe: item, time: item.time, value: item.value }))
    : []
  const selectedIds = new Set(originals.map((item) => item.keyframe.id))
  const unselected = sortedKeys.value.filter((item) => !selectedIds.has(item.id))
  const frame = 1 / project.value.frameRate
  let minDeltaTime = Number.NEGATIVE_INFINITY
  let maxDeltaTime = Number.POSITIVE_INFINITY
  originals.forEach((original) => {
    const previous = unselected.filter((item) => item.time < original.time).at(-1)
    const next = unselected.find((item) => item.time > original.time)
    minDeltaTime = Math.max(minDeltaTime, timeBounds.value.min - original.time, previous ? previous.time + frame - original.time : Number.NEGATIVE_INFINITY)
    maxDeltaTime = Math.min(maxDeltaTime, timeBounds.value.max - original.time, next ? next.time - frame - original.time : Number.POSITIVE_INFINITY)
  })
  dragState = {
    type, keyframe, property: activeChannel.value, moved: false,
    startX: event.clientX, startY: event.clientY, originals, minDeltaTime, maxDeltaTime,
  }
}

function beginSurfaceInteraction(event: PointerEvent) {
  const panGesture = event.button === 1 || (event.button === 0 && event.altKey)
  if (!panGesture && event.button !== 0) return
  event.preventDefault()
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  if (panGesture) {
    isPanning.value = true
    panState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: graphPan.value.x,
      originY: graphPan.value.y,
    }
    return
  }
  const coordinates = graphCoordinates(event)
  if (!coordinates) return
  marqueeState = {
    startX: coordinates.x,
    startY: coordinates.y,
    baseSelection: event.ctrlKey || event.metaKey || event.shiftKey ? [...selectedKeyframeIds.value] : [],
    moved: false,
  }
  if (!marqueeState.baseSelection.length) publishSelection([])
  marqueeRect.value = { left: coordinates.x, top: coordinates.y, width: 0, height: 0 }
}

function fitGraph() {
  valueBounds.value = { ...automaticValueBounds.value }
  graphPan.value = { x: 0, y: 0 }
  graphZoom.value = { x: 1, y: 1 }
}

function zoomGraph(nextZoom: number, anchor?: { x: number; y: number }) {
  const previousX = graphZoom.value.x
  const previousY = graphZoom.value.y
  const zoom = Math.max(.25, Math.min(16, nextZoom))
  if (Math.abs(zoom - previousX) < .0001) return
  const point = anchor ?? { x: padding.left + plotWidth.value / 2, y: padding.top + plotHeight.value / 2 }
  const originX = padding.left + graphPan.value.x
  const originY = padding.top + graphPan.value.y
  graphPan.value = {
    x: point.x - padding.left - (point.x - originX) * (zoom / previousX),
    y: point.y - padding.top - (point.y - originY) * (zoom / previousY),
  }
  graphZoom.value = { x: zoom, y: zoom }
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const bounds = graphRef.value?.getBoundingClientRect()
  if (!bounds) return
  if (event.shiftKey) {
    graphPan.value = { ...graphPan.value, x: graphPan.value.x - event.deltaY - event.deltaX }
    return
  }
  const factor = Math.exp(-event.deltaY * .0015)
  zoomGraph(graphZoom.value.x * factor, { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
}

function onPointerMove(event: PointerEvent) {
  if (panState) {
    graphPan.value = {
      x: panState.originX + event.clientX - panState.startX,
      y: panState.originY + event.clientY - panState.startY,
    }
    return
  }
  if (marqueeState) {
    const coordinates = graphCoordinates(event)
    if (!coordinates) return
    const left = Math.min(marqueeState.startX, coordinates.x)
    const right = Math.max(marqueeState.startX, coordinates.x)
    const top = Math.min(marqueeState.startY, coordinates.y)
    const bottom = Math.max(marqueeState.startY, coordinates.y)
    marqueeState.moved ||= Math.abs(coordinates.x - marqueeState.startX) > 2 || Math.abs(coordinates.y - marqueeState.startY) > 2
    marqueeRect.value = { left, top, width: right - left, height: bottom - top }
    const hits = points.value.filter((point) => point.x >= left - 6 && point.x <= right + 6 && point.y >= top - 6 && point.y <= bottom + 6).map((point) => point.keyframe.id)
    publishSelection([...marqueeState.baseSelection, ...hits], hits.at(-1) ?? marqueeState.baseSelection.at(-1) ?? null)
    return
  }
  const state = dragState
  const coordinates = graphCoordinates(event)
  if (!state || !coordinates) return
  state.moved = true
  const channel = state.property
  if (state.type === 'key') {
    const anchor = state.originals.find((item) => item.keyframe.id === state.keyframe.id)
    if (!anchor) return
    const frame = 1 / project.value.frameRate
    let deltaTime = ((event.clientX - state.startX) / (plotWidth.value * graphZoom.value.x)) * (timeBounds.value.max - timeBounds.value.min)
    if (snap.value) deltaTime = Math.round((anchor.time + deltaTime) / frame) * frame - anchor.time
    deltaTime = Math.max(state.minDeltaTime, Math.min(state.maxDeltaTime, deltaTime))
    const deltaValue = graphMode.value === 'value'
      ? -((event.clientY - state.startY) / (plotHeight.value * graphZoom.value.y)) * (valueBounds.value.max - valueBounds.value.min)
      : 0
    state.originals.forEach((original) => {
      original.keyframe.time = original.time + deltaTime
      if (graphMode.value === 'value') original.keyframe.value = original.value + deltaValue
    })
  } else {
    const keyIndex = [...channel.keyframes].sort((left, right) => left.time - right.time).findIndex((keyframe) => keyframe.id === state.keyframe.id)
    const currentPoint = points.value[keyIndex]
    if (!currentPoint) return
    state.keyframe.easing ??= { inX: .67, inY: 1, outX: .33, outY: 0 }
    if (state.type === 'out') {
      const nextPoint = points.value[keyIndex + 1]
      if (!nextPoint) return
      state.keyframe.interpolation = 'bezier'
      const segmentHeight = nextPoint.y - currentPoint.y
      state.keyframe.easing.outX = Math.max(.02, Math.min(.98, (coordinates.x - currentPoint.x) / Math.max(1, nextPoint.x - currentPoint.x)))
      state.keyframe.easing.outY = Math.abs(segmentHeight) < .001 ? 0 : Math.max(-2, Math.min(3, (coordinates.y - currentPoint.y) / segmentHeight))
    } else {
      const previousPoint = points.value[keyIndex - 1]
      if (!previousPoint) return
      previousPoint.keyframe.interpolation = 'bezier'
      const segmentHeight = currentPoint.y - previousPoint.y
      state.keyframe.easing.inX = Math.max(.02, Math.min(.98, (coordinates.x - previousPoint.x) / Math.max(1, currentPoint.x - previousPoint.x)))
      state.keyframe.easing.inY = Math.abs(segmentHeight) < .001 ? 1 : Math.max(-2, Math.min(3, (coordinates.y - previousPoint.y) / segmentHeight))
    }
  }
}

function endDrag() {
  if (dragState?.moved) {
    dragState.property.keyframes.sort((left, right) => left.time - right.time)
    if (props.mode === '3d') store.markSceneChanged()
    else store.markChanged()
  }
  dragState = null
  panState = null
  marqueeState = null
  marqueeRect.value = null
  isPanning.value = false
}

function applyInterpolation(interpolation: Keyframe<number>['interpolation'], preset?: 'ease' | 'smooth') {
  const keys = selectedKeys.value.length ? selectedKeys.value : selectedPoint.value ? [selectedPoint.value.keyframe] : []
  if (!keys.length) return
  const selectedIds = new Set(keys.map((keyframe) => keyframe.id))
  keys.forEach((keyframe) => {
    keyframe.interpolation = interpolation
    if (interpolation !== 'bezier') return
    keyframe.easing = preset === 'smooth'
      ? { inX: .58, inY: 1, outX: .42, outY: 0 }
      : { inX: .72, inY: 1, outX: .28, outY: 0 }
    const index = sortedKeys.value.findIndex((item) => item.id === keyframe.id)
    const previous = sortedKeys.value[index - 1]
    if (previous && !selectedIds.has(previous.id)) previous.interpolation = 'bezier'
  })
  if (props.mode === '3d') store.markSceneChanged()
  else store.markChanged()
}

onMounted(async () => {
  await nextTick()
  if (graphRef.value) {
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) graphSize.value = { width: entry.contentRect.width, height: entry.contentRect.height }
    })
    resizeObserver.observe(graphRef.value)
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endDrag)
})
</script>

<template>
  <section class="curve-editor-panel">
    <div class="curve-toolbar">
      <div class="mode-switch">
        <button type="button" :class="{ active: graphMode === 'value' }" @click="graphMode = 'value'"><Spline :size="12" /> Value Graph</button>
        <button type="button" :class="{ active: graphMode === 'speed' }" @click="graphMode = 'speed'"><Activity :size="12" /> Speed Graph</button>
      </div>
      <span class="toolbar-divider" />
      <button type="button" :disabled="!selectedKeys.length" title="Apply linear interpolation to selected keyframes" @click="applyInterpolation('linear')">Linear</button>
      <button type="button" :disabled="!selectedKeys.length" title="Apply hold interpolation to selected keyframes" @click="applyInterpolation('hold')">Hold</button>
      <button type="button" :disabled="!selectedKeys.length" title="Apply Easy Ease to selected keyframes" @click="applyInterpolation('bezier', 'ease')"><Spline :size="12" /> Easy Ease</button>
      <button type="button" :disabled="!selectedKeys.length" title="Apply Auto Smooth to selected keyframes" @click="applyInterpolation('bezier', 'smooth')"><TimerReset :size="12" /> Auto Smooth</button>
      <span v-if="selectedKeys.length > 1" class="selection-count">{{ selectedKeys.length }} selected</span>
      <span class="toolbar-spacer" />
      <button class="property-select" type="button" :disabled="!activeDefinition" @click="showPropertyMenu = !showPropertyMenu"><i v-if="activeDefinition" :style="{ background: activeDefinition.color }" />{{ activeDefinition?.label ?? 'No property' }}<ChevronDown :size="11" /></button>
      <button type="button" title="Reset the graph pan and fit all keyframes" @click="fitGraph"><Focus :size="12" /> Fit</button>
      <button class="zoom-button" type="button" title="Zoom out" @click="zoomGraph(graphZoom.x / 1.25)"><ZoomOut :size="12" /></button>
      <button class="zoom-button" type="button" title="Zoom in" @click="zoomGraph(graphZoom.x * 1.25)"><ZoomIn :size="12" /></button>
      <span class="zoom-level">{{ zoomPercent }}%</span>
      <div v-if="showPropertyMenu" class="property-menu">
        <button v-for="channel in animatedChannels" :key="channel.key" type="button" :class="{ active: activeProperty === channel.key }" @click="activeProperty = channel.key; showPropertyMenu = false"><i :style="{ background: channel.color }" />{{ channel.label }}<small>{{ channel.property.keyframes.length }} keys</small></button>
      </div>
    </div>

    <div ref="graphRef" class="graph-surface" :class="{ panning: isPanning }" @wheel="onWheel">
      <svg :viewBox="`0 0 ${graphSize.width} ${graphSize.height}`" preserveAspectRatio="none" aria-label="Animation curve editor" @pointerdown="beginSurfaceInteraction" @auxclick.prevent>
        <g class="grid-lines">
          <g v-for="line in verticalGrid" :key="line.x"><line :x1="line.x" :x2="line.x" :y1="padding.top" :y2="graphSize.height - padding.bottom" /><text :x="line.x + 3" :y="graphSize.height - 9">{{ line.time.toFixed(1) }}s</text></g>
          <g v-for="line in horizontalGrid" :key="line.y"><line :x1="padding.left" :x2="graphSize.width - padding.right" :y1="line.y" :y2="line.y" /><text x="4" :y="line.y + 3">{{ line.value.toFixed(0) }}</text></g>
        </g>
        <line class="zero-line" :x1="padding.left" :x2="graphSize.width - padding.right" :y1="toY(0)" :y2="toY(0)" />
        <path v-if="curvePath" class="curve-shadow" :d="curvePath" />
        <path v-if="curvePath" class="value-curve" :style="{ stroke: activeDefinition?.color }" :d="curvePath" />

        <g v-if="selectedPoint && incomingHandle" class="tangent">
          <line :x1="selectedPoint.x" :y1="selectedPoint.y" :x2="incomingHandle.x" :y2="incomingHandle.y" />
          <circle :cx="incomingHandle.x" :cy="incomingHandle.y" r="5" @pointerdown="beginDrag($event, 'in', selectedPoint.keyframe)" />
        </g>
        <g v-if="selectedPoint && outgoingHandle" class="tangent">
          <line :x1="selectedPoint.x" :y1="selectedPoint.y" :x2="outgoingHandle.x" :y2="outgoingHandle.y" />
          <circle :cx="outgoingHandle.x" :cy="outgoingHandle.y" r="5" @pointerdown="beginDrag($event, 'out', selectedPoint.keyframe)" />
        </g>

        <g v-for="point in points" :key="point.keyframe.id" class="graph-key" :class="{ selected: isSelected(point.keyframe.id) }" :transform="`translate(${point.x} ${point.y})`" @pointerdown="beginDrag($event, 'key', point.keyframe)">
          <rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" />
          <text x="8" y="-8">{{ point.value.toFixed(1) }}</text>
        </g>
      </svg>
      <div v-if="marqueeRect" class="selection-marquee" :style="{ left: `${marqueeRect.left}px`, top: `${marqueeRect.top}px`, width: `${marqueeRect.width}px`, height: `${marqueeRect.height}px` }" />
      <div v-if="!sortedKeys.length" class="empty-graph"><Move :size="20" /><strong>No animated keys</strong><span>{{ mode === '3d' ? 'Select an animated 3D property or add keyframes in the Inspector.' : 'Enable animation and add keyframes in the Inspector.' }}</span></div>
      <div v-if="activeDefinition" class="graph-legend"><span><i :style="{ background: activeDefinition.color }" />{{ activeDefinition.label }}</span><small>{{ sortedKeys.length }} keyframes · {{ graphMode === 'value' ? 'Value over time' : 'Speed preview' }}</small><em>Drag empty space to select · Ctrl/Shift add</em></div>
    </div>
  </section>
</template>

<style scoped>
.curve-editor-panel { position: relative; display: flex; height: 100%; min-height: 0; flex-direction: column; background: #0d0f14; }.curve-toolbar { position: relative; display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 3px; padding: 0 6px; background: #15171d; border-bottom: 1px solid var(--border-subtle); }.curve-toolbar button { display: inline-flex; height: 24px; align-items: center; gap: 5px; padding: 0 7px; color: var(--text-secondary); background: #1a1d24; border: 1px solid #30343d; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; white-space: nowrap; }.curve-toolbar button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }.curve-toolbar button:disabled { opacity: .38; cursor: default; }.mode-switch { display: flex; padding: 2px; background: #0e1015; border: 1px solid #2c3038; border-radius: 4px; }.mode-switch button { height: 21px; background: transparent; border-color: transparent; }.mode-switch button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.toolbar-divider { width: 1px; height: 20px; margin: 0 3px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.selection-count { flex: 0 0 auto; padding: 2px 5px; color: #cdd5ff; background: var(--bg-selected); border: 1px solid var(--accent-border); border-radius: 3px; font-size: 7px; white-space: nowrap; }.property-select { min-width: 112px; justify-content: space-between; }.curve-toolbar .zoom-button { width: 24px; flex: 0 0 24px; padding: 0; justify-content: center; }.zoom-level { width: 31px; flex: 0 0 31px; color: var(--text-muted); font-size: 7.5px; font-variant-numeric: tabular-nums; text-align: right; }.property-select i, .property-menu i, .graph-legend i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; }.property-menu { position: absolute; z-index: 20; top: 30px; right: 132px; width: 170px; padding: 4px; background: #1a1d24; border: 1px solid #424752; border-radius: 4px; box-shadow: 0 10px 24px rgb(0 0 0 / .45); }.property-menu button { display: flex; width: 100%; border-color: transparent; background: transparent; }.property-menu button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.property-menu small { margin-left: auto; color: var(--text-muted); }
.graph-surface { position: relative; min-height: 0; flex: 1; overflow: hidden; background-color: #0d0f14; background-image: radial-gradient(#232730 1px, transparent 1px); background-size: 12px 12px; }.graph-surface svg { display: block; width: 100%; height: 100%; cursor: default; touch-action: none; }.graph-surface.panning svg { cursor: grabbing; user-select: none; }.selection-marquee { position: absolute; z-index: 12; background: rgb(140 155 255 / .1); border: 1px solid #a5b4fc; pointer-events: none; }.grid-lines line { stroke: #262a33; stroke-width: 1; vector-effect: non-scaling-stroke; }.grid-lines text { fill: #565c67; font-size: 7px; }.zero-line { stroke: #474d5b; stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }.curve-shadow { fill: none; stroke: rgb(0 0 0 / .75); stroke-width: 5; vector-effect: non-scaling-stroke; }.value-curve { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 0 3px rgb(126 139 225 / .3)); }.tangent line { stroke: #98a5f4; stroke-width: 1; vector-effect: non-scaling-stroke; }.tangent circle { fill: #11141b; stroke: #b6c0ff; stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: crosshair; }.tangent circle:hover { fill: #dce2ff; }.graph-key { cursor: move; }.graph-key rect { fill: #d3a263; stroke: #2c2217; stroke-width: 1; vector-effect: non-scaling-stroke; }.graph-key text { display: none; fill: #d9dde8; font-size: 8px; paint-order: stroke; stroke: #0d0f14; stroke-width: 3px; }.graph-key:hover text, .graph-key.selected text { display: block; }.graph-key:hover rect, .graph-key.selected rect { fill: #fff1d6; stroke: #f3bd72; stroke-width: 2; }.empty-graph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 5px; color: var(--text-muted); pointer-events: none; }.empty-graph strong { color: var(--text-secondary); font-size: 10px; }.empty-graph span { font-size: 8.5px; }.graph-legend { position: absolute; top: 8px; left: 54px; display: flex; align-items: center; gap: 8px; padding: 4px 6px; color: var(--text-secondary); background: rgb(15 17 23 / .82); border: 1px solid #292e38; border-radius: 3px; font-size: 8px; pointer-events: none; }.graph-legend span { display: flex; align-items: center; gap: 5px; }.graph-legend small { color: var(--text-muted); }.graph-legend em { color: #798090; font-size: 7.5px; font-style: normal; }
</style>
