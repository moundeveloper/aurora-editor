<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Camera, Diamond, KeyRound, Magnet, Pause, Play, SkipBack, SkipForward, Spline, Sun, Trash2, ZoomIn, ZoomOut } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { influenceParameters } from '@/engine/scene3d/influences'
import type { AnimatableProperty, Keyframe } from '@/models/editor'
import IconButton from './common/IconButton.vue'

const LABEL_WIDTH = 220
const store = useEditorStore()
const { project, currentTime, playing, autoKey, snap, selectedSceneEntity, selectedSceneEntityId, selectedKeyframeId } = storeToRefs(store)
const timelineZoom = ref(100)
const viewport = ref<HTMLElement>()
const rulerLane = ref<HTMLElement>()
const viewportWidth = ref(900)
const selectedChannelId = ref<string | null>(null)
const isScrubbing = ref(false)
const isPanning = ref(false)
let resizeObserver: ResizeObserver | null = null
let panState: { startX: number; startY: number; scrollLeft: number; scrollTop: number } | null = null

interface ChannelRow {
  id: string
  group: string
  label: string
  suffix: string
  color: string
  property: AnimatableProperty<number>
  groupStart: boolean
}

interface KeyframeDragState {
  row: ChannelRow
  keyframe: Keyframe<number>
  originalTime: number
  startX: number
  moved: boolean
}

let keyframeDrag: KeyframeDragState | null = null

const entity = computed(() => selectedSceneEntity.value?.value)
const entityIcon = computed(() => {
  const kind = selectedSceneEntity.value?.kind
  return kind === 'camera' ? Camera : kind === 'light' ? Sun : kind === 'path' ? Spline : Box
})
const channels = computed<ChannelRow[]>(() => {
  const selected = selectedSceneEntity.value
  if (!selected) return []
  const rows: ChannelRow[] = []
  const colors = { x: '#df7886', y: '#6bb88f', z: '#7998e4' }
  ;(['position', 'rotation', 'scale'] as const).forEach((group) => {
    ;(['x', 'y', 'z'] as const).forEach((axis, index) => rows.push({
      id: selected.value.transform[group][axis].id,
      group,
      label: `${group[0]!.toUpperCase()}${group.slice(1)} ${axis.toUpperCase()}`,
      suffix: group === 'rotation' ? '°' : '',
      color: colors[axis],
      property: selected.value.transform[group][axis],
      groupStart: index === 0,
    }))
  })
  if (selected.kind === 'object') {
    ;(['metalness', 'roughness', 'opacity', 'emissiveIntensity'] as const).forEach((key, index) => rows.push({
      id: selected.value.material[key].id,
      group: 'material',
      label: key === 'emissiveIntensity' ? 'Emissive intensity' : `${key[0]!.toUpperCase()}${key.slice(1)}`,
      suffix: '', color: '#b69bd7', property: selected.value.material[key], groupStart: index === 0,
    }))
    ;(selected.value.influences ?? []).forEach((influence) => {
      influenceParameters(influence).forEach((parameter, index) => rows.push({
        id: parameter.property.id,
        group: `influence-${influence.id}`,
        label: `${influence.name} · ${parameter.definition.label}`,
        suffix: parameter.definition.suffix ?? '',
        color: influence.enabled ? '#8fd3b6' : '#5d6470',
        property: parameter.property,
        groupStart: index === 0,
      }))
    })
  } else if (selected.kind === 'camera') {
    rows.push({ id: selected.value.fov.id, group: 'camera', label: 'Field of view', suffix: '°', color: '#8ca9e8', property: selected.value.fov, groupStart: true })
    const constraint = selected.value.pathConstraint
    if (constraint) {
      rows.push({ id: constraint.progress.id, group: 'path', label: 'Path progress', suffix: '', color: '#7ee0c0', property: constraint.progress, groupStart: true })
      rows.push({ id: constraint.bank.id, group: 'path', label: 'Path bank', suffix: '°', color: '#7ee0c0', property: constraint.bank, groupStart: false })
      ;(['x', 'y', 'z'] as const).forEach((axis) => rows.push({
        id: constraint.offset[axis].id,
        group: 'path',
        label: `Path offset ${axis.toUpperCase()}`,
        suffix: '',
        color: colors[axis],
        property: constraint.offset[axis],
        groupStart: false,
      }))
    }
  } else if (selected.kind === 'light') {
    rows.push({ id: selected.value.intensity.id, group: 'light', label: 'Intensity', suffix: '', color: '#d3aa72', property: selected.value.intensity, groupStart: true })
  }
  return rows
})
const laneWidth = computed(() => {
  const fit = Math.max(360, viewportWidth.value - LABEL_WIDTH)
  return Math.max(fit, fit * timelineZoom.value / 100)
})
const contentStyle = computed(() => ({ width: `${LABEL_WIDTH + laneWidth.value}px` }))
const playheadStyle = computed(() => ({ left: `${LABEL_WIDTH + laneWidth.value * (currentTime.value / project.value.duration)}px` }))
const ticks = computed(() => {
  const count = Math.max(6, Math.min(36, Math.round(10 * timelineZoom.value / 100)))
  return Array.from({ length: count + 1 }, (_, index) => {
    const time = index * project.value.duration / count
    return { time, left: `${time / project.value.duration * 100}%`, label: `${Math.floor(time / 60)}:${String(Math.floor(time) % 60).padStart(2, '0')}` }
  })
})
const timecode = computed(() => {
  const frames = Math.round(currentTime.value * project.value.frameRate)
  return `${currentTime.value.toFixed(2)}s · ${frames}f`
})

function channelValue(row: ChannelRow) {
  const value = evaluateNumericProperty(row.property, currentTime.value)
  return `${Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2)}${row.suffix}`
}

function keyframeStyle(time: number) {
  return { left: `${Math.max(0, Math.min(100, time / project.value.duration * 100))}%` }
}

function isAtPlayhead(row: ChannelRow) {
  const tolerance = (0.5 / project.value.frameRate) + 0.0001
  return row.property.keyframes.some((keyframe) => Math.abs(keyframe.time - currentTime.value) <= tolerance)
}

function toggleChannelKey(row: ChannelRow) {
  selectedChannelId.value = row.id
  store.toggle3DKeyframe(row.id)
}

/** Keeps the time under the cursor pinned while the lane grows or shrinks, like the Motion timeline. */
async function setTimelineZoom(nextZoom: number, anchorClientX?: number) {
  const element = viewport.value
  const previousLaneWidth = laneWidth.value
  const clamped = Math.max(100, Math.min(800, Math.round(nextZoom)))
  if (!element || clamped === timelineZoom.value) return
  const bounds = element.getBoundingClientRect()
  const localX = anchorClientX === undefined ? Math.max(LABEL_WIDTH, bounds.width / 2) : anchorClientX - bounds.left
  const timeRatio = Math.max(0, (element.scrollLeft + localX - LABEL_WIDTH) / previousLaneWidth)
  timelineZoom.value = clamped
  await nextTick()
  element.scrollLeft = Math.max(0, LABEL_WIDTH + timeRatio * laneWidth.value - localX)
}

function onWheel(event: WheelEvent) {
  if (!event.ctrlKey) return
  event.preventDefault()
  const direction = event.deltaY < 0 ? 1 : -1
  void setTimelineZoom(timelineZoom.value + direction * Math.max(5, Math.round(timelineZoom.value * .1)), event.clientX)
}

function beginPan(event: PointerEvent) {
  if (event.button !== 1 || !viewport.value) return
  event.preventDefault()
  isPanning.value = true
  panState = {
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: viewport.value.scrollLeft,
    scrollTop: viewport.value.scrollTop,
  }
}

function timeAtClientX(clientX: number) {
  const bounds = rulerLane.value?.getBoundingClientRect()
  if (!bounds) return currentTime.value
  const raw = ((clientX - bounds.left) / bounds.width) * project.value.duration
  const time = snap.value ? Math.round(raw * project.value.frameRate) / project.value.frameRate : raw
  return Math.max(0, Math.min(project.value.duration, time))
}

function beginScrub(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  isScrubbing.value = true
  store.setTime(timeAtClientX(event.clientX))
}

function selectKeyframe(row: ChannelRow, keyframe: Keyframe<number>) {
  store.setTime(keyframe.time)
  selectedChannelId.value = row.id
  selectedKeyframeId.value = keyframe.id
}

function beginKeyframeDrag(event: PointerEvent, row: ChannelRow, keyframe: Keyframe<number>) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  selectKeyframe(row, keyframe)
  keyframeDrag = { row, keyframe, originalTime: keyframe.time, startX: event.clientX, moved: false }
}

function onPointerMove(event: PointerEvent) {
  if (panState && viewport.value) {
    viewport.value.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX)
    viewport.value.scrollTop = panState.scrollTop - (event.clientY - panState.startY)
    return
  }
  if (isScrubbing.value) {
    store.setTime(timeAtClientX(event.clientX))
    return
  }
  if (!keyframeDrag) return
  const deltaTime = ((event.clientX - keyframeDrag.startX) / laneWidth.value) * project.value.duration
  let nextTime = keyframeDrag.originalTime + deltaTime
  if (snap.value) nextTime = Math.round(nextTime * project.value.frameRate) / project.value.frameRate
  keyframeDrag.keyframe.time = Math.max(0, Math.min(project.value.duration, nextTime))
  currentTime.value = keyframeDrag.keyframe.time
  keyframeDrag.moved ||= Math.abs(event.clientX - keyframeDrag.startX) > 2
}

function endPointerInteraction() {
  panState = null
  isPanning.value = false
  isScrubbing.value = false
  if (keyframeDrag?.moved) store.move3DKeyframe(keyframeDrag.row.id, keyframeDrag.keyframe.id, keyframeDrag.keyframe.time)
  keyframeDrag = null
}

function deleteSelectedKeyframe() {
  if (!selectedChannelId.value || !selectedKeyframeId.value) return
  store.delete3DKeyframe(selectedChannelId.value, selectedKeyframeId.value)
}

function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.matches('input, textarea')) return
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelectedKeyframe()
  }
}

onMounted(async () => {
  await nextTick()
  if (viewport.value) {
    resizeObserver = new ResizeObserver(([entry]) => { if (entry) viewportWidth.value = entry.contentRect.width })
    resizeObserver.observe(viewport.value)
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endPointerInteraction)
  window.addEventListener('pointercancel', endPointerInteraction)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endPointerInteraction)
  window.removeEventListener('pointercancel', endPointerInteraction)
  window.removeEventListener('keydown', onKeydown)
})

watch(selectedSceneEntityId, () => {
  selectedChannelId.value = null
  selectedKeyframeId.value = null
})
watch(selectedKeyframeId, (keyframeId) => {
  if (!keyframeId) return
  const row = channels.value.find((channel) => channel.property.keyframes.some((keyframe) => keyframe.id === keyframeId))
  if (row) selectedChannelId.value = row.id
})
</script>

<template>
  <section class="three-timeline">
    <header class="timeline-toolbar">
      <span class="panel-title"><component :is="entityIcon" :size="12" /><strong>3D Timeline</strong><small v-if="entity" :title="entity.name">{{ entity.name }}</small></span>
      <span class="divider" />
      <button class="auto-key" type="button" :class="{ active: autoKey }" @click="autoKey = !autoKey"><span /> Auto Key</button>
      <button type="button" class="key-all" :disabled="!entity" title="Key all transform channels at the playhead" @click="store.keySelected3DTransform()"><KeyRound :size="11" /> Key transforms</button>
      <button type="button" class="delete-key" :disabled="!selectedKeyframeId" title="Delete selected keyframe" @click="deleteSelectedKeyframe"><Trash2 :size="11" /></button>
      <span class="toolbar-spacer" />
      <IconButton :icon="SkipBack" label="Previous frame" @click="store.stepFrame(-1)" />
      <IconButton :icon="playing ? Pause : Play" :label="playing ? 'Pause' : 'Play'" :active="playing" @click="store.togglePlayback()" />
      <IconButton :icon="SkipForward" label="Next frame" @click="store.stepFrame(1)" />
      <span class="timecode">{{ timecode }}</span>
      <button class="snap-button" type="button" :class="{ active: snap }" title="Snap to frames" @click="snap = !snap"><Magnet :size="11" /></button>
      <IconButton :icon="ZoomOut" label="Zoom timeline out" @click="setTimelineZoom(timelineZoom - 20)" />
      <input :value="timelineZoom" class="zoom-slider" type="range" min="100" max="800" step="5" aria-label="Timeline zoom" @input="setTimelineZoom(Number(($event.target as HTMLInputElement).value))" />
      <IconButton :icon="ZoomIn" label="Zoom timeline in" @click="setTimelineZoom(timelineZoom + 20)" />
      <span class="zoom-value">{{ timelineZoom }}%</span>
    </header>

    <div ref="viewport" class="timeline-scroll" :class="{ panning: isPanning }" @wheel="onWheel" @pointerdown="beginPan">
      <div class="timeline-content" :style="contentStyle">
        <div class="ruler-row">
          <div class="ruler-label"><span>CHANNEL</span><span>VALUE</span></div>
          <div ref="rulerLane" class="ruler-lane" @pointerdown="beginScrub">
            <span v-for="tick in ticks" :key="tick.time" class="tick" :style="{ left: tick.left }"><i />{{ tick.label }}</span>
          </div>
        </div>

        <div v-if="channels.length" class="channel-list">
          <div v-for="row in channels" :key="row.id" class="channel-row" :class="{ 'group-start': row.groupStart, animated: row.property.animated }">
            <div class="channel-label">
              <button type="button" :class="{ keyed: isAtPlayhead(row), animated: row.property.animated }" :title="`Toggle ${row.label} keyframe`" @click="toggleChannelKey(row)"><Diamond :size="9" :fill="isAtPlayhead(row) ? 'currentColor' : 'none'" /></button>
              <i :style="{ backgroundColor: row.color }" />
              <span :title="row.label">{{ row.label }}</span>
              <strong>{{ channelValue(row) }}</strong>
            </div>
            <div class="channel-lane" @pointerdown="beginScrub">
              <button
                v-for="keyframe in row.property.keyframes"
                :key="keyframe.id"
                type="button"
                class="keyframe"
                :class="{ selected: selectedKeyframeId === keyframe.id }"
                :style="keyframeStyle(keyframe.time)"
                :title="`${row.label} · ${keyframe.time.toFixed(2)}s · ${keyframe.value.toFixed(2)}${row.suffix}`"
                @pointerdown="beginKeyframeDrag($event, row, keyframe)"
              ><Diamond :size="10" fill="currentColor" /></button>
            </div>
          </div>
        </div>
        <div v-else class="empty-timeline"><Box :size="18" /><strong>No 3D entity selected</strong><span>Select an object, camera, light, or path to animate its properties.</span></div>
        <div class="playhead" :style="playheadStyle"><span /><i /></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.three-timeline { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: #101217; }.timeline-toolbar { display: flex; height: 31px; flex: 0 0 auto; align-items: center; gap: 3px; padding: 0 6px; color: var(--text-muted); background: #17191f; border-bottom: 1px solid var(--border-subtle); }.panel-title { display: flex; min-width: 170px; max-width: 280px; align-items: center; gap: 5px; color: var(--text-secondary); }.panel-title strong { font-size: 9px; white-space: nowrap; }.panel-title small { overflow: hidden; color: var(--text-muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.divider { width: 1px; height: 18px; margin: 0 3px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.timeline-toolbar button:not(.icon-button) { display: inline-flex; height: 22px; align-items: center; justify-content: center; gap: 4px; padding: 0 6px; color: var(--text-muted); background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; white-space: nowrap; }.timeline-toolbar button:not(.icon-button):hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }.timeline-toolbar button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.timeline-toolbar button:disabled { opacity: .4; cursor: default; }.auto-key > span { width: 6px; height: 6px; background: #50545e; border-radius: 50%; }.auto-key.active > span { background: #df7886; box-shadow: 0 0 0 2px rgb(223 120 134 / .16); }.key-all { color: #bcc6ff !important; }.delete-key { width: 23px; padding: 0 !important; }.timecode { min-width: 75px; color: #c9cedc; font-size: 8px; font-variant-numeric: tabular-nums; text-align: center; }.zoom-value { width: 30px; font-size: 7.5px; text-align: center; }.zoom-slider { width: 72px; height: 2px; accent-color: var(--button-accent); }
.timeline-scroll { min-height: 0; flex: 1; overflow: auto; background: #0d0f14; }.timeline-scroll.panning { cursor: grabbing; user-select: none; }.timeline-content { position: relative; min-height: 100%; }.ruler-row, .channel-row { display: grid; grid-template-columns: 220px 1fr; }.ruler-row { position: sticky; z-index: 7; top: 0; height: 25px; background: #15171d; border-bottom: 1px solid var(--border-strong); }.ruler-label, .channel-label { position: sticky; z-index: 5; left: 0; display: flex; min-width: 0; align-items: center; background: #17191f; border-right: 1px solid var(--border-strong); }.ruler-label { justify-content: space-between; padding: 0 9px 0 28px; color: #707684; font-size: 6.5px; font-weight: 650; letter-spacing: .08em; }.ruler-lane { position: relative; overflow: hidden; cursor: ew-resize; background: #12141a; }.tick { position: absolute; top: 3px; color: #777d8a; font-size: 6.5px; font-variant-numeric: tabular-nums; transform: translateX(-1px); pointer-events: none; }.tick i { display: block; width: 1px; height: 8px; margin-bottom: 1px; background: #454a56; }.channel-row { height: 23px; border-bottom: 1px solid #20232a; }.channel-row.group-start:not(:first-child) { border-top: 1px solid #383d49; }.channel-row.animated .channel-label { background: #191c26; }.channel-label { gap: 5px; padding: 0 7px; }.channel-label > button { display: grid; width: 17px; height: 17px; flex: 0 0 auto; place-items: center; padding: 0; color: #555b68; background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.channel-label > button:hover { color: #cbd3ff; background: var(--bg-hover); }.channel-label > button.animated { color: #8796dc; }.channel-label > button.keyed { color: #e1e6ff; background: var(--bg-selected); }.channel-label > i { width: 5px; height: 5px; flex: 0 0 auto; border-radius: 50%; }.channel-label > span { overflow: hidden; flex: 1; color: var(--text-secondary); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.channel-label > strong { color: #9298a7; font-size: 7.5px; font-weight: 500; font-variant-numeric: tabular-nums; }.channel-lane { position: relative; overflow: hidden; cursor: ew-resize; background-color: #0f1116; background-image: linear-gradient(90deg, #20232a 1px, transparent 1px); background-size: calc(100% / 10) 100%; }.channel-row:nth-child(even) .channel-lane { background-color: #111319; }.keyframe { position: absolute; z-index: 4; top: 50%; display: grid; width: 16px; height: 16px; place-items: center; padding: 0; color: #9aa8ff; background: transparent; border: 0; transform: translate(-50%, -50%); cursor: ew-resize; }.keyframe:hover { color: #d7ddff; }.keyframe.selected { color: #f0d39b; filter: drop-shadow(0 0 3px rgb(226 187 113 / .45)); }.playhead { position: absolute; z-index: 6; top: 0; bottom: 0; width: 1px; background: #e3ae72; pointer-events: none; }.playhead span { position: absolute; top: 0; left: -4px; width: 9px; height: 7px; background: #e3ae72; clip-path: polygon(0 0, 100% 0, 50% 100%); }.playhead i { position: absolute; top: 7px; bottom: 0; width: 1px; background: rgb(227 174 114 / .7); }.empty-timeline { position: absolute; inset: 25px 0 0 220px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 4px; color: var(--text-muted); }.empty-timeline strong { color: var(--text-secondary); font-size: 9px; }.empty-timeline span { font-size: 7.5px; }
</style>
