<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Activity, ChevronDown, Focus, Move, Spline, TimerReset } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { EditorLayer, Keyframe } from '@/models/editor'

type TransformKey = keyof EditorLayer['transform']
type GraphMode = 'value' | 'speed'

interface ChannelOption { key: TransformKey; label: string; color: string; suffix: string }
interface GraphPoint { keyframe: Keyframe<number>; x: number; y: number; value: number }
interface GraphDragState { type: 'key' | 'in' | 'out'; keyframe: Keyframe<number>; property: TransformKey; moved: boolean }
interface GraphPanState { startX: number; startY: number; originX: number; originY: number }

const store = useEditorStore()
const { project, selectedLayer, selectedKeyframeId, snap } = storeToRefs(store)
const graphRef = ref<HTMLElement>()
const graphSize = ref({ width: 900, height: 220 })
const activeProperty = ref<TransformKey>('y')
const graphMode = ref<GraphMode>('value')
const showPropertyMenu = ref(false)
const graphPan = ref({ x: 0, y: 0 })
const isPanning = ref(false)
let resizeObserver: ResizeObserver | null = null
let dragState: GraphDragState | null = null
let panState: GraphPanState | null = null

const channelDefinitions: ChannelOption[] = [
  { key: 'x', label: 'Position X', color: '#7fa7e7', suffix: 'px' },
  { key: 'y', label: 'Position Y', color: '#d59a68', suffix: 'px' },
  { key: 'scaleX', label: 'Scale X', color: '#9a91e8', suffix: '%' },
  { key: 'scaleY', label: 'Scale Y', color: '#7f9fe4', suffix: '%' },
  { key: 'rotation', label: 'Rotation', color: '#d37e8c', suffix: '°' },
  { key: 'opacity', label: 'Opacity', color: '#70b596', suffix: '%' },
]

const animatedChannels = computed(() => channelDefinitions.filter((definition) => selectedLayer.value?.transform[definition.key].animated))
const activeDefinition = computed(() => channelDefinitions.find((definition) => definition.key === activeProperty.value) ?? channelDefinitions[0]!)
const activeChannel = computed(() => selectedLayer.value?.transform[activeProperty.value])
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
  min: selectedLayer.value?.start ?? 0,
  max: (selectedLayer.value?.start ?? 0) + (selectedLayer.value?.duration ?? project.value.duration),
}))
const valueBounds = computed(() => {
  const values = displayedValues.value
  const rawMin = values.length ? Math.min(...values) : 0
  const rawMax = values.length ? Math.max(...values) : 100
  const spread = Math.max(10, rawMax - rawMin)
  return { min: rawMin - spread * .2, max: rawMax + spread * .2 }
})

function toX(time: number) {
  return padding.left + graphPan.value.x + ((time - timeBounds.value.min) / Math.max(.0001, timeBounds.value.max - timeBounds.value.min)) * plotWidth.value
}

function toY(value: number) {
  return padding.top + graphPan.value.y + (1 - ((value - valueBounds.value.min) / Math.max(.0001, valueBounds.value.max - valueBounds.value.min))) * plotHeight.value
}

const points = computed<GraphPoint[]>(() => sortedKeys.value.map((keyframe, index) => ({ keyframe, x: toX(keyframe.time), y: toY(displayedValues.value[index] ?? keyframe.value), value: displayedValues.value[index] ?? keyframe.value })))
const selectedIndex = computed(() => points.value.findIndex((point) => point.keyframe.id === selectedKeyframeId.value))
const selectedPoint = computed(() => points.value[selectedIndex.value])

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
  if (!current || !previous || index <= 0) return null
  const easing = easingFor(current.keyframe)
  return { x: previous.x + (current.x - previous.x) * easing.inX, y: previous.y + (current.y - previous.y) * easing.inY }
})

const outgoingHandle = computed(() => {
  const index = selectedIndex.value
  const current = points.value[index]
  const next = points.value[index + 1]
  if (!current || !next) return null
  const easing = easingFor(current.keyframe)
  return { x: current.x + (next.x - current.x) * easing.outX, y: current.y + (next.y - current.y) * easing.outY }
})

const verticalGrid = computed(() => Array.from({ length: 13 }, (_, index) => ({
  x: padding.left + graphPan.value.x + plotWidth.value * index / 12,
  time: timeBounds.value.min + (timeBounds.value.max - timeBounds.value.min) * index / 12,
})))
const horizontalGrid = computed(() => Array.from({ length: 7 }, (_, index) => ({
  y: padding.top + graphPan.value.y + plotHeight.value * index / 6,
  value: valueBounds.value.max - (valueBounds.value.max - valueBounds.value.min) * index / 6,
})))

watch(animatedChannels, (channels) => {
  if (channels.length && !channels.some((channel) => channel.key === activeProperty.value)) activeProperty.value = channels[0]!.key
}, { immediate: true })

function graphCoordinates(event: PointerEvent) {
  const bounds = graphRef.value?.getBoundingClientRect()
  if (!bounds) return null
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

function beginDrag(event: PointerEvent, type: GraphDragState['type'], keyframe: Keyframe<number>) {
  if (event.button !== 0 || !selectedLayer.value) return
  event.preventDefault()
  event.stopPropagation()
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  selectedKeyframeId.value = keyframe.id
  dragState = { type, keyframe, property: activeProperty.value, moved: false }
}

function beginSurfacePan(event: PointerEvent) {
  if (event.button !== 1) return
  event.preventDefault()
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  isPanning.value = true
  panState = {
    startX: event.clientX,
    startY: event.clientY,
    originX: graphPan.value.x,
    originY: graphPan.value.y,
  }
}

function fitGraph() {
  graphPan.value = { x: 0, y: 0 }
}

function onPointerMove(event: PointerEvent) {
  if (panState) {
    graphPan.value = {
      x: panState.originX + event.clientX - panState.startX,
      y: panState.originY + event.clientY - panState.startY,
    }
    return
  }
  const state = dragState
  const coordinates = graphCoordinates(event)
  const layer = selectedLayer.value
  if (!state || !coordinates || !layer) return
  state.moved = true
  const channel = layer.transform[state.property]
  const keyIndex = [...channel.keyframes].sort((left, right) => left.time - right.time).findIndex((keyframe) => keyframe.id === state.keyframe.id)
  if (state.type === 'key') {
    const previous = sortedKeys.value[keyIndex - 1]
    const next = sortedKeys.value[keyIndex + 1]
    const frame = 1 / project.value.frameRate
    let time = timeBounds.value.min + ((coordinates.x - padding.left - graphPan.value.x) / plotWidth.value) * (timeBounds.value.max - timeBounds.value.min)
    if (snap.value) time = Math.round(time / frame) * frame
    state.keyframe.time = Math.max(previous ? previous.time + frame : timeBounds.value.min, Math.min(next ? next.time - frame : timeBounds.value.max, time))
    if (graphMode.value === 'value') state.keyframe.value = valueBounds.value.max - ((coordinates.y - padding.top - graphPan.value.y) / plotHeight.value) * (valueBounds.value.max - valueBounds.value.min)
  } else {
    const currentPoint = points.value[keyIndex]
    if (!currentPoint) return
    state.keyframe.interpolation = 'bezier'
    state.keyframe.easing ??= { inX: .67, inY: 1, outX: .33, outY: 0 }
    if (state.type === 'out') {
      const nextPoint = points.value[keyIndex + 1]
      if (!nextPoint) return
      state.keyframe.easing.outX = Math.max(.02, Math.min(.98, (coordinates.x - currentPoint.x) / Math.max(1, nextPoint.x - currentPoint.x)))
      state.keyframe.easing.outY = Math.max(-2, Math.min(3, (coordinates.y - currentPoint.y) / Math.max(1, nextPoint.y - currentPoint.y)))
    } else {
      const previousPoint = points.value[keyIndex - 1]
      if (!previousPoint) return
      state.keyframe.easing.inX = Math.max(.02, Math.min(.98, (coordinates.x - previousPoint.x) / Math.max(1, currentPoint.x - previousPoint.x)))
      state.keyframe.easing.inY = Math.max(-2, Math.min(3, (coordinates.y - previousPoint.y) / Math.max(1, currentPoint.y - previousPoint.y)))
    }
  }
}

function endDrag() {
  if (dragState?.moved) {
    selectedLayer.value?.transform[dragState.property].keyframes.sort((left, right) => left.time - right.time)
    store.markChanged()
  }
  dragState = null
  panState = null
  isPanning.value = false
}

function applyInterpolation(interpolation: Keyframe<number>['interpolation'], preset?: 'ease' | 'smooth') {
  const keyframe = selectedPoint.value?.keyframe
  if (!keyframe) return
  keyframe.interpolation = interpolation
  if (interpolation === 'bezier') keyframe.easing = preset === 'smooth'
    ? { inX: .58, inY: 1, outX: .42, outY: 0 }
    : { inX: .72, inY: 1, outX: .28, outY: 0 }
  store.markChanged()
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
      <button type="button" title="Linear interpolation" @click="applyInterpolation('linear')">Linear</button>
      <button type="button" title="Hold interpolation" @click="applyInterpolation('hold')">Hold</button>
      <button type="button" title="Ease in and out" @click="applyInterpolation('bezier', 'ease')"><Spline :size="12" /> Easy Ease</button>
      <button type="button" title="Smooth tangents" @click="applyInterpolation('bezier', 'smooth')"><TimerReset :size="12" /> Auto Smooth</button>
      <span class="toolbar-spacer" />
      <button class="property-select" type="button" @click="showPropertyMenu = !showPropertyMenu"><i :style="{ background: activeDefinition.color }" />{{ activeDefinition.label }}<ChevronDown :size="11" /></button>
      <button type="button" title="Reset the graph pan and fit all keyframes" @click="fitGraph"><Focus :size="12" /> Fit</button>
      <div v-if="showPropertyMenu" class="property-menu">
        <button v-for="channel in animatedChannels" :key="channel.key" type="button" :class="{ active: activeProperty === channel.key }" @click="activeProperty = channel.key; showPropertyMenu = false"><i :style="{ background: channel.color }" />{{ channel.label }}<small>{{ selectedLayer?.transform[channel.key].keyframes.length }} keys</small></button>
      </div>
    </div>

    <div ref="graphRef" class="graph-surface" :class="{ panning: isPanning }">
      <svg :viewBox="`0 0 ${graphSize.width} ${graphSize.height}`" preserveAspectRatio="none" aria-label="Animation curve editor" @pointerdown="beginSurfacePan" @auxclick.prevent>
        <g class="grid-lines">
          <g v-for="line in verticalGrid" :key="line.x"><line :x1="line.x" :x2="line.x" :y1="padding.top" :y2="graphSize.height - padding.bottom" /><text :x="line.x + 3" :y="graphSize.height - 9">{{ line.time.toFixed(1) }}s</text></g>
          <g v-for="line in horizontalGrid" :key="line.y"><line :x1="padding.left" :x2="graphSize.width - padding.right" :y1="line.y" :y2="line.y" /><text x="4" :y="line.y + 3">{{ line.value.toFixed(0) }}</text></g>
        </g>
        <line class="zero-line" :x1="padding.left" :x2="graphSize.width - padding.right" :y1="toY(0)" :y2="toY(0)" />
        <path v-if="curvePath" class="curve-shadow" :d="curvePath" />
        <path v-if="curvePath" class="value-curve" :style="{ stroke: activeDefinition.color }" :d="curvePath" />

        <g v-if="selectedPoint && incomingHandle" class="tangent">
          <line :x1="selectedPoint.x" :y1="selectedPoint.y" :x2="incomingHandle.x" :y2="incomingHandle.y" />
          <circle :cx="incomingHandle.x" :cy="incomingHandle.y" r="5" @pointerdown="beginDrag($event, 'in', selectedPoint.keyframe)" />
        </g>
        <g v-if="selectedPoint && outgoingHandle" class="tangent">
          <line :x1="selectedPoint.x" :y1="selectedPoint.y" :x2="outgoingHandle.x" :y2="outgoingHandle.y" />
          <circle :cx="outgoingHandle.x" :cy="outgoingHandle.y" r="5" @pointerdown="beginDrag($event, 'out', selectedPoint.keyframe)" />
        </g>

        <g v-for="point in points" :key="point.keyframe.id" class="graph-key" :class="{ selected: selectedKeyframeId === point.keyframe.id }" :transform="`translate(${point.x} ${point.y})`" @pointerdown="beginDrag($event, 'key', point.keyframe)">
          <rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" />
          <text x="8" y="-8">{{ point.value.toFixed(1) }}</text>
        </g>
      </svg>
      <div v-if="!sortedKeys.length" class="empty-graph"><Move :size="20" /><strong>No animated keys</strong><span>Enable animation and add keyframes in the Inspector.</span></div>
      <div class="graph-legend"><span><i :style="{ background: activeDefinition.color }" />{{ activeDefinition.label }}</span><small>{{ sortedKeys.length }} keyframes · {{ graphMode === 'value' ? 'Value over time' : 'Speed preview' }}</small><em>Middle-drag to pan</em></div>
    </div>
  </section>
</template>

<style scoped>
.curve-editor-panel { position: relative; display: flex; height: 100%; min-height: 0; flex-direction: column; background: #0d0f14; }.curve-toolbar { position: relative; display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 3px; padding: 0 6px; background: #15171d; border-bottom: 1px solid var(--border-subtle); }.curve-toolbar button { display: inline-flex; height: 24px; align-items: center; gap: 5px; padding: 0 7px; color: var(--text-secondary); background: #1a1d24; border: 1px solid #30343d; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; white-space: nowrap; }.curve-toolbar button:hover { color: var(--text-primary); background: var(--bg-hover); }.mode-switch { display: flex; padding: 2px; background: #0e1015; border: 1px solid #2c3038; border-radius: 4px; }.mode-switch button { height: 21px; background: transparent; border-color: transparent; }.mode-switch button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.toolbar-divider { width: 1px; height: 20px; margin: 0 3px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.property-select { min-width: 112px; justify-content: space-between; }.property-select i, .property-menu i, .graph-legend i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; }.property-menu { position: absolute; z-index: 20; top: 30px; right: 47px; width: 170px; padding: 4px; background: #1a1d24; border: 1px solid #424752; border-radius: 4px; box-shadow: 0 10px 24px rgb(0 0 0 / .45); }.property-menu button { display: flex; width: 100%; border-color: transparent; background: transparent; }.property-menu button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.property-menu small { margin-left: auto; color: var(--text-muted); }
.graph-surface { position: relative; min-height: 0; flex: 1; overflow: hidden; background-color: #0d0f14; background-image: radial-gradient(#232730 1px, transparent 1px); background-size: 12px 12px; }.graph-surface svg { display: block; width: 100%; height: 100%; cursor: default; touch-action: none; }.graph-surface.panning svg { cursor: grabbing; user-select: none; }.grid-lines line { stroke: #262a33; stroke-width: 1; vector-effect: non-scaling-stroke; }.grid-lines text { fill: #565c67; font-size: 7px; }.zero-line { stroke: #474d5b; stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }.curve-shadow { fill: none; stroke: rgb(0 0 0 / .75); stroke-width: 5; vector-effect: non-scaling-stroke; }.value-curve { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 0 3px rgb(126 139 225 / .3)); }.tangent line { stroke: #98a5f4; stroke-width: 1; vector-effect: non-scaling-stroke; }.tangent circle { fill: #11141b; stroke: #b6c0ff; stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: crosshair; }.tangent circle:hover { fill: #dce2ff; }.graph-key { cursor: move; }.graph-key rect { fill: #d3a263; stroke: #2c2217; stroke-width: 1; vector-effect: non-scaling-stroke; }.graph-key text { display: none; fill: #d9dde8; font-size: 8px; paint-order: stroke; stroke: #0d0f14; stroke-width: 3px; }.graph-key:hover text, .graph-key.selected text { display: block; }.graph-key:hover rect, .graph-key.selected rect { fill: #fff1d6; stroke: #f3bd72; stroke-width: 2; }.empty-graph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 5px; color: var(--text-muted); pointer-events: none; }.empty-graph strong { color: var(--text-secondary); font-size: 10px; }.empty-graph span { font-size: 8.5px; }.graph-legend { position: absolute; top: 8px; left: 54px; display: flex; align-items: center; gap: 8px; padding: 4px 6px; color: var(--text-secondary); background: rgb(15 17 23 / .82); border: 1px solid #292e38; border-radius: 3px; font-size: 8px; pointer-events: none; }.graph-legend span { display: flex; align-items: center; gap: 5px; }.graph-legend small { color: var(--text-muted); }.graph-legend em { color: #798090; font-size: 7.5px; font-style: normal; }
</style>
