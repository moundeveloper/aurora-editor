<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EditorLayer } from '@/models/editor'
import { shapeOutline } from '@/engine/shapes/shapeGeometry'

const props = defineProps<{ shape: EditorLayer; segmentFeather: number[]; selected: number | null }>()
const emit = defineEmits<{ 'update:selected': [value: number | null]; feather: [segment: number, value: number] }>()

const VIEW_WIDTH = 200
const VIEW_HEIGHT = 140
const hovered = ref<number | null>(null)
let dragging: number | null = null

/** Outline in view space, plus the scale used to get there so feather widths can be drawn to size. */
const outline = computed(() => {
  const source = shapeOutline(props.shape, 16)
  if (!source.points.length) return null
  const xs = source.points.map((point) => point[0])
  const ys = source.points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = Math.min(150 / Math.max(1, maxX - minX), 88 / Math.max(1, maxY - minY))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return {
    scale,
    closed: source.closed,
    segmentCount: source.segmentCount,
    segmentIndex: source.segmentIndex,
    points: source.points.map(([x, y]) => ({ x: VIEW_WIDTH / 2 + (x - centerX) * scale, y: VIEW_HEIGHT / 2 + (y - centerY) * scale })),
  }
})

/** One polyline per mask segment, closed back onto the next segment's first point so there are no gaps. */
const segments = computed(() => {
  const data = outline.value
  if (!data?.closed) return []
  return Array.from({ length: data.segmentCount }, (_, segment) => {
    const own = data.points.filter((_, index) => data.segmentIndex[index] === segment)
    const lastIndex = data.segmentIndex.lastIndexOf(segment)
    const next = data.points[(lastIndex + 1) % data.points.length]
    const points = next ? [...own, next] : own
    return { segment, points, path: points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ') }
  }).filter((entry) => entry.points.length > 1)
})

const fillPath = computed(() => {
  const data = outline.value
  if (!data?.closed) return ''
  return `${data.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} Z`
})

const featherOf = (segment: number) => Math.max(0, props.segmentFeather[segment] ?? 0)

/**
 * One edge of the feather band, offset along the segment's normal. The fade straddles the outline,
 * so the band runs half a width to either side and `side` picks which one to draw.
 */
function featherGuide(segment: number, side: 1 | -1) {
  const data = outline.value
  const entry = segments.value.find((item) => item.segment === segment)
  if (!data || !entry) return ''
  const offset = featherOf(segment) * data.scale / 2 * side
  if (Math.abs(offset) < .5) return ''
  const centerX = data.points.reduce((total, point) => total + point.x, 0) / data.points.length
  const centerY = data.points.reduce((total, point) => total + point.y, 0) / data.points.length
  return entry.points.map((point, index) => {
    const previous = entry.points[Math.max(0, index - 1)]!
    const next = entry.points[Math.min(entry.points.length - 1, index + 1)]!
    const tangentX = next.x - previous.x
    const tangentY = next.y - previous.y
    const length = Math.hypot(tangentX, tangentY) || 1
    let normalX = -tangentY / length
    let normalY = tangentX / length
    // Point the normal at the shape's interior so the guide sits inside, where the fade happens.
    if ((centerX - point.x) * normalX + (centerY - point.y) * normalY < 0) {
      normalX = -normalX
      normalY = -normalY
    }
    return `${index ? 'L' : 'M'} ${(point.x + normalX * offset).toFixed(2)} ${(point.y + normalY * offset).toFixed(2)}`
  }).join(' ')
}

/**
 * The viewBox is letterboxed inside the element, so scaling the client offset by the element's own
 * rectangle drifts from the pointer as the sidebar resizes. The screen CTM is the only conversion
 * that survives preserveAspectRatio.
 */
function viewPoint(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement
  const matrix = svg.getScreenCTM()
  const bounds = svg.getBoundingClientRect()
  if (!matrix || typeof DOMPoint === 'undefined') {
    return { x: (event.clientX - bounds.left) * (VIEW_WIDTH / bounds.width), y: (event.clientY - bounds.top) * (VIEW_HEIGHT / bounds.height) }
  }
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

function distanceToSegment(x: number, y: number, entry: { points: { x: number; y: number }[] }) {
  let nearest = Infinity
  for (let index = 0; index < entry.points.length - 1; index += 1) {
    const start = entry.points[index]!
    const end = entry.points[index + 1]!
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const lengthSquared = deltaX ** 2 + deltaY ** 2
    const amount = lengthSquared ? Math.max(0, Math.min(1, ((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared)) : 0
    nearest = Math.min(nearest, Math.hypot(x - (start.x + deltaX * amount), y - (start.y + deltaY * amount)))
  }
  return nearest
}

function nearestSegment(event: PointerEvent) {
  const { x, y } = viewPoint(event)
  return segments.value.reduce<{ segment: number; distance: number } | null>((best, entry) => {
    const distance = distanceToSegment(x, y, entry)
    return !best || distance < best.distance ? { segment: entry.segment, distance } : best
  }, null)
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const nearest = nearestSegment(event)
  if (!nearest) return
  event.preventDefault()
  event.stopPropagation()
  emit('update:selected', nearest.segment)
  dragging = nearest.segment
  ;(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  const data = outline.value
  if (dragging === null) {
    hovered.value = nearestSegment(event)?.segment ?? null
    return
  }
  const entry = segments.value.find((item) => item.segment === dragging)
  if (!entry || !data) return
  event.preventDefault()
  const { x, y } = viewPoint(event)
  // The pointer tracks the edge of the band, which sits half a width out, so the width is twice it.
  emit('feather', dragging, Math.round(distanceToSegment(x, y, entry) / data.scale * 2))
}

function onPointerUp(event: PointerEvent) {
  dragging = null
  const svg = event.currentTarget as SVGSVGElement
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
}

function strokeWidth(segment: number) {
  const data = outline.value
  if (!data) return 1.6
  // Hard segments stay hairline; a feathered one thickens with its width so the two never read alike.
  return featherOf(segment) < .5 ? 1.6 : Math.min(7, 2.4 + featherOf(segment) * data.scale * .35)
}
</script>

<template>
  <div class="mask-edge-painter">
    <svg
      class="edge-canvas"
      :class="{ disabled: !outline?.closed }"
      :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
      role="img"
      :aria-label="`Select a segment of ${shape.name} to feather`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="dragging === null && (hovered = null)"
    >
      <path v-if="outline?.closed" class="shape-fill" :d="fillPath" />
      <template v-for="entry in segments" :key="entry.segment">
        <path
          v-for="side in ([1, -1] as const)"
          v-show="featherOf(entry.segment) >= .5"
          :key="`${entry.segment}-${side}`"
          class="feather-guide"
          :class="{ active: selected === entry.segment }"
          :d="featherGuide(entry.segment, side)"
        />
      </template>
      <path
        v-for="entry in segments"
        :key="`edge-${entry.segment}`"
        class="edge"
        :class="{
          hard: featherOf(entry.segment) < .5,
          hovered: hovered === entry.segment,
          selected: selected === entry.segment,
        }"
        :d="entry.path"
        :stroke-width="strokeWidth(entry.segment)"
      />
      <text v-if="!outline?.closed" :x="VIEW_WIDTH / 2" y="66">OPEN PATH CANNOT MASK</text>
      <text v-if="!outline?.closed" class="hint" :x="VIEW_WIDTH / 2" y="80">Close the path in Motion first</text>
    </svg>
    <div class="paint-hint">
      <span><i class="hard" /> Hard</span>
      <span><i /> Feathered</span>
      <small>Click a segment · drag away from it to set feather</small>
    </div>
  </div>
</template>

<style scoped>
.mask-edge-painter { display: grid; gap: 5px; }
.edge-canvas { width: 100%; height: 118px; overflow: hidden; background: #101219; border: 1px solid #343946; border-radius: 3px; cursor: crosshair; touch-action: none; user-select: none; }.edge-canvas.disabled { cursor: default; }
.shape-fill { fill: rgb(104 117 208 / .07); stroke: none; }
.edge { fill: none; stroke: #7f8bd6; stroke-linecap: round; stroke-linejoin: round; transition: stroke 80ms linear; }
.edge.hard { stroke: #f1f4ff; }
.edge.hovered { stroke: #aab4ff; }
.edge.selected { stroke: #edc68b; }
.feather-guide { fill: none; stroke: rgb(127 139 214 / .5); stroke-width: .9; stroke-dasharray: 3 2.5; stroke-linejoin: round; }.feather-guide.active { stroke: rgb(237 198 139 / .8); }
text { fill: #8b92a4; font-size: 6.5px; font-weight: 650; letter-spacing: .06em; text-anchor: middle; pointer-events: none; }.hint { fill: #555c69; font-size: 5.8px; font-weight: 500; letter-spacing: 0; }
.paint-hint { display: flex; height: 15px; align-items: center; gap: 5px; color: var(--text-muted); font-size: 6.5px; }.paint-hint span { display: flex; align-items: center; gap: 3px; }.paint-hint i { width: 9px; height: 4px; background: #7f8bd6; border-radius: 2px; }.paint-hint i.hard { height: 1.5px; background: #f1f4ff; border-radius: 0; }.paint-hint small { margin-left: auto; color: #555c69; font-size: 6.5px; }
</style>
