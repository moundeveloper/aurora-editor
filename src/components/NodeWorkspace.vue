<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Eye, Focus, Image, Maximize2, Minus, MoreHorizontal, Play, Plus, Search, Sparkles, Type, WandSparkles, ZoomIn } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import IconButton from './common/IconButton.vue'

const store = useEditorStore()
const { selectedNodeId } = storeToRefs(store)
const query = ref('')
const addMenu = ref(false)
const nodes = [
  { id: 'node-media', title: 'Media Input', type: 'Image', icon: Image, x: 7, y: 43, color: '#5d80b6', value: 'Ridge_Expedition.mp4' },
  { id: 'node-transform', title: 'Transform', type: 'Transform', icon: Box, x: 28, y: 24, color: '#a17dba', value: '1920 × 1080' },
  { id: 'node-blur', title: 'Gaussian Blur', type: 'Blur', icon: Sparkles, x: 49, y: 42, color: '#8f88d8', value: 'Radius  18.0' },
  { id: 'node-text', title: 'Title', type: 'Text', icon: Type, x: 29, y: 68, color: '#c59062', value: 'Beyond the Horizon' },
  { id: 'node-scene-3d', title: 'Aurora 3D Study', type: '3D Scene', icon: Box, x: 49, y: 68, color: '#7888db', value: 'Camera Main · Beauty' },
  { id: 'node-merge', title: 'Merge', type: 'Composite', icon: WandSparkles, x: 69, y: 32, color: '#609a86', value: 'Mode  Over' },
  { id: 'node-output', title: 'Media Output', type: 'Output', icon: Play, x: 87, y: 43, color: '#b36d6d', value: 'Main Composition' },
]
const categories = ['Input', 'Transform', 'Composite', '3D', 'Color', 'Blur', 'Distortion', 'Stylize', 'Mask', 'Utility', 'Audio']
</script>

<template>
  <section class="node-workspace">
    <div class="node-toolbar">
      <button class="add-node-button" type="button" @click="addMenu = !addMenu"><Plus :size="13" /> Add Node</button>
      <span class="divider" />
      <IconButton :icon="Focus" label="Frame selected" />
      <IconButton :icon="Maximize2" label="Fit graph" />
      <IconButton :icon="Minus" label="Zoom out" />
      <span class="zoom-label">78%</span>
      <IconButton :icon="ZoomIn" label="Zoom in" />
      <span class="toolbar-spacer" />
      <label class="node-search"><Search :size="12" /><input v-model="query" placeholder="Search nodes" /></label>
      <IconButton :icon="MoreHorizontal" label="Graph options" />
    </div>
    <div class="node-canvas">
      <div class="node-grid" />
      <svg class="connections" viewBox="0 0 1000 550" preserveAspectRatio="none" aria-hidden="true">
        <path d="M190 285 C235 285 225 178 283 178" /><path d="M405 178 C455 178 450 286 494 286" /><path d="M405 406 C535 406 570 224 694 224" class="gold" /><path d="M612 286 C655 286 647 224 694 224" /><path d="M812 224 C850 224 842 285 875 285" class="green" />
      </svg>
      <button v-for="node in nodes" :key="node.id" class="graph-node" :class="{ selected: selectedNodeId === node.id }" type="button" :style="{ left: `${node.x}%`, top: `${node.y}%`, '--node-color': node.color }" @click="selectedNodeId = node.id">
        <span class="node-header"><component :is="node.icon" :size="12" /><strong>{{ node.title }}</strong><Eye :size="10" /></span>
        <span class="node-preview" :class="node.type.toLowerCase().replace(' ', '-')"><img v-if="node.id === 'node-media'" src="/demo/aurora-ridge.png" alt="" /><span v-else-if="node.id === 'node-blur'" class="blur-preview" /><component v-else :is="node.icon" :size="20" /></span>
        <span class="node-value">{{ node.value }}</span>
        <i class="socket input" /><i class="socket output" />
      </button>
      <div class="backdrop"><span>PRIMARY COMPOSITE</span></div>
      <div class="minimap"><span v-for="node in nodes" :key="node.id" :style="{ left: `${node.x}%`, top: `${node.y}%`, background: node.color }" /></div>
      <div v-if="addMenu" class="node-menu">
        <label><Search :size="13" /><input autofocus placeholder="Search 90+ nodes…" /></label>
        <div><button v-for="category in categories" :key="category" type="button">{{ category }}<span>›</span></button></div>
        <footer>Type to search · ↑↓ Navigate · Enter Add</footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.node-workspace { display: flex; height: 100%; min-height: 0; flex-direction: column; background: #0d0f13; }.node-toolbar { display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 3px; padding: 0 7px; background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); }.add-node-button { display: flex; height: 25px; align-items: center; gap: 4px; padding: 0 7px; color: #dbe1ff; background: var(--bg-selected); border: 1px solid var(--accent-border); border-radius: 4px; font: inherit; font-size: 9.5px; cursor: pointer; }.divider { width: 1px; height: 20px; margin: 0 3px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.zoom-label { color: var(--text-muted); font-size: 8.5px; }.node-search { display: flex; width: 126px; height: 24px; align-items: center; gap: 5px; padding: 0 6px; color: var(--text-muted); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.node-search input { width: 100%; min-width: 0; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 9px; }.node-canvas { position: relative; min-height: 0; flex: 1; overflow: hidden; }.node-grid { position: absolute; inset: 0; background-color: #0c0e12; background-image: radial-gradient(#272b34 1px, transparent 1px), radial-gradient(#181b21 1px, transparent 1px); background-position: 0 0, 10px 10px; background-size: 20px 20px; }.connections { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }.connections path { fill: none; stroke: #6d88b6; stroke-width: 2; filter: drop-shadow(0 0 3px rgb(83 123 175 / .45)); }.connections path.gold { stroke: #b58b5f; }.connections path.green { stroke: #669b87; }
.graph-node { --node-color: #7b84b8; position: absolute; z-index: 2; width: 122px; padding: 0; overflow: visible; color: var(--text-secondary); text-align: left; background: #191c23; border: 1px solid #3a3e48; border-radius: 5px; box-shadow: 0 4px 12px rgb(0 0 0 / .35); transform: translate(-50%, -50%); cursor: grab; }.graph-node:hover { border-color: #666c7b; }.graph-node.selected { border-color: var(--accent-border); box-shadow: 0 0 0 1px var(--accent-border), 0 7px 18px rgb(0 0 0 / .45); }.node-header { display: flex; height: 24px; align-items: center; gap: 5px; padding: 0 6px; color: #eef0f7; background: color-mix(in srgb, var(--node-color) 62%, #15171d); border-radius: 4px 4px 0 0; }.node-header strong { flex: 1; overflow: hidden; font-size: 8.5px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }.node-preview { display: grid; height: 45px; place-items: center; overflow: hidden; color: var(--node-color); background: #111319; }.node-preview img { width: 100%; height: 100%; object-fit: cover; }.blur-preview { width: 55px; height: 26px; background: radial-gradient(circle, #9a8cc6, transparent 65%); filter: blur(5px); }.node-value { display: block; padding: 5px 6px; overflow: hidden; color: var(--text-muted); font-size: 7.5px; text-overflow: ellipsis; white-space: nowrap; }.socket { position: absolute; top: 49%; width: 9px; height: 9px; background: var(--node-color); border: 2px solid #0e1014; border-radius: 50%; }.socket.input { left: -6px; }.socket.output { right: -6px; }.backdrop { position: absolute; z-index: 0; top: 12%; left: 20%; width: 64%; height: 76%; border: 1px solid rgb(115 124 174 / .18); border-radius: 6px; pointer-events: none; }.backdrop span { position: absolute; top: -17px; left: 0; color: #555b77; font-size: 8px; letter-spacing: .1em; }.minimap { position: absolute; right: 9px; bottom: 9px; width: 105px; height: 67px; background: rgb(18 21 27 / .88); border: 1px solid #383d48; border-radius: 3px; }.minimap::after { position: absolute; inset: 8px; border: 1px solid #69739f; content: ''; }.minimap span { position: absolute; z-index: 2; width: 9px; height: 5px; opacity: .8; }.node-menu { position: absolute; z-index: 10; top: 43px; left: 13px; width: 220px; overflow: hidden; background: #1a1d24; border: 1px solid #444955; border-radius: 5px; box-shadow: 0 12px 30px rgb(0 0 0 / .55); }.node-menu > label { display: flex; height: 32px; align-items: center; gap: 6px; padding: 0 8px; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); }.node-menu input { width: 100%; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 9.5px; }.node-menu > div { display: grid; grid-template-columns: 1fr 1fr; padding: 4px; }.node-menu button { display: flex; height: 25px; align-items: center; justify-content: space-between; padding: 0 6px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 3px; font: inherit; font-size: 9px; cursor: pointer; }.node-menu button:hover { color: #dce2ff; background: var(--bg-selected); }.node-menu footer { padding: 6px 8px; color: var(--text-muted); background: #14161b; border-top: 1px solid var(--border-subtle); font-size: 7.5px; }
</style>
