<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Check, ChevronDown, CircleCheck, Download, Film, FolderOpen, Gauge, HardDrive, Info, Loader, MonitorUp, Play, TriangleAlert, X } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { estimateGifBytes, gifExportSize, gifFrameCount, MAX_GIF_FRAMES } from '@/engine/rendering/gifPlan'
import NumberField from './common/NumberField.vue'

type ExportFormat = 'mp4' | 'gif'

const store = useEditorStore()
const { project, exportProgress, exportStatus, exportMessage } = storeToRefs(store)
const filename = ref(`${project.value.name.replace(/\W+/g, '_')}_Final`)
const includeAudio = ref(true)
const hardware = ref(true)
const format = ref<ExportFormat>('mp4')
const gifWidth = ref(Math.min(640, project.value.width))
const gifFrameRate = ref(Math.min(15, Math.round(project.value.frameRate)))
const gifColors = ref(128)
const gifLoop = ref(true)
const totalFrames = computed(() => Math.ceil(project.value.duration * project.value.frameRate))

const presets: Array<{ id: string; format: ExportFormat; icon: typeof Film; title: string; detail: string }> = [
  { id: 'web', format: 'mp4', icon: Film, title: 'Web · High Quality', detail: 'H.264' },
  { id: 'master', format: 'mp4', icon: MonitorUp, title: 'Master · ProRes', detail: 'Highest quality archive' },
  { id: 'social', format: 'mp4', icon: Play, title: 'Social · Vertical', detail: 'H.264' },
  { id: 'gif', format: 'gif', icon: Play, title: 'Loop · Animated GIF', detail: 'Rendered in the browser' },
]
const activePreset = ref('web')

function choosePreset(preset: (typeof presets)[number]) {
  activePreset.value = preset.id
  format.value = preset.format
}

const gifSize = computed(() => gifExportSize(project.value, gifWidth.value))
const gifFrames = computed(() => gifFrameCount(project.value.duration, gifFrameRate.value))
/** The cap bites on long compositions, and a GIF that silently stopped early would be a bug report. */
const gifTruncated = computed(() => project.value.duration * gifFrameRate.value > MAX_GIF_FRAMES)
const gifEstimate = computed(() => `${(estimateGifBytes(gifSize.value.width, gifSize.value.height, gifFrames.value) / 1024 / 1024).toFixed(1)} MB`)
const gifDuration = computed(() => (gifFrames.value / Math.max(1, gifFrameRate.value)).toFixed(1))
const rendering = computed(() => exportStatus.value === 'rendering')

function startRender() {
  if (format.value !== 'gif') {
    store.startExport()
    return
  }
  void store.exportGif({
    filename: filename.value,
    maxWidth: gifWidth.value,
    frameRate: gifFrameRate.value,
    colors: gifColors.value,
    loop: gifLoop.value,
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
      <header><div><strong>Export project</strong><span>{{ project.name }} · {{ project.duration.toFixed(1) }} seconds</span></div><span class="capability"><CircleCheck :size="11" /> {{ format === 'gif' ? 'GIF encoder ready' : 'Hardware encoder available' }}</span></header>
      <div class="export-scroll">
        <section><h3>Output</h3><div class="form-grid"><label>Filename</label><div class="field wide"><input v-model="filename" /><span>.{{ format }}</span></div><label>Destination</label><button class="field wide" type="button"><FolderOpen :size="12" /> Downloads <span>Choose…</span></button></div></section>
        <section v-if="format === 'mp4'"><h3>Video</h3><div class="form-grid"><label>Format</label><button class="field" type="button">MP4 <ChevronDown :size="11" /></button><label>Codec</label><button class="field" type="button">H.264 <ChevronDown :size="11" /></button><label>Resolution</label><button class="field" type="button">{{ project.width }} × {{ project.height }} <ChevronDown :size="11" /></button><label>Frame rate</label><button class="field" type="button">{{ project.frameRate }} fps <ChevronDown :size="11" /></button><label>Quality</label><button class="field" type="button">High · 24 Mbps <ChevronDown :size="11" /></button><label>Color space</label><button class="field" type="button">Rec. 709 <ChevronDown :size="11" /></button></div></section>
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
        <section v-if="format === 'mp4'"><h3>Audio</h3><div class="check-row"><button type="button" :class="{ checked: includeAudio }" @click="includeAudio = !includeAudio"><Check v-if="includeAudio" :size="10" /></button><span><strong>Include audio</strong><small>AAC · 48 kHz · 320 kbps · Stereo</small></span></div></section>
        <section><h3>Range & acceleration</h3><div class="form-grid"><label>Render range</label><button class="field" type="button">Entire composition <ChevronDown :size="11" /></button><label>Frames</label><div class="field">0 – {{ (format === 'gif' ? gifFrames : totalFrames) - 1 }}</div></div><div v-if="format === 'mp4'" class="check-row"><button type="button" :class="{ checked: hardware }" @click="hardware = !hardware"><Check v-if="hardware" :size="10" /></button><span><strong>Hardware acceleration</strong><small>Use VideoEncoder when supported</small></span></div></section>
        <div class="estimate"><HardDrive :size="15" /><span><strong>Estimated file size</strong><small>{{ format === 'gif' ? `About ${gifEstimate}` : '52–68 MB' }} · {{ project.duration.toFixed(1) }}s</small></span><Gauge :size="15" /><span><strong>Estimated render</strong><small>{{ format === 'gif' ? `${gifFrames} frames, encoded here` : 'About 12 seconds' }}</small></span></div>
      </div>
      <footer>
        <div v-if="exportProgress > 0" class="render-progress"><span><i :style="{ width: `${exportProgress}%` }" /></span><small>{{ exportProgress < 100 ? `Rendering frame ${Math.max(1, Math.round(exportProgress / 100 * (format === 'gif' ? gifFrames : totalFrames)))} of ${format === 'gif' ? gifFrames : totalFrames}` : `Export complete${exportMessage ? ` · ${exportMessage}` : ''}` }}</small></div>
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
.export-form > footer { display: flex; min-height: 50px; flex: 0 0 auto; align-items: center; gap: 6px; padding: 7px 12px; background: #13151a; border-top: 1px solid var(--border-subtle); }.export-note { display: flex; flex: 1; align-items: center; gap: 5px; color: var(--text-muted); font-size: 8px; }.queue-button, .render-button { display: flex; height: 29px; align-items: center; justify-content: center; gap: 5px; padding: 0 11px; border-radius: 4px; font: inherit; font-size: 9.5px; cursor: pointer; }.queue-button { color: var(--text-primary); background: #20232a; border: 1px solid var(--border-strong); }.render-button { color: #101219; background: var(--button-accent); border: 1px solid #aab4ff; font-weight: 650; }.render-button:disabled { color: #8f96ad; background: #202432; border-color: #383e52; cursor: default; }.export-note.error { color: #e08a8a; }.spinning { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }.render-progress { display: flex; min-width: 200px; flex: 1; flex-direction: column; gap: 4px; }.render-progress > span { height: 4px; overflow: hidden; background: #242832; border-radius: 2px; }.render-progress i { display: block; height: 100%; background: var(--button-accent); transition: width .12s linear; }.render-progress small { color: var(--text-muted); font-size: 7.5px; }
</style>
