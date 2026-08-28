<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Feather, Scissors } from '@lucide/vue'
import type { EditorLayer } from '@/models/editor'
import { shapeOutline } from '@/engine/shapes/shapeGeometry'

const props = defineProps<{ modelValue: number[]; shape: EditorLayer }>()
const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>()

const SAMPLE_COUNT = 32
const mode = ref<'feather' | 'hard'>('feather')
const brushRadius = ref(2)
const painting = ref(false)
const hover = ref<{ sample: number; x: number; y: number; pointerX: number; pointerY: number } | null>(null)
let pendingValues: number[] | null = null
let paintFrame = 0

const outline = computed(() => {
  const source = shapeOutline(props.shape, 16)
  if (!source.points.length) return { points: [], closed: false }
  const xs = source.points.map((point) => point[0])
  const ys = source.points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = Math.min(164 / Math.max(1, maxX - minX), 96 / Math.max(1, maxY - minY))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return {
    closed: source.closed,
    points: source.points.map(([x, y]) => ({ x: 100 + (x - centerX) * scale, y: 70 + (y - centerY) * scale })),
  }
})

const segments = computed(() => {
  const points = outline.value.points
  const count = outline.value.closed ? points.length : Math.max(0, points.length - 1)
  return Array.from({ length: count }, (_, index) => ({
    start: points[index]!,
    end: points[(index + 1) % points.length]!,
    sample: Math.min(SAMPLE_COUNT - 1, Math.floor(index / Math.max(1, count) * SAMPLE_COUNT)),
  }))
})

function emitPending() {
  paintFrame = 0
  if (!pendingValues) return
  emit('update:modelValue', pendingValues)
  pendingValues = null
}

function queueValues(values: number[]) {
  pendingValues = values
  if (!paintFrame) paintFrame = requestAnimationFrame(emitPending)
}

function paintAt(index: number, temporaryHard = false) {
  if (!outline.value.closed) return
  const base = pendingValues ?? props.modelValue
  const next = Array.from({ length: SAMPLE_COUNT }, (_, sample) => base[sample] ?? 1)
  const target = temporaryHard || mode.value === 'hard' ? 0 : 1
  for (let offset = -brushRadius.value; offset <= brushRadius.value; offset += 1) {
    const sampleIndex = (index + offset + SAMPLE_COUNT) % SAMPLE_COUNT
    const influence = 1 - Math.abs(offset) / (brushRadius.value + 1)
    const current = next[sampleIndex] ?? 1
    next[sampleIndex] = current + (target - current) * influence
  }
  queueValues(next)
}

/**
 * The viewBox is letterboxed inside the element, so scaling the client offset by the element's own
 * rectangle drifts further from the pointer the wider the sidebar gets. The screen CTM is the only
 * conversion that survives preserveAspectRatio.
 */
function svgPointFromEvent(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement
  const matrix = svg.getScreenCTM()
  const bounds = svg.getBoundingClientRect()
  if (!matrix || typeof DOMPoint === 'undefined') {
    return { x: (event.clientX - bounds.left) * (200 / bounds.width), y: (event.clientY - bounds.top) * (140 / bounds.height) }
  }
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

function nearestFromEvent(event: PointerEvent) {
  const { x, y } = svgPointFromEvent(event)
  const nearest = segments.value.reduce((best, segment) => {
    const deltaX = segment.end.x - segment.start.x
    const deltaY = segment.end.y - segment.start.y
    const lengthSquared = deltaX ** 2 + deltaY ** 2
    const amount = lengthSquared ? Math.max(0, Math.min(1, ((x - segment.start.x) * deltaX + (y - segment.start.y) * deltaY) / lengthSquared)) : 0
    const pointX = segment.start.x + deltaX * amount
    const pointY = segment.start.y + deltaY * amount
    const distance = Math.hypot(x - pointX, y - pointY)
    return distance < best.distance ? { sample: segment.sample, x: pointX, y: pointY, distance } : best
  }, { sample: 0, x: 100, y: 70, distance: Infinity })
  return { ...nearest, pointerX: x, pointerY: y }
}

function beginPaint(event: PointerEvent) {
  if (event.button !== 0 || !outline.value.closed) return
  event.preventDefault()
  event.stopPropagation()
  painting.value = true
  ;(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId)
  hover.value = nearestFromEvent(event)
  paintAt(hover.value.sample, event.shiftKey)
}

function movePaint(event: PointerEvent) {
  hover.value = nearestFromEvent(event)
  if (painting.value) {
    event.preventDefault()
    paintAt(hover.value.sample, event.shiftKey)
  }
}

function endPaint(event: PointerEvent) {
  painting.value = false
  if (paintFrame) {
    cancelAnimationFrame(paintFrame)
    emitPending()
  }
  const svg = event.currentTarget as SVGSVGElement
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
}

/** 1 = fully feathered, 0 = hard cut. Drawn as two stacked strokes so the two extremes cannot be confused. */
function featherStrength(index: number) {
  return Math.max(0, Math.min(1, (pendingValues ?? props.modelValue)[index] ?? 1))
}

const brushSamples = computed(() => {
  const center = hover.value?.sample
  if (center === undefined) return new Set<number>()
  const affected = new Set<number>()
  for (let offset = -brushRadius.value; offset <= brushRadius.value; offset += 1) affected.add((center + offset + SAMPLE_COUNT) % SAMPLE_COUNT)
  return affected
})

onBeforeUnmount(() => {
  if (paintFrame) cancelAnimationFrame(paintFrame)
})
</script>

<template>
  <div class="mask-edge-painter">
    <div class="paint-toolbar">
      <button type="button" :class="{ active: mode === 'feather' }" title="Paint feathered edge" @click="mode = 'feather'"><Feather :size="11" /> Feather</button>
      <button type="button" :class="{ active: mode === 'hard' }" title="Paint hard-cut edge" @click="mode = 'hard'"><Scissors :size="11" /> Hard</button>
      <label title="Brush radius along the mask edge">Brush {{ brushRadius + 1 }}<input v-model.number="brushRadius" type="range" min="0" max="5" step="1" /></label>
    </div>
    <svg class="edge-canvas" :class="{ disabled: !outline.closed }" viewBox="0 0 200 140" role="img" :aria-label="`Paint feather strength around ${shape.name}`" @pointerdown="beginPaint" @pointermove="movePaint" @pointerup="endPaint" @pointercancel="endPaint" @pointerleave="!painting && (hover = null)">
      <defs><filter id="mask-edge-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.1" /></filter></defs>
      <polygon v-if="outline.closed" class="shape-fill" :points="outline.points.map((point) => `${point.x},${point.y}`).join(' ')" />
      <g v-for="(segment, index) in segments" :key="index">
        <line class="edge-soft" :x1="segment.start.x" :y1="segment.start.y" :x2="segment.end.x" :y2="segment.end.y" :style="{ opacity: featherStrength(segment.sample) }" />
        <line class="edge-hard" :x1="segment.start.x" :y1="segment.start.y" :x2="segment.end.x" :y2="segment.end.y" :style="{ opacity: 1 - featherStrength(segment.sample) }" />
        <line v-if="hover && brushSamples.has(segment.sample)" class="edge-brushed" :x1="segment.start.x" :y1="segment.start.y" :x2="segment.end.x" :y2="segment.end.y" />
      </g>
      <g v-if="hover && outline.closed" class="brush-cursor">
        <line :x1="hover.pointerX" :y1="hover.pointerY" :x2="hover.x" :y2="hover.y" />
        <circle :cx="hover.pointerX" :cy="hover.pointerY" r="4.5" />
        <circle class="edge-dot" :cx="hover.x" :cy="hover.y" r="2" />
      </g>
      <text v-if="!outline.closed" x="100" y="66">OPEN PATH CANNOT MASK</text>
      <text v-if="!outline.closed" class="hint" x="100" y="80">Close the path in Motion first</text>
    </svg>
    <div class="paint-hint"><span><i class="soft" /> Feathered</span><span><i /> Hard cut</span><kbd>Shift</kbd><small>temporary hard brush</small></div>
  </div>
</template>

<style scoped>
.mask-edge-painter { display: grid; gap: 5px; }.paint-toolbar { display: flex; align-items: center; gap: 3px; }.paint-toolbar button { display: flex; height: 21px; align-items: center; gap: 4px; padding: 0 6px; color: var(--text-muted); background: #20232b; border: 1px solid #353a46; border-radius: 3px; font: inherit; font-size: 7.5px; cursor: pointer; white-space: nowrap; }.paint-toolbar button:hover { color: var(--text-primary); border-color: #596173; }.paint-toolbar button.active { color: #e5e9ff; background: var(--bg-selected); border-color: var(--accent-border); }.paint-toolbar button svg { flex: 0 0 auto; }.paint-toolbar label { display: flex; min-width: 0; flex: 1; align-items: center; justify-content: flex-end; gap: 4px; margin-left: 2px; color: var(--text-muted); font-size: 7px; white-space: nowrap; }.paint-toolbar input { width: 43px; min-width: 0; accent-color: var(--focus); }
.edge-canvas { width: 100%; height: 112px; overflow: hidden; background: #101219; border: 1px solid #343946; border-radius: 3px; cursor: crosshair; touch-action: none; user-select: none; }.edge-canvas.disabled { cursor: default; }.shape-fill { fill: rgb(104 117 208 / .055); stroke: none; }
.edge-soft { stroke: #99a6ff; stroke-width: 8; stroke-linecap: round; filter: url(#mask-edge-blur); }.edge-hard { stroke: #f1f4ff; stroke-width: 1.4; stroke-linecap: butt; }.edge-brushed { stroke: #edc68b; stroke-width: 10; stroke-linecap: round; opacity: .16; }
.brush-cursor { fill: none; stroke: #e0e7ff; stroke-width: .9; pointer-events: none; }.brush-cursor line { stroke: rgb(224 231 255 / .45); stroke-dasharray: 2 2; }.brush-cursor .edge-dot { fill: #edc68b; stroke: none; }text { fill: #8b92a4; font-size: 6.5px; font-weight: 650; letter-spacing: .06em; text-anchor: middle; pointer-events: none; }.hint { fill: #555c69; font-size: 5.8px; font-weight: 500; letter-spacing: 0; }.paint-hint { display: flex; height: 15px; align-items: center; gap: 4px; color: var(--text-muted); font-size: 6.5px; }.paint-hint span { display: flex; align-items: center; gap: 3px; }.paint-hint i { width: 9px; height: 1.5px; background: #f1f4ff; }.paint-hint i.soft { height: 5px; background: #99a6ff; border-radius: 2px; filter: blur(1.2px); }.paint-hint kbd { margin-left: auto; padding: 1px 3px; color: #afb7d7; background: #20232b; border: 1px solid #3a404d; border-radius: 2px; font: inherit; }.paint-hint small { color: #555c69; font-size: 6.5px; }
</style>
