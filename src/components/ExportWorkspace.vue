<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Check, CircleCheck, Download, Film, FolderOpen, Gauge, GripVertical, HardDrive, Info, Loader, MonitorUp, MoveHorizontal, Play, TriangleAlert, X } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { estimateGifBytes, gifExportSize, gifFrameCount, MAX_GIF_FRAMES } from '@/engine/rendering/gifPlan'
import NumberField from './common/NumberField.vue'
import MSelect, { type MSelectOption } from './common/MSelect.vue'
import ExportRangePreview from './ExportRangePreview.vue'
import {
  videoBitrate, videoExportSize, videoExportSupported, videoFrameCount,
} from '@/engine/rendering/videoExport'

type ExportFormat = 'video' | 'gif'

const store = useEditorStore()
const { project, layers, exportProgress, exportStatus, exportMessage } = storeToRefs(store)
const filename = ref(`${project.value.name.replace(/\W+/g, '_')}_Final`)
const format = ref<ExportFormat>('video')
const videoWidth = ref(project.value.width)
const videoFrameRate = ref(Math.round(project.value.frameRate))
const videoQuality = ref<'web' | 'high' | 'master'>('web')
const videoCodec = ref<'vp9' | 'av1'>('vp9')
const gifWidth = ref(Math.min(640, project.value.width))
const gifFrameRate = ref(Math.min(15, Math.round(project.value.frameRate)))
const gifColors = ref(128)
const gifLoop = ref(true)
const renderRange = ref<'entire' | 'custom'>('entire')
const rangeStart = ref(0)
const rangeEnd = ref(project.value.duration)
const previewTime = ref(0)
const previewLabel = ref('In')
const rangeTrack = ref<HTMLElement>()
const videoCodecOptions: MSelectOption[] = [
  { value: 'vp9', label: 'VP9' },
  { value: 'av1', label: 'AV1 · smaller, slower' },
]
const videoQualityOptions: MSelectOption[] = [
  { value: 'web', label: 'Web' },
  { value: 'high', label: 'High' },
  { value: 'master', label: 'Master' },
]
const rangeOptions: MSelectOption[] = [
  { value: 'entire', label: 'Entire composition' },
  { value: 'custom', label: 'Custom in / out' },
]
const selectedStart = computed(() => renderRange.value === 'entire' ? 0 : rangeStart.value)
const selectedEnd = computed(() => renderRange.value === 'entire' ? project.value.duration : rangeEnd.value)
const selectedDuration = computed(() => Math.max(1 / project.value.frameRate, selectedEnd.value - selectedStart.value))
const totalFrames = computed(() => Math.max(1, Math.ceil(selectedDuration.value * project.value.frameRate)))
const startFrame = computed(() => Math.round(selectedStart.value * project.value.frameRate))
const endFrame = computed(() => startFrame.value + totalFrames.value - 1)
const rangeSelectionStyle = computed(() => ({ left: `${selectedStart.value / project.value.duration * 100}%`, width: `${selectedDuration.value / project.value.duration * 100}%` }))
const scrubberStyle = computed(() => ({ left: `${previewTime.value / project.value.duration * 100}%` }))
const timelineTicks = computed(() => Array.from({ length: 6 }, (_, index) => ({ left: index * 20, time: project.value.duration * index / 5 })))
const exportTimelineLayers = computed(() => layers.value.filter((layer) => !layer.isPlaceholder).slice(0, 5))
let rangeDrag: { mode: 'start' | 'end' | 'range'; startX: number; initialStart: number; initialEnd: number } | null = null
let scrubbing = false

interface ExportPreset {
  id: string
  format: ExportFormat
  icon: typeof Film
  title: string
  detail: string
  quality?: 'web' | 'high' | 'master'
  codec?: 'vp9' | 'av1'
  maxWidth?: number
}

const presets: ExportPreset[] = [
  { id: 'web', format: 'video', icon: Film, title: 'Web · VP9', detail: 'WebM, balanced bitrate', quality: 'web', codec: 'vp9' },
  { id: 'master', format: 'video', icon: MonitorUp, title: 'Master · VP9', detail: 'WebM, archive bitrate', quality: 'master', codec: 'vp9' },
  { id: 'social', format: 'video', icon: Play, title: 'Social · 1080 wide', detail: 'WebM, capped at 1080px', quality: 'high', codec: 'vp9', maxWidth: 1080 },
  { id: 'av1', format: 'video', icon: MonitorUp, title: 'AV1 · Smallest file', detail: 'WebM, slower to encode', quality: 'high', codec: 'av1' },
  { id: 'gif', format: 'gif', icon: Play, title: 'Loop · Animated GIF', detail: 'Rendered in the browser' },
]
const activePreset = ref('web')

function choosePreset(preset: ExportPreset) {
  activePreset.value = preset.id
  format.value = preset.format
  if (preset.quality) videoQuality.value = preset.quality
  if (preset.codec) videoCodec.value = preset.codec
  videoWidth.value = Math.min(project.value.width, preset.maxWidth ?? project.value.width)
}

const gifSize = computed(() => gifExportSize(project.value, gifWidth.value))
const gifFrames = computed(() => gifFrameCount(selectedDuration.value, gifFrameRate.value))
/** The cap bites on long compositions, and a GIF that silently stopped early would be a bug report. */
const gifTruncated = computed(() => selectedDuration.value * gifFrameRate.value > MAX_GIF_FRAMES)
const gifEstimate = computed(() => `${(estimateGifBytes(gifSize.value.width, gifSize.value.height, gifFrames.value) / 1024 / 1024).toFixed(1)} MB`)
const gifDuration = computed(() => (gifFrames.value / Math.max(1, gifFrameRate.value)).toFixed(1))
const rendering = computed(() => exportStatus.value === 'rendering')
const videoSize = computed(() => videoExportSize(project.value, videoWidth.value))
const videoFrames = computed(() => videoFrameCount(selectedDuration.value, videoFrameRate.value))
const videoEstimate = computed(() => {
  const bits = videoBitrate(videoSize.value.width, videoSize.value.height, videoFrameRate.value, videoQuality.value)
  return `${((bits / 8) * (videoFrames.value / Math.max(1, videoFrameRate.value)) / 1024 / 1024).toFixed(1)} MB`
})
const videoUnavailable = computed(() => !videoExportSupported())

function formatTime(time: number) {
  const clamped = Math.max(0, time)
  const minutes = Math.floor(clamped / 60)
  const seconds = Math.floor(clamped % 60)
  const frames = Math.min(Math.round(project.value.frameRate) - 1, Math.floor((clamped % 1) * project.value.frameRate))
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

function snapTime(time: number) {
  return Math.round(time * project.value.frameRate) / project.value.frameRate
}

function setRangeMode(value: string) {
  renderRange.value = value === 'custom' ? 'custom' : 'entire'
  if (renderRange.value === 'entire') { rangeStart.value = 0; rangeEnd.value = project.value.duration; previewTime.value = 0; previewLabel.value = 'In' }
}

function setRangeBoundary(which: 'start' | 'end', value: number) {
  renderRange.value = 'custom'
  const minimum = 1 / project.value.frameRate
  if (which === 'start') rangeStart.value = Math.max(0, Math.min(snapTime(value), rangeEnd.value - minimum))
  else rangeEnd.value = Math.min(project.value.duration, Math.max(snapTime(value), rangeStart.value + minimum))
  previewTime.value = which === 'start' ? rangeStart.value : Math.max(rangeStart.value, rangeEnd.value - minimum)
  previewLabel.value = which === 'start' ? 'In' : 'Out'
  store.setTime(previewTime.value)
}

function timeAt(clientX: number) {
  const bounds = rangeTrack.value?.getBoundingClientRect()
  if (!bounds) return 0
  return snapTime(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * project.value.duration)
}

function beginRangeDrag(event: PointerEvent, mode: 'start' | 'end' | 'range') {
  event.preventDefault()
  event.stopPropagation()
  renderRange.value = 'custom'
  rangeDrag = { mode, startX: event.clientX, initialStart: selectedStart.value, initialEnd: selectedEnd.value }
  previewLabel.value = mode === 'end' ? 'Out' : mode === 'start' ? 'In' : 'Range'
  previewTime.value = mode === 'end' ? Math.max(selectedStart.value, selectedEnd.value - 1 / project.value.frameRate) : selectedStart.value
  store.setTime(previewTime.value)
  window.addEventListener('pointermove', moveRangeDrag)
  window.addEventListener('pointerup', endRangeDrag, { once: true })
}

function moveRangeDrag(event: PointerEvent) {
  if (!rangeDrag) return
  if (rangeDrag.mode === 'start') return setRangeBoundary('start', timeAt(event.clientX))
  if (rangeDrag.mode === 'end') return setRangeBoundary('end', timeAt(event.clientX))
  const bounds = rangeTrack.value?.getBoundingClientRect()
  if (!bounds) return
  const duration = rangeDrag.initialEnd - rangeDrag.initialStart
  const delta = snapTime((event.clientX - rangeDrag.startX) / bounds.width * project.value.duration)
  const start = Math.max(0, Math.min(project.value.duration - duration, rangeDrag.initialStart + delta))
  rangeStart.value = start
  rangeEnd.value = start + duration
  previewTime.value = start
  store.setTime(previewTime.value)
}

function endRangeDrag() {
  rangeDrag = null
  window.removeEventListener('pointermove', moveRangeDrag)
}

function scrubTo(clientX: number) {
  previewTime.value = timeAt(clientX)
  previewLabel.value = 'Frame'
  store.setTime(previewTime.value)
}

function beginScrub(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  scrubbing = true
  scrubTo(event.clientX)
  window.addEventListener('pointermove', moveScrub)
  window.addEventListener('pointerup', endScrub, { once: true })
}

function moveScrub(event: PointerEvent) {
  if (scrubbing) scrubTo(event.clientX)
}

function endScrub() {
  scrubbing = false
  window.removeEventListener('pointermove', moveScrub)
}

function stepPreview(direction: -1 | 1) {
  const frame = 1 / project.value.frameRate
  previewTime.value = Math.max(0, Math.min(project.value.duration, snapTime(previewTime.value + direction * frame)))
  previewLabel.value = 'Frame'
  store.setTime(previewTime.value)
}

watch(() => project.value.duration, (duration) => {
  rangeStart.value = Math.min(rangeStart.value, Math.max(0, duration - 1 / project.value.frameRate))
  rangeEnd.value = Math.max(rangeStart.value + 1 / project.value.frameRate, Math.min(rangeEnd.value, duration))
  if (renderRange.value === 'entire') rangeEnd.value = duration
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', moveRangeDrag)
  window.removeEventListener('pointermove', moveScrub)
})

function startRender() {
  if (format.value === 'video') {
    void store.exportVideo({
      filename: filename.value,
      maxWidth: videoWidth.value,
      frameRate: videoFrameRate.value,
      quality: videoQuality.value,
      codec: videoCodec.value,
      startTime: selectedStart.value,
      endTime: selectedEnd.value,
    })
    return
  }
  void store.exportGif({
    filename: filename.value,
    maxWidth: gifWidth.value,
    frameRate: gifFrameRate.value,
    colors: gifColors.value,
    loop: gifLoop.value,
    startTime: selectedStart.value,
    endTime: selectedEnd.value,
  })
}
</script>

<template>
  <section class="export-workspace">
    <div class="export-sidebar">
      <header><Download :size="15" /><strong>Deliver</strong></header>
      <button v-for="preset in presets" :key="preset.id" class="preset" :class="{ active: activePreset === preset.id }" type="button" @click="choosePreset(preset)">
        <span><component :is="preset.icon" :size="14" /></span>
        <div><strong>{{ preset.title }}</strong><small>{{ preset.detail }} · {{ preset.format === 'gif' ? `${gifSize.width} × ${gifSize.height}` : `${project.width} × ${project.height}` }}</small></div>
        <Check v-if="activePreset === preset.id" :size="12" />
      </button>
      <span class="sidebar-label">Recent renders</span>
      <div class="recent-render"><CircleCheck :size="13" /><span><strong>Horizon_v08.mp4</strong><small>Today · 284 MB</small></span></div>
    </div>
    <div class="export-form">
      <header><div><strong>Export project</strong><span>{{ project.name }} · {{ project.duration.toFixed(1) }} seconds</span></div><span class="capability" :class="{ warn: format === 'video' && videoUnavailable }"><CircleCheck :size="11" /> {{ format === 'gif' ? 'GIF encoder ready' : videoUnavailable ? 'No video encoder in this browser' : 'WebCodecs encoder ready' }}</span></header>
      <div class="export-scroll">
        <section><h3>Output</h3><div class="form-grid"><label>Filename</label><div class="field wide"><input v-model="filename" /><span>.{{ format === 'gif' ? 'gif' : 'webm' }}</span></div><label>Destination</label><button class="field wide" type="button"><FolderOpen :size="12" /> Downloads <span>Choose…</span></button></div></section>
        <section v-if="format === 'video'">
          <h3>Video</h3>
          <div class="form-grid">
            <label>Container</label><div class="field">WebM<span>Matroska</span></div>
            <label>Codec</label><MSelect :model-value="videoCodec" :options="videoCodecOptions" label="Video codec" @update:model-value="videoCodec = $event as 'vp9' | 'av1'" />
            <label>Width</label><div class="field"><NumberField :model-value="videoWidth" :min="64" :max="project.width" :step="16" label="Video width" @update:model-value="videoWidth = Math.round($event)" /><span>{{ videoSize.width }} × {{ videoSize.height }}</span></div>
            <label>Frame rate</label><div class="field"><NumberField :model-value="videoFrameRate" :min="1" :max="120" :step="1" label="Video frame rate" @update:model-value="videoFrameRate = Math.round($event)" /><span>fps</span></div>
            <label>Quality</label><MSelect :model-value="videoQuality" :options="videoQualityOptions" label="Video quality" @update:model-value="videoQuality = $event as 'web' | 'high' | 'master'" />
            <label>Frames</label><div class="field">{{ videoFrames }} · {{ (videoFrames / Math.max(1, videoFrameRate)).toFixed(1) }}s</div>
          </div>
          <p v-if="videoUnavailable" class="format-note"><TriangleAlert :size="11" /> This browser has no WebCodecs video encoder. Chrome, Edge, and Safari 17 or newer can export video; GIF works everywhere.</p>
          <p class="format-note"><Info :size="11" /> Frame timestamps come from the frame index, not the clock, so the file lasts exactly as long as the range however long the render takes. MP4 would need its own muxer and is not offered yet.</p>
        </section>
        <section v-if="format === 'gif'">
          <h3>Animated GIF</h3>
          <div class="form-grid">
            <label>Width</label><div class="field"><NumberField :model-value="gifWidth" :min="64" :max="project.width" :step="16" label="GIF width" @update:model-value="gifWidth = Math.round($event)" /><span>{{ gifSize.width }} × {{ gifSize.height }}</span></div>
            <label>Frame rate</label><div class="field"><NumberField :model-value="gifFrameRate" :min="1" :max="50" :step="1" label="GIF frame rate" @update:model-value="gifFrameRate = Math.round($event)" /><span>fps</span></div>
            <label>Colours</label><div class="field"><NumberField :model-value="gifColors" :min="2" :max="256" :step="8" label="GIF palette size" @update:model-value="gifColors = Math.round($event)" /><span>per frame</span></div>
            <label>Frames</label><div class="field">{{ gifFrames }} · {{ gifDuration }}s</div>
          </div>
          <div class="check-row"><button type="button" :class="{ checked: gifLoop }" @click="gifLoop = !gifLoop"><Check v-if="gifLoop" :size="10" /></button><span><strong>Loop forever</strong><small>Off plays the animation once and holds the last frame</small></span></div>
          <p v-if="gifTruncated" class="format-note"><TriangleAlert :size="11" /> Capped at {{ MAX_GIF_FRAMES }} frames — lower the frame rate to cover the whole composition.</p>
          <p class="format-note"><Info :size="11" /> GIF carries no audio and no alpha; each frame is quantised to its own palette.</p>
        </section>
        <section v-if="format === 'video'"><h3>Audio</h3><p class="format-note"><Info :size="11" /> Video exports carry no audio yet: the mixer is not connected to the renderer, so there is no track to encode.</p></section>
        <section>
          <h3>Range & acceleration</h3>
          <div class="form-grid range-fields">
            <label>Render range</label><MSelect :model-value="renderRange" :options="rangeOptions" label="Render range" @update:model-value="setRangeMode" />
            <label>In / Out</label>
            <div class="range-inputs">
              <label><span>In</span><NumberField :model-value="selectedStart" :min="0" :max="selectedEnd - 1 / project.frameRate" :step="1 / project.frameRate" label="Export in time" suffix="s" @update:model-value="setRangeBoundary('start', $event)" /></label>
              <span>→</span>
              <label><span>Out</span><NumberField :model-value="selectedEnd" :min="selectedStart + 1 / project.frameRate" :max="project.duration" :step="1 / project.frameRate" label="Export out time" suffix="s" @update:model-value="setRangeBoundary('end', $event)" /></label>
            </div>
            <label>Frames</label><div class="field">{{ startFrame }} – {{ endFrame }} <span>{{ format === 'gif' ? gifFrames : videoFrames }} frames</span></div>
          </div>

          <div class="range-editor">
            <div ref="rangeTrack" class="range-timeline" @pointerdown="beginScrub">
              <div class="range-ruler">
                <span v-for="tick in timelineTicks" :key="tick.left" :style="{ left: `${tick.left}%` }"><i />{{ formatTime(tick.time) }}</span>
              </div>
              <div class="range-clips">
                <div v-for="layer in exportTimelineLayers" :key="layer.id" class="range-clip-row">
                  <span :style="{ left: `${Math.max(0, layer.start / project.duration * 100)}%`, width: `${Math.min(project.duration - layer.start, layer.duration) / project.duration * 100}%`, backgroundColor: layer.color }">{{ layer.name }}</span>
                </div>
              </div>
              <div class="range-dim before" :style="{ width: `${selectedStart / project.duration * 100}%` }" />
              <div class="range-dim after" :style="{ left: `${selectedEnd / project.duration * 100}%` }" />
              <div class="range-selection" :style="rangeSelectionStyle">
                <button class="range-handle start" type="button" :aria-label="`Export starts at ${formatTime(selectedStart)}`" @pointerdown="beginRangeDrag($event, 'start')"><GripVertical :size="10" /></button>
                <span><strong>{{ formatTime(selectedStart) }}</strong><i>{{ selectedDuration.toFixed(2) }}s selected</i><strong>{{ formatTime(selectedEnd) }}</strong></span>
                <button class="range-move" type="button" title="Move selected range" aria-label="Move selected export range" @pointerdown="beginRangeDrag($event, 'range')"><MoveHorizontal :size="9" /></button>
                <button class="range-handle end" type="button" :aria-label="`Export ends at ${formatTime(selectedEnd)}`" @pointerdown="beginRangeDrag($event, 'end')"><GripVertical :size="10" /></button>
              </div>
              <button class="range-scrubber" :style="scrubberStyle" type="button" :aria-label="`Preview frame ${formatTime(previewTime)}`" title="Drag to preview frames · Arrow keys step one frame" @pointerdown="beginScrub" @keydown.left.prevent="stepPreview(-1)" @keydown.right.prevent="stepPreview(1)"><i /><span /></button>
            </div>
            <ExportRangePreview :time="previewTime" :label="previewLabel" />
          </div>
          <p class="range-hint">Click or drag the cursor to preview frames. Arrow keys step one frame; the centre grip moves the selected range.</p>

        </section>
        <div class="estimate"><HardDrive :size="15" /><span><strong>Estimated file size</strong><small>About {{ format === 'gif' ? gifEstimate : videoEstimate }} · {{ selectedDuration.toFixed(1) }}s</small></span><Gauge :size="15" /><span><strong>Estimated render</strong><small>{{ format === 'gif' ? gifFrames : videoFrames }} frames, encoded here</small></span></div>
      </div>
      <footer>
        <div v-if="exportProgress > 0" class="render-progress"><span><i :style="{ width: `${exportProgress}%` }" /></span><small>{{ exportProgress < 100 ? `Rendering frame ${Math.max(1, Math.round(exportProgress / 100 * (format === 'gif' ? gifFrames : videoFrames)))} of ${format === 'gif' ? gifFrames : videoFrames}` : `Export complete${exportMessage ? ` · ${exportMessage}` : ''}` }}</small></div>
        <span v-else-if="exportStatus === 'error'" class="export-note error"><TriangleAlert :size="11" /> {{ exportMessage }}</span>
        <span v-else class="export-note"><Info :size="11" /> Preview and export share the same composition renderer.</span>
        <button v-if="rendering" type="button" class="queue-button" @click="store.cancelExport()"><X :size="12" /> Cancel</button>
        <button v-else type="button" class="queue-button">Add to queue</button>
        <button type="button" class="render-button" :disabled="rendering" @click="startRender()"><component :is="rendering ? Loader : Download" :size="13" :class="{ spinning: rendering }" /> {{ rendering ? 'Rendering…' : format === 'gif' ? 'Export GIF' : 'Export video' }}</button>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.export-workspace { display: grid; height: 100%; min-height: 0; grid-template-columns: 220px 1fr; background: #0e1014; }.export-sidebar { background: #12141a; border-right: 1px solid var(--border-subtle); }.export-sidebar > header { display: flex; height: 42px; align-items: center; gap: 7px; padding: 0 10px; color: var(--text-primary); border-bottom: 1px solid var(--border-subtle); }.export-sidebar > header strong { font-size: 11px; }.preset { display: flex; width: calc(100% - 10px); min-height: 48px; align-items: center; gap: 7px; margin: 5px; padding: 5px 6px; color: var(--text-secondary); text-align: left; background: transparent; border: 1px solid transparent; border-radius: 4px; font: inherit; cursor: pointer; }.preset:hover { background: var(--bg-hover); }.preset.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.preset > span { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; color: var(--accent); background: #272d48; border-radius: 4px; }.preset div { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }.preset strong { font-size: 9.5px; font-weight: 550; }.preset small { color: var(--text-muted); font-size: 7.5px; }.sidebar-label { display: block; margin: 14px 10px 6px; color: var(--text-muted); font-size: 8px; letter-spacing: .08em; text-transform: uppercase; }.recent-render { display: flex; align-items: center; gap: 7px; margin: 0 8px; padding: 7px; color: var(--success); background: #15181c; border: 1px solid #282d32; border-radius: 4px; }.recent-render span { display: flex; flex-direction: column; gap: 2px; }.recent-render strong { color: var(--text-secondary); font-size: 8.5px; font-weight: 520; }.recent-render small { color: var(--text-muted); font-size: 7.5px; }
.export-form { display: flex; min-width: 0; flex-direction: column; }.export-form > header { display: flex; height: 55px; flex: 0 0 auto; align-items: center; justify-content: space-between; padding: 0 15px; background: #13151a; border-bottom: 1px solid var(--border-subtle); }.export-form > header > div { display: flex; flex-direction: column; gap: 3px; }.export-form > header strong { color: var(--text-primary); font-size: 12px; }.export-form > header span { color: var(--text-muted); font-size: 8.5px; }.capability { display: flex; align-items: center; gap: 5px; padding: 5px 7px; color: var(--success) !important; background: #15241e; border: 1px solid #294538; border-radius: 3px; }.export-scroll { min-height: 0; flex: 1; padding: 8px 16px 20px; overflow: auto; }.export-scroll section { max-width: 720px; padding: 10px 0 13px; border-bottom: 1px solid var(--border-subtle); }.export-scroll h3 { margin: 0 0 10px; color: var(--text-primary); font-size: 9.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }.form-grid { display: grid; grid-template-columns: 100px minmax(160px, 1fr); align-items: center; gap: 6px 9px; }.form-grid label { color: var(--text-muted); font-size: 9px; }.field { display: flex; height: 27px; min-width: 0; align-items: center; justify-content: space-between; gap: 7px; padding: 0 7px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 9px; }.field input { min-width: 0; flex: 1; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 9.5px; }.field > span { margin-left: auto; color: var(--text-muted); }.check-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }.check-row > button { display: grid; width: 16px; height: 16px; place-items: center; padding: 0; color: #111318; background: #16191e; border: 1px solid var(--border-strong); border-radius: 3px; cursor: pointer; }.check-row > button.checked { background: var(--button-accent); border-color: #aab4ff; }.check-row > span { display: flex; flex-direction: column; gap: 2px; }.check-row strong { color: var(--text-secondary); font-size: 9px; font-weight: 500; }.check-row small { color: var(--text-muted); font-size: 7.5px; }.estimate { display: flex; max-width: 720px; align-items: center; gap: 8px; margin-top: 12px; padding: 9px; color: var(--accent); background: #151820; border: 1px solid #2c3142; border-radius: 4px; }.estimate > span { display: flex; min-width: 120px; flex: 1; flex-direction: column; gap: 2px; }.estimate strong { color: var(--text-secondary); font-size: 8.5px; }.estimate small { color: var(--text-muted); font-size: 7.5px; }
.format-note { display: flex; max-width: 720px; align-items: center; gap: 5px; margin: 9px 0 0; color: var(--text-muted); font-size: 8px; line-height: 1.5; }.format-note svg { flex: 0 0 auto; color: var(--accent); }.field :deep(input) { min-width: 0; width: 100%; flex: 1; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 9.5px; }
.range-fields :deep(.m-select) { width: 100%; min-width: 0; }.range-fields :deep(.m-select-trigger) { height: 27px; }.range-inputs { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 6px; }.range-inputs > label { display: grid; height: 27px; min-width: 0; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 5px; padding: 0 6px; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.range-inputs > label > span { color: var(--text-muted); font-size: 7.5px; text-transform: uppercase; }.range-inputs > span { color: var(--text-muted); }.range-inputs :deep(.number-field) { min-width: 0; }.range-inputs :deep(input) { text-align: right; }
.range-editor { display: grid; max-width: 720px; grid-template-columns: minmax(0, 1fr) 225px; gap: 7px; margin-top: 10px; }.range-timeline { position: relative; height: 112px; overflow: hidden; background: #0c0e12; border: 1px solid #343946; border-radius: 3px; cursor: col-resize; user-select: none; touch-action: none; }.range-ruler { position: relative; height: 23px; background: #151820; border-bottom: 1px solid #2b303a; }.range-ruler > span { position: absolute; bottom: 4px; color: #737a88; font-size: 6.5px; font-variant-numeric: tabular-nums; transform: translateX(-1px); white-space: nowrap; }.range-ruler > span:last-child { transform: translateX(-100%); }.range-ruler i { position: absolute; bottom: -4px; left: 0; width: 1px; height: 4px; background: #555b68; }.range-clips { position: absolute; top: 23px; right: 0; bottom: 21px; left: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 4px 0; background-image: linear-gradient(90deg, rgb(255 255 255 / .04) 1px, transparent 1px); background-size: 10% 100%; }.range-clip-row { position: relative; height: 10px; }.range-clip-row > span { position: absolute; height: 10px; min-width: 2px; padding: 0 3px; overflow: hidden; color: rgb(255 255 255 / .78); border-radius: 2px; font-size: 6px; line-height: 10px; text-overflow: ellipsis; white-space: nowrap; opacity: .72; }.range-dim { position: absolute; z-index: 2; top: 23px; bottom: 0; background: rgb(4 5 8 / .68); pointer-events: none; }.range-dim.before { left: 0; }.range-dim.after { right: 0; }.range-selection { position: absolute; z-index: 3; top: 23px; bottom: 0; border: 1px solid #a5b4fc; background: rgb(140 155 255 / .08); box-shadow: inset 0 0 0 1px rgb(140 155 255 / .13); pointer-events: none; }.range-selection > span { position: absolute; right: 5px; bottom: 3px; left: 5px; display: flex; align-items: center; justify-content: space-between; gap: 5px; overflow: hidden; color: #cfd5ff; font-size: 6.5px; font-variant-numeric: tabular-nums; pointer-events: none; }.range-selection > span strong { font-weight: 550; white-space: nowrap; }.range-selection > span i { overflow: hidden; color: #929ccc; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }.range-handle { position: absolute; z-index: 8; top: -1px; bottom: -1px; display: grid; width: 13px; place-items: center; padding: 0; color: #202538; background: #a5b4fc; border: 0; cursor: col-resize; pointer-events: auto; }.range-handle.start { left: -7px; border-radius: 3px 0 0 3px; }.range-handle.end { right: -7px; border-radius: 0 3px 3px 0; }.range-move { position: absolute; z-index: 8; top: 3px; left: 50%; display: grid; width: 23px; height: 15px; place-items: center; padding: 0; color: #cfd5ff; background: #323a62; border: 1px solid #7785c5; border-radius: 3px; cursor: grab; pointer-events: auto; transform: translateX(-50%); }.range-move:active { cursor: grabbing; }.range-scrubber { position: absolute; z-index: 6; top: 0; bottom: 0; width: 13px; padding: 0; background: transparent; border: 0; cursor: col-resize; transform: translateX(-6px); }.range-scrubber i { position: absolute; top: 0; bottom: 0; left: 6px; width: 1px; background: #e4b767; box-shadow: 0 0 0 1px rgb(228 183 103 / .1); }.range-scrubber span { position: absolute; top: 0; left: 1px; width: 11px; height: 8px; background: #e4b767; clip-path: polygon(0 0, 100% 0, 100% 58%, 50% 100%, 0 58%); }.range-scrubber:focus-visible { outline: 1px solid #a5b4fc; outline-offset: -1px; }.range-hint { max-width: 720px; margin: 5px 0 0; color: #666d7a; font-size: 7.5px; }
@media (max-width: 1100px) { .range-editor { grid-template-columns: minmax(0, 1fr) 190px; } }
.export-form > footer { display: flex; min-height: 50px; flex: 0 0 auto; align-items: center; gap: 6px; padding: 7px 12px; background: #13151a; border-top: 1px solid var(--border-subtle); }.export-note { display: flex; flex: 1; align-items: center; gap: 5px; color: var(--text-muted); font-size: 8px; }.queue-button, .render-button { display: flex; height: 29px; align-items: center; justify-content: center; gap: 5px; padding: 0 11px; border-radius: 4px; font: inherit; font-size: 9.5px; cursor: pointer; }.queue-button { color: var(--text-primary); background: #20232a; border: 1px solid var(--border-strong); }.render-button { color: #101219; background: var(--button-accent); border: 1px solid #aab4ff; font-weight: 650; }.render-button:disabled { color: #8f96ad; background: #202432; border-color: #383e52; cursor: default; }.export-note.error { color: #e08a8a; }.spinning { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }.render-progress { display: flex; min-width: 200px; flex: 1; flex-direction: column; gap: 4px; }.render-progress > span { height: 4px; overflow: hidden; background: #242832; border-radius: 2px; }.render-progress i { display: block; height: 100%; background: var(--button-accent); transition: width .12s linear; }.render-progress small { color: var(--text-muted); font-size: 7.5px; }
</style>
