<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { AudioLines, ChevronDown, Headphones, Mic2, MoreHorizontal, Music2, SlidersVertical, Volume2, VolumeX } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import IconButton from './common/IconButton.vue'

const store = useEditorStore()
const { project } = storeToRefs(store)
const channels = ref([
  { id: 'dialogue', name: 'Dialogue', icon: Mic2, color: '#6e86bb', gain: -2.2, pan: 0, mute: false, solo: false, peak: 72 },
  { id: 'music', name: 'Deep Signal', icon: Music2, color: '#659a84', gain: -5.8, pan: -8, mute: false, solo: false, peak: 58 },
  { id: 'sfx', name: 'Atmosphere', icon: AudioLines, color: '#9d7fb0', gain: -8.4, pan: 12, mute: false, solo: false, peak: 45 },
  { id: 'master', name: 'Master', icon: Volume2, color: '#bd8e5e', gain: -1.0, pan: 0, mute: false, solo: false, peak: 82 },
])
</script>

<template>
  <section class="audio-workspace">
    <div class="audio-toolbar"><SlidersVertical :size="13" /><strong>Audio Mixer</strong><span>{{ project.name }}</span><span class="spacer" /><button type="button">Mix <ChevronDown :size="11" /></button><IconButton :icon="MoreHorizontal" label="Mixer options" /></div>
    <div class="mixer-stage">
      <article v-for="channel in channels" :key="channel.id" class="channel-strip" :class="{ master: channel.id === 'master' }">
        <header><span :style="{ background: channel.color }"><component :is="channel.icon" :size="13" /></span><strong>{{ channel.name }}</strong></header>
        <div class="insert-slots"><button type="button">EQ <span>›</span></button><button type="button">Compressor <span>›</span></button><button type="button" class="empty">+ Insert</button></div>
        <div class="pan-control"><label>Pan</label><input v-model="channel.pan" type="range" min="-100" max="100" /><span>{{ channel.pan }}</span></div>
        <div class="fader-section">
          <div class="meter"><span v-for="n in 30" :key="n" :class="{ lit: n < channel.peak / 3, warn: n > 24 }" /></div>
          <div class="fader"><input v-model="channel.gain" type="range" min="-60" max="6" step=".1" orient="vertical" /><i v-for="n in 7" :key="n" :style="{ bottom: `${n * 14.3}%` }">{{ -60 + n * 10 }}</i></div>
        </div>
        <div class="gain-value">{{ Number(channel.gain).toFixed(1) }} dB</div>
        <div class="channel-buttons"><button type="button" :class="{ active: channel.mute }" @click="channel.mute = !channel.mute">M</button><button type="button" :class="{ active: channel.solo }" @click="channel.solo = !channel.solo">S</button><button type="button"><Headphones :size="10" /></button></div>
        <footer>Bus {{ channel.id === 'master' ? 'Out 1–2' : 'Master' }}</footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.audio-workspace { display: flex; height: 100%; min-height: 0; flex-direction: column; background: #0d0f13; }.audio-toolbar { display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 7px; padding: 0 8px; background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 9px; }.audio-toolbar strong { color: var(--text-primary); font-size: 10px; }.audio-toolbar .spacer { flex: 1; }.audio-toolbar > button { display: flex; height: 24px; align-items: center; gap: 8px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 9px; }.mixer-stage { display: flex; min-height: 0; flex: 1; align-items: stretch; justify-content: center; gap: 6px; padding: 12px; overflow: auto; }.channel-strip { display: flex; width: 145px; min-width: 125px; flex-direction: column; background: #15171d; border: 1px solid #30343e; border-radius: 4px; box-shadow: 0 7px 18px rgb(0 0 0 / .24); }.channel-strip.master { margin-left: 12px; background: #19191c; border-color: #554638; }.channel-strip header { display: flex; height: 37px; align-items: center; gap: 7px; padding: 0 7px; border-bottom: 1px solid var(--border-subtle); }.channel-strip header > span { display: grid; width: 24px; height: 24px; place-items: center; color: #f3f4f8; border-radius: 3px; }.channel-strip header strong { overflow: hidden; color: var(--text-primary); font-size: 9.5px; font-weight: 570; text-overflow: ellipsis; white-space: nowrap; }.insert-slots { padding: 5px; border-bottom: 1px solid var(--border-subtle); }.insert-slots button { display: flex; width: 100%; height: 22px; align-items: center; justify-content: space-between; padding: 0 5px; color: var(--text-secondary); background: #1c1f26; border: 1px solid #2e323c; border-radius: 2px; font: inherit; font-size: 8px; }.insert-slots button + button { margin-top: 3px; }.insert-slots button.empty { justify-content: center; color: var(--text-muted); background: transparent; border-style: dashed; }.pan-control { display: grid; grid-template-columns: auto 1fr 22px; align-items: center; gap: 4px; padding: 7px; color: var(--text-muted); font-size: 7.5px; }.pan-control input { width: 100%; accent-color: var(--button-accent); }.pan-control span { text-align: right; }.fader-section { display: flex; min-height: 150px; flex: 1; justify-content: center; gap: 12px; padding: 7px 10px; }.meter { display: flex; width: 13px; flex-direction: column-reverse; gap: 2px; padding: 3px; background: #090b0e; border: 1px solid #292d35; border-radius: 3px; }.meter span { flex: 1; background: #20242a; }.meter span.lit { background: #58a77e; box-shadow: 0 0 4px rgb(73 162 118 / .35); }.meter span.lit.warn { background: #ce9962; }.fader { position: relative; width: 45px; }.fader input { position: absolute; top: 48%; left: -38px; width: 125px; transform: rotate(-90deg); accent-color: #9ba7ef; }.fader i { position: absolute; right: -2px; color: #4f535d; font-size: 6px; font-style: normal; }.gain-value { margin: 0 8px 6px; padding: 4px; color: var(--text-secondary); text-align: center; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font-size: 8.5px; font-variant-numeric: tabular-nums; }.channel-buttons { display: flex; gap: 3px; padding: 0 7px 7px; }.channel-buttons button { display: grid; height: 22px; flex: 1; place-items: center; padding: 0; color: var(--text-muted); background: #1c1f25; border: 1px solid #333741; border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; }.channel-buttons button.active { color: #16130f; background: #c89960; border-color: #dda96c; }.channel-strip footer { padding: 6px; color: var(--text-muted); text-align: center; background: #111318; border-top: 1px solid var(--border-subtle); font-size: 7.5px; }
</style>
