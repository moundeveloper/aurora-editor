<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { scopeDensity, subscribeScope, type ScopeMode } from '@/engine/rendering/scopes'
import type { CachedFramePixels } from '@/engine/rendering/contracts'
import { useEditorStore } from '@/stores/editor'
import MSelect from './common/MSelect.vue'
const store = useEditorStore()
const canvas = ref<HTMLCanvasElement>()
const mode = ref<ScopeMode>('waveform')
let latest: CachedFramePixels | null = null
let unsubscribe: (() => void) | undefined
function draw() {
  const context = canvas.value?.getContext('2d')
  if (!context || !latest) return
  const width = 384, height = 192, bins = scopeDensity(latest, mode.value, width, height)
  const pixels = context.createImageData(width, height)
  for (let i = 0; i < bins.length; i += 3) {
    const target = i / 3 * 4
    for (let channel = 0; channel < 3; channel++) pixels.data[target + channel] = bins[i + channel] ? Math.min(255, 55 + 42 * Math.log2(1 + bins[i + channel]!)) : 12
    pixels.data[target + 3] = 255
  }
  context.putImageData(pixels, 0, 0)
  context.strokeStyle = '#8795aa55'; context.lineWidth = .5
  context.beginPath()
  if (mode.value === 'vectorscope') {
    context.arc(width / 2, height / 2, height * .45, 0, 2 * Math.PI)
    context.moveTo(width / 2, 0); context.lineTo(width / 2, height)
    context.moveTo(0, height / 2); context.lineTo(width, height / 2)
  } else for (const fraction of [0, .25, .5, .75, 1]) {
    context.moveTo(0, fraction * (height - 1)); context.lineTo(width, fraction * (height - 1))
  }
  context.stroke()
}
watch(mode, draw)
onMounted(() => {
  unsubscribe = subscribeScope(frame => { latest = frame; draw() })
  // Request a fresh frame even when the playhead is paused.
  store.renderRevision++
})
onBeforeUnmount(() => unsubscribe?.())
</script>
<template>
  <section class="scopes-panel">
    <header><MSelect v-model="mode" :options="[{value:'waveform',label:'Luma waveform'},{value:'parade',label:'RGB parade'},{value:'vectorscope',label:'Vectorscope'}]" label="Scope type" /><span>Displayed composition · sRGB · 0–100%</span></header>
    <canvas ref="canvas" width="384" height="192" :aria-label="`${mode} of the composition output`" role="img" />
  </section>
</template>
<style scoped>
.scopes-panel{display:flex;flex:1;min-height:0;flex-direction:column;padding:8px;gap:6px}header{display:flex;align-items:center;gap:12px;color:var(--text-muted);font-size:10px}canvas{width:100%;min-height:0;flex:1;object-fit:contain;background:#0c0c0c}
</style>
