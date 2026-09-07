<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  AudioLines, CirclePlus, Focus, Gauge, Headphones, Link2, Music2,
  SlidersHorizontal, Trash2, Volume2, VolumeX, ZoomIn, ZoomOut,
} from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import MSelect, { type MSelectOption } from './common/MSelect.vue'
import IconButton from './common/IconButton.vue'

import type { AudioNodeKind, AudioGraphNode as AudioNode } from '@/engine/audio/audioGraph'
interface DragState { pointerId: number; id: string; offsetX: number; offsetY: number }
interface PanState { pointerId: number; startX: number; startY: number; originX: number; originY: number }

const NODE_WIDTH = 210
const store = useEditorStore()
const { project, layers } = storeToRefs(store)
const canvas = ref<HTMLElement>()
const view = ref({ x: 56, y: 46, zoom: 1 })
const selectedNodeId = ref<string | null>('audio-eq')
const addKind = ref<AudioNodeKind>('eq')
const dragging = ref<DragState | null>(null)
const panning = ref<PanState | null>(null)
let resizeObserver: ResizeObserver | null = null

const audioLayers = computed(() => layers.value.filter((layer) => layer.type === 'audio' && !layer.isPlaceholder))
const sourceOptions = computed((): MSelectOption[] => audioLayers.value.length
  ? audioLayers.value.map((layer) => ({ value: layer.id, label: layer.name }))
  : [{ value: '', label: 'No audio layer' }])
const processorOptions: MSelectOption[] = [
  { value: 'gain', label: 'Gain / Pan' },
  { value: 'eq', label: '3-band EQ' },
  { value: 'compressor', label: 'Compressor' },
  { value: 'reverb', label: 'Room Reverb' },
]

const nodes = computed({ get: () => store.audioGraph.nodes, set: value => { store.audioGraph.nodes = value } })
const connections = computed({ get: () => store.audioGraph.connections, set: value => { store.audioGraph.connections = value } })

const nodeById = computed(() => new Map(nodes.value.map((node) => [node.id, node])))
const layerStyle = computed(() => ({ transform: `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.zoom})` }))
const zoomLabel = computed(() => `${Math.round(view.value.zoom * 100)}%`)
const graphBounds = computed(() => nodes.value.reduce((bounds, node) => ({
  minX: Math.min(bounds.minX, node.x), minY: Math.min(bounds.minY, node.y),
  maxX: Math.max(bounds.maxX, node.x + NODE_WIDTH), maxY: Math.max(bounds.maxY, node.y + nodeHeight(node)),
}), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }))
const wires = computed(() => connections.value.flatMap((connection) => {
  const from = nodeById.value.get(connection.from)
  const to = nodeById.value.get(connection.to)
  if (!from || !to) return []
  const start = { x: from.x + NODE_WIDTH, y: from.y + 35 }
  const end = { x: to.x, y: to.y + 35 }
  const bend = Math.max(50, Math.abs(end.x - start.x) * .45)
  return [{ ...connection, path: `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}` }]
}))

function nodeHeight(node: AudioNode) {
  if (node.kind === 'compressor') return 236
  if (node.kind === 'eq') return 205
  if (node.kind === 'reverb') return 179
  if (node.kind === 'master') return 194
  return 179
}

function graphPoint(clientX: number, clientY: number) {
  const bounds = canvas.value?.getBoundingClientRect()
  if (!bounds) return { x: 0, y: 0 }
  return { x: (clientX - bounds.left - view.value.x) / view.value.zoom, y: (clientY - bounds.top - view.value.y) / view.value.zoom }
}

function beginNodeDrag(event: PointerEvent, node: AudioNode) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  selectedNodeId.value = node.id
  const point = graphPoint(event.clientX, event.clientY)
  dragging.value = { pointerId: event.pointerId, id: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y }
}

function beginPan(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 1) return
  if ((event.target as HTMLElement).closest('.audio-node')) return
  event.preventDefault()
  selectedNodeId.value = null
  panning.value = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: view.value.x, originY: view.value.y }
}

function onPointerMove(event: PointerEvent) {
  if (dragging.value?.pointerId === event.pointerId) {
    const node = nodeById.value.get(dragging.value.id)
    const point = graphPoint(event.clientX, event.clientY)
    if (node) { node.x = point.x - dragging.value.offsetX; node.y = point.y - dragging.value.offsetY }
  }
  if (panning.value?.pointerId === event.pointerId) {
    view.value = { ...view.value, x: panning.value.originX + event.clientX - panning.value.startX, y: panning.value.originY + event.clientY - panning.value.startY }
  }
}

function endPointer(event: PointerEvent) {
  if (dragging.value?.pointerId === event.pointerId) dragging.value = null
  if (panning.value?.pointerId === event.pointerId) panning.value = null
}

function setZoom(next: number, clientX?: number, clientY?: number) {
  const bounds = canvas.value?.getBoundingClientRect()
  if (!bounds) return
  const zoom = Math.max(.4, Math.min(1.8, next))
  const localX = clientX === undefined ? bounds.width / 2 : clientX - bounds.left
  const localY = clientY === undefined ? bounds.height / 2 : clientY - bounds.top
  const graphX = (localX - view.value.x) / view.value.zoom
  const graphY = (localY - view.value.y) / view.value.zoom
  view.value = { zoom, x: localX - graphX * zoom, y: localY - graphY * zoom }
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  setZoom(view.value.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), event.clientX, event.clientY)
}

function fitGraph() {
  const element = canvas.value
  const bounds = graphBounds.value
  if (!element || !Number.isFinite(bounds.minX)) return
  const padding = 50
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)
  const zoom = Math.max(.4, Math.min(1.3, (element.clientWidth - padding * 2) / width, (element.clientHeight - padding * 2) / height))
  view.value = { zoom, x: element.clientWidth / 2 - (bounds.minX + width / 2) * zoom, y: element.clientHeight / 2 - (bounds.minY + height / 2) * zoom }
}

function addProcessor() {
  const kind = addKind.value
  if (kind === 'source' || kind === 'master') return
  const master = nodes.value.find((node) => node.kind === 'master')
  if (!master) return
  const id = `audio-${kind}-${crypto.randomUUID()}`
  const defaults: Partial<AudioNode> = kind === 'eq' ? { low: 0, mid: 0, high: 0 }
    : kind === 'compressor' ? { threshold: -18, ratio: 4, attack: 10, release: 160 }
      : kind === 'reverb' ? { mix: 20, room: 45 } : {}
  const inbound = connections.value.filter((connection) => connection.to === master.id)
  connections.value = connections.value.filter((connection) => connection.to !== master.id)
  nodes.value.push({ id, kind, title: processorOptions.find((item) => item.value === kind)?.label ?? 'Processor', x: master.x - 250, y: master.y + 55, bypassed: false, gain: 0, pan: 0, mute: false, solo: false, ...defaults })
  inbound.forEach((connection) => connections.value.push({ id: `${connection.id}-${id}`, from: connection.from, to: id }))
  connections.value.push({ id: `audio-link-${id}-master`, from: id, to: master.id })
  selectedNodeId.value = id
}

function removeNode(node: AudioNode) {
  if (node.kind === 'source' || node.kind === 'master') return
  const incoming = connections.value.filter((connection) => connection.to === node.id)
  const outgoing = connections.value.filter((connection) => connection.from === node.id)
  connections.value = connections.value.filter((connection) => connection.from !== node.id && connection.to !== node.id)
  incoming.forEach((input) => outgoing.forEach((output) => connections.value.push({ id: `audio-link-${input.from}-${output.to}-${crypto.randomUUID()}`, from: input.from, to: output.to })))
  nodes.value = nodes.value.filter((item) => item.id !== node.id)
  selectedNodeId.value = null
}

function sourceTitle(node: AudioNode) {
  return sourceOptions.value.find((item) => item.value === node.sourceId)?.label ?? 'Audio Source'
}

function addSource() {
  const master = nodes.value.find(node => node.kind === 'master')
  if (!master) return
  const id = crypto.randomUUID()
  nodes.value.push({ id, kind: 'source', title: 'Audio Source', x: 20, y: 40 + nodes.value.filter(node => node.kind === 'source').length * 200, bypassed: false, gain: 0, pan: 0, mute: false, solo: false, sourceId: audioLayers.value.find(layer => !nodes.value.some(node => node.sourceId === layer.id))?.id ?? audioLayers.value[0]?.id })
  connections.value.push({ id: crypto.randomUUID(), from: id, to: master.id })
}

onMounted(() => {
  for (const layer of audioLayers.value) {
    if (!nodes.value.some(node => node.kind === 'source' && node.sourceId === layer.id)) addSource()
  }
  void store.prepareAudio()
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endPointer)
  resizeObserver = new ResizeObserver(() => fitGraph())
  if (canvas.value) resizeObserver.observe(canvas.value)
  void nextTick(fitGraph)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endPointer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section class="audio-workspace">
    <div class="audio-toolbar">
      <AudioLines :size="13" /><strong>Audio Graph</strong><span>{{ project.name }}</span>
      <span class="toolbar-divider" />
      <MSelect v-model="addKind" :options="processorOptions" label="Processor to add" />
      <button class="add-processor" type="button" @click="addProcessor"><CirclePlus :size="12" /> Add processor</button>
      <button type="button" @click="addSource">Add source</button>
      <button type="button" @click="store.togglePlayback">{{ store.audioPreparing ? 'Loading audio…' : store.playing ? 'Pause' : 'Play' }}</button>
      <button type="button" @click="store.exportAudioMix">Export WAV mix</button>
      <span class="spacer" />
      <IconButton :icon="Focus" label="Frame all audio nodes" @click="fitGraph" />
      <IconButton :icon="ZoomOut" label="Zoom out" @click="setZoom(view.zoom / 1.12)" />
      <span class="zoom-label">{{ zoomLabel }}</span>
      <IconButton :icon="ZoomIn" label="Zoom in" @click="setZoom(view.zoom * 1.12)" />
    </div>

    <div ref="canvas" class="audio-canvas" :class="{ panning: panning }" @pointerdown="beginPan" @wheel="onWheel">
      <div class="graph-status"><span><i /> {{ store.audioError || (store.playing ? 'Playing' : 'Ready') }}</span><span>{{ nodes.length }} nodes</span><span>{{ connections.length }} links</span></div>
      <svg class="audio-wires">
        <g :style="layerStyle">
          <path v-for="wire in wires" :key="wire.id" class="wire-shadow" :d="wire.path" />
          <path v-for="wire in wires" :key="`${wire.id}-signal`" class="wire-signal" :d="wire.path" />
        </g>
      </svg>

      <div class="audio-node-layer" :style="layerStyle">
        <article v-for="node in nodes" :key="node.id" class="audio-node" :class="[node.kind, { selected: selectedNodeId === node.id, bypassed: node.bypassed }]" :style="{ left: `${node.x}px`, top: `${node.y}px`, height: `${nodeHeight(node)}px` }" @pointerdown.stop="selectedNodeId = node.id">
          <header @pointerdown="beginNodeDrag($event, node)">
            <span class="node-icon"><component :is="node.kind === 'source' ? Music2 : node.kind === 'master' ? Volume2 : node.kind === 'compressor' ? Gauge : SlidersHorizontal" :size="12" /></span>
            <strong>{{ node.kind === 'source' ? sourceTitle(node) : node.title }}</strong>
            <button v-if="node.kind !== 'source' && node.kind !== 'master'" type="button" title="Remove processor" @pointerdown.stop @click="removeNode(node)"><Trash2 :size="10" /></button>
          </header>
          <span v-if="node.kind !== 'source'" class="audio-socket input"><i /><small>In</small></span>
          <span v-if="node.kind !== 'master'" class="audio-socket output"><small>Out</small><i /></span>

          <div class="node-body" @pointerdown.stop>
            <template v-if="node.kind === 'source'">
              <label class="select-row"><span>Source</span><MSelect :model-value="node.sourceId ?? ''" :options="sourceOptions" label="Audio source layer" @update:model-value="node.sourceId = $event" /></label>
              <label class="control-row"><span>Gain</span><input v-model.number="node.gain" type="range" min="-24" max="12" step=".1" /><output>{{ node.gain.toFixed(1) }} dB</output></label>
              <label class="control-row"><span>Pan</span><input v-model.number="node.pan" type="range" min="-100" max="100" /><output>{{ node.pan }}</output></label>
              <div class="node-actions"><button type="button" :class="{ active: node.mute }" @click="node.mute = !node.mute"><VolumeX :size="10" /> Mute</button><button type="button" :class="{ active: node.solo }" @click="node.solo = !node.solo"><Headphones :size="10" /> Solo</button></div>
            </template>

            <template v-else-if="node.kind === 'gain'">
              <label class="control-row"><span>Gain</span><input v-model.number="node.gain" type="range" min="-24" max="12" step=".1" /><output>{{ node.gain.toFixed(1) }} dB</output></label>
              <label class="control-row"><span>Pan</span><input v-model.number="node.pan" type="range" min="-100" max="100" /><output>{{ node.pan }}</output></label>
            </template>

            <template v-else-if="node.kind === 'eq'">
              <label v-for="band in (['low', 'mid', 'high'] as const)" :key="band" class="control-row"><span>{{ band }}</span><input v-model.number="node[band]" type="range" min="-12" max="12" step=".5" /><output>{{ Number(node[band]).toFixed(1) }}</output></label>
              <div class="eq-curve"><i /><span /><b /></div>
            </template>

            <template v-else-if="node.kind === 'compressor'">
              <label class="control-row"><span>Threshold</span><input v-model.number="node.threshold" type="range" min="-60" max="0" /><output>{{ node.threshold }} dB</output></label>
              <label class="control-row"><span>Ratio</span><input v-model.number="node.ratio" type="range" min="1" max="20" step=".5" /><output>{{ node.ratio }}:1</output></label>
              <label class="control-row"><span>Attack</span><input v-model.number="node.attack" type="range" min="1" max="100" /><output>{{ node.attack }} ms</output></label>
              <label class="control-row"><span>Release</span><input v-model.number="node.release" type="range" min="20" max="500" /><output>{{ node.release }} ms</output></label>
            </template>

            <template v-else-if="node.kind === 'reverb'">
              <label class="control-row"><span>Mix</span><input v-model.number="node.mix" type="range" min="0" max="100" /><output>{{ node.mix }}%</output></label>
              <label class="control-row"><span>Room</span><input v-model.number="node.room" type="range" min="0" max="100" /><output>{{ node.room }}%</output></label>
            </template>

            <template v-else>
              <label class="control-row"><span>Output</span><input v-model.number="node.gain" type="range" min="-24" max="6" step=".1" /><output>{{ node.gain.toFixed(1) }} dB</output></label>
              <button class="toggle-row" :class="{ active: node.limiter }" type="button" @click="node.limiter = !node.limiter"><span>Safety limiter</span><i /></button>
              <button class="toggle-row" :class="{ active: node.mute }" type="button" @click="node.mute = !node.mute"><span>Mute output</span><i /></button>
            </template>
          </div>

          <footer v-if="node.kind !== 'source' && node.kind !== 'master'"><button type="button" :class="{ active: node.bypassed }" @click="node.bypassed = !node.bypassed"><Link2 :size="9" /> {{ node.bypassed ? 'Bypassed' : 'Active' }}</button></footer>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.audio-workspace { display: flex; height: 100%; min-height: 0; flex-direction: column; background: #0d0f13; }.audio-toolbar { display: flex; height: 35px; flex: 0 0 auto; align-items: center; gap: 7px; padding: 0 7px; color: var(--text-muted); background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); font-size: 8.5px; }.audio-toolbar > strong { color: var(--text-primary); font-size: 10px; }.audio-toolbar .spacer { flex: 1; }.toolbar-divider { width: 1px; height: 16px; margin: 0 2px; background: var(--border-subtle); }.audio-toolbar :deep(.m-select) { width: 112px; }.audio-toolbar :deep(.m-select-trigger) { height: 23px; }.add-processor { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 7px; color: #dfe3ff; background: rgb(140 155 255 / .12); border: 1px solid var(--accent-border); border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; white-space: nowrap; }.add-processor:hover { background: rgb(140 155 255 / .2); }.zoom-label { min-width: 30px; color: var(--text-secondary); text-align: center; font-size: 8px; font-variant-numeric: tabular-nums; }
.audio-canvas { position: relative; min-height: 0; flex: 1; overflow: hidden; background-color: #0e1015; background-image: linear-gradient(rgb(255 255 255 / .026) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .026) 1px, transparent 1px), linear-gradient(rgb(255 255 255 / .015) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .015) 1px, transparent 1px); background-size: 80px 80px, 80px 80px, 16px 16px, 16px 16px; cursor: grab; }.audio-canvas.panning { cursor: grabbing; }.graph-status { position: absolute; right: 8px; bottom: 8px; z-index: 5; display: flex; height: 23px; align-items: center; gap: 9px; padding: 0 7px; color: #686f7d; background: rgb(17 19 25 / .88); border: 1px solid #2b2f38; border-radius: 3px; font-size: 7.5px; pointer-events: none; }.graph-status span { display: flex; align-items: center; gap: 4px; }.graph-status i { width: 5px; height: 5px; background: var(--success); border-radius: 50%; box-shadow: 0 0 5px rgb(104 170 139 / .5); }.audio-wires, .audio-node-layer { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }.audio-wires g, .audio-node-layer { transform-origin: 0 0; }.wire-shadow, .wire-signal { fill: none; stroke-linecap: round; vector-effect: non-scaling-stroke; }.wire-shadow { stroke: #08090c; stroke-width: 6px; }.wire-signal { stroke: #6c9f89; stroke-width: 2px; opacity: .88; }
.audio-node { position: absolute; width: 210px; color: var(--text-secondary); background: #15181e; border: 1px solid #363b46; border-radius: 4px; box-shadow: 0 8px 18px rgb(0 0 0 / .32); pointer-events: auto; }.audio-node.selected { border-color: #a5b4fc; box-shadow: 0 0 0 1px rgb(165 180 252 / .18), 0 8px 18px rgb(0 0 0 / .38); }.audio-node.bypassed { opacity: .62; }.audio-node.master { background: #18191e; border-color: #535164; }.audio-node > header { display: flex; height: 28px; align-items: center; gap: 6px; padding: 0 5px; background: #20242e; border-bottom: 1px solid #353a46; border-radius: 3px 3px 0 0; cursor: grab; }.audio-node.source > header { background: #1b2b26; }.audio-node.master > header { background: #292838; }.audio-node > header:active { cursor: grabbing; }.node-icon { display: grid; width: 18px; height: 18px; flex: 0 0 auto; place-items: center; color: #dfe4ff; background: rgb(140 155 255 / .16); border-radius: 3px; }.source .node-icon { color: #c9eadc; background: rgb(92 155 130 / .18); }.audio-node > header strong { min-width: 0; flex: 1; overflow: hidden; color: #e3e6ef; font-size: 9px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.audio-node > header button { display: grid; width: 18px; height: 18px; place-items: center; padding: 0; color: #717887; background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.audio-node > header button:hover { color: #e1888f; background: rgb(200 105 112 / .12); }
.audio-socket { position: absolute; z-index: 2; top: 31px; display: flex; align-items: center; gap: 4px; color: #69717d; font-size: 6.5px; }.audio-socket i { width: 9px; height: 9px; background: #59957c; border: 2px solid #b9ddcd; border-radius: 50%; box-shadow: 0 0 0 2px #101217; }.audio-socket.input { left: -5px; }.audio-socket.output { right: -5px; }.node-body { display: flex; flex-direction: column; gap: 7px; padding: 15px 8px 8px; }.control-row, .select-row { display: grid; min-height: 21px; grid-template-columns: 48px minmax(0, 1fr) 45px; align-items: center; gap: 5px; color: #7d8490; font-size: 7.5px; text-transform: capitalize; }.select-row { grid-template-columns: 45px minmax(0, 1fr); }.select-row :deep(.m-select) { width: 100%; min-width: 0; }.select-row :deep(.m-select-trigger) { height: 22px; }.control-row input { width: 100%; height: 12px; accent-color: var(--button-accent); }.control-row output { overflow: hidden; color: #b8bdc8; text-align: right; font-size: 7px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }.node-actions { display: flex; gap: 4px; }.node-actions button { display: flex; height: 22px; flex: 1; align-items: center; justify-content: center; gap: 4px; color: #828997; background: #1d2027; border: 1px solid #333843; border-radius: 3px; font: inherit; font-size: 7.5px; cursor: pointer; }.node-actions button.active { color: #e7eaff; background: var(--bg-selected); border-color: var(--accent-border); }.eq-curve { position: relative; height: 35px; overflow: hidden; background-color: #0d1014; background-image: linear-gradient(rgb(255 255 255 / .05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .05) 1px, transparent 1px); background-size: 25% 50%; border: 1px solid #2c323a; border-radius: 3px; }.eq-curve i { position: absolute; top: 17px; left: -4px; width: 220px; height: 22px; border-top: 2px solid #91a0f4; border-radius: 50%; transform: rotate(-3deg); }.eq-curve span, .eq-curve b { position: absolute; width: 5px; height: 5px; background: #c9d0ff; border-radius: 50%; }.eq-curve span { top: 10px; left: 44px; }.eq-curve b { top: 17px; right: 38px; }.gain-reduction { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 6px; }.gain-reduction > span { height: 5px; overflow: hidden; background: #292218; border-radius: 2px; }.gain-reduction i { display: block; height: 100%; background: #c3945f; }.gain-reduction small { color: #a98765; font-size: 6.5px; }.master-meter { display: flex; height: 14px; flex-direction: row; gap: 2px; padding: 3px; background: #0a0c0f; border: 1px solid #2b3038; border-radius: 3px; }.master-meter i { flex: 1; background: #252a31; }.master-meter i.lit { background: #5ca17f; }.master-meter i.warn { background: #c69761; }.toggle-row { display: flex; height: 23px; align-items: center; justify-content: space-between; padding: 0 6px; color: #858c99; background: #1b1e24; border: 1px solid #30353f; border-radius: 3px; font: inherit; font-size: 7.5px; cursor: pointer; }.toggle-row i { width: 16px; height: 8px; background: #343943; border-radius: 5px; }.toggle-row i::after { display: block; width: 6px; height: 6px; margin: 1px; background: #777e8a; border-radius: 50%; content: ''; transition: transform .12s ease; }.toggle-row.active { color: #dfe3ff; border-color: var(--accent-border); }.toggle-row.active i { background: #5966a1; }.toggle-row.active i::after { background: #cfd5ff; transform: translateX(8px); }.audio-node > footer { position: absolute; right: 0; bottom: 0; left: 0; display: flex; height: 27px; align-items: center; justify-content: flex-end; padding: 0 6px; background: #111319; border-top: 1px solid #292d35; border-radius: 0 0 3px 3px; }.audio-node > footer button { display: flex; height: 19px; align-items: center; gap: 3px; padding: 0 5px; color: #77808d; background: transparent; border: 1px solid transparent; border-radius: 2px; font: inherit; font-size: 7px; cursor: pointer; }.audio-node > footer button:hover, .audio-node > footer button.active { color: #d7dcff; background: rgb(140 155 255 / .1); border-color: rgb(165 180 252 / .28); }
</style>
