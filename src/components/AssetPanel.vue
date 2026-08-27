<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  AudioLines, Box, ChevronDown, ChevronRight, Film, FolderClosed, Grid2X2,
  Image, List, Plus, Search, SlidersHorizontal, Sparkles, Star, Upload,
} from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { MediaAsset } from '@/models/editor'
import IconButton from './common/IconButton.vue'
import PanelHeader from './common/PanelHeader.vue'

const store = useEditorStore()
const { assets } = storeToRefs(store)
const activeTab = ref('Media')
const activeFolder = ref('All Media')
const query = ref('')
const gridView = ref(true)
const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()
const tabs = ['Media', 'Effects', 'Presets']
const folders = [
  { name: 'All Media', icon: FolderClosed },
  { name: 'Videos', icon: Film },
  { name: 'Images', icon: Image },
  { name: 'Audio', icon: AudioLines },
  { name: 'Compositions', icon: Box },
  { name: 'Favorites', icon: Star },
]
const effects = ['Gaussian Blur', 'Brightness / Contrast', 'Hue / Saturation', 'Glow', 'Drop Shadow', 'Pixelate', 'Chroma Key', 'Vignette']
const presets = ['Fade Up', 'Tracking Reveal', 'Smooth Pop', 'Elastic Out', 'Film Burn', 'RGB Split']

const filteredAssets = computed(() => assets.value.filter((asset) => {
  const matchQuery = asset.name.toLowerCase().includes(query.value.toLowerCase())
  const matchFolder = activeFolder.value === 'All Media'
    || activeFolder.value === `${asset.kind[0]?.toUpperCase()}${asset.kind.slice(1)}s`
    || (activeFolder.value === 'Compositions' && asset.kind === 'composition')
  return matchQuery && matchFolder
}))

function iconFor(kind: MediaAsset['kind']) {
  return kind === 'audio' ? AudioLines : kind === 'image' ? Image : kind === 'composition' ? Box : Film
}

function onFiles(files: FileList | null) {
  if (files?.length) store.addFiles(files)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  if (event.dataTransfer?.files.length) store.addFiles(event.dataTransfer.files)
}

function startDrag(event: DragEvent, id: string) {
  event.dataTransfer?.setData('application/x-aurora-asset', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="asset-panel" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop">
    <PanelHeader title="Library" subtitle="Project assets">
      <template #actions><IconButton :icon="Plus" label="Import media" :size="13" @click="fileInput?.click()" /></template>
    </PanelHeader>

    <div class="panel-tabs" role="tablist">
      <button v-for="tab in tabs" :key="tab" type="button" :class="{ active: activeTab === tab }" @click="activeTab = tab">{{ tab }}</button>
    </div>

    <div class="asset-tools">
      <label class="search-box">
        <Search :size="13" />
        <input v-model="query" type="search" :placeholder="`Search ${activeTab.toLowerCase()}…`" />
      </label>
      <IconButton :icon="SlidersHorizontal" label="Filter assets" />
      <IconButton :icon="gridView ? List : Grid2X2" :label="gridView ? 'List view' : 'Grid view'" @click="gridView = !gridView" />
    </div>

    <template v-if="activeTab === 'Media'">
      <div class="asset-body">
        <nav class="folder-list" aria-label="Media folders">
          <button v-for="folder in folders" :key="folder.name" type="button" :class="{ active: activeFolder === folder.name }" @click="activeFolder = folder.name">
            <ChevronRight v-if="folder.name === 'All Media'" :size="11" />
            <span v-else class="folder-indent" />
            <component :is="folder.icon" :size="13" />
            <span>{{ folder.name }}</span>
            <small v-if="folder.name === 'All Media'">{{ assets.length }}</small>
          </button>
        </nav>

        <div class="section-label"><span>{{ activeFolder }}</span><small>{{ filteredAssets.length }} items</small></div>
        <div class="asset-list" :class="{ grid: gridView }">
          <button
            v-for="asset in filteredAssets"
            :key="asset.id"
            class="asset-card"
            type="button"
            draggable="true"
            :title="`${asset.name}\nDrag to timeline`"
            @dragstart="startDrag($event, asset.id)"
            @dblclick="store.addAssetToTimeline(asset.id)"
          >
            <span class="asset-thumbnail" :class="asset.kind">
              <img v-if="asset.thumbnail" :src="asset.thumbnail" alt="" />
              <span v-if="asset.kind === 'audio'" class="mini-wave"><i v-for="n in 15" :key="n" :style="{ height: `${5 + ((n * 7) % 18)}px` }" /></span>
              <component v-if="!asset.thumbnail && asset.kind !== 'audio'" :is="iconFor(asset.kind)" :size="23" />
              <span class="asset-kind"><component :is="iconFor(asset.kind)" :size="10" /></span>
              <time v-if="asset.duration">{{ asset.duration.toFixed(0) }}s</time>
            </span>
            <span class="asset-info"><strong>{{ asset.name }}</strong><small>{{ asset.dimensions || asset.sizeLabel }}</small></span>
          </button>
        </div>
      </div>
    </template>

    <div v-else class="browser-list">
      <button v-for="item in activeTab === 'Effects' ? effects : presets" :key="item" type="button">
        <span class="effect-icon"><Sparkles :size="13" /></span>
        <span><strong>{{ item }}</strong><small>{{ activeTab === 'Effects' ? 'Video effect' : 'Animation preset' }}</small></span>
        <ChevronRight :size="12" />
      </button>
    </div>

    <button class="import-dropzone" type="button" @click="fileInput?.click()"><Upload :size="13" /> Import media <span>or drop files</span></button>
    <input ref="fileInput" class="hidden-input" type="file" multiple accept="video/*,image/*,audio/*,.json" @change="onFiles(($event.target as HTMLInputElement).files)" />
    <div v-if="dragging" class="drop-overlay"><Upload :size="24" /><strong>Drop to import</strong><span>Media stays on this device</span></div>
  </aside>
</template>

<style scoped>
.asset-panel { position: relative; display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); }
.panel-tabs { display: flex; height: 30px; flex: 0 0 auto; gap: 2px; padding: 3px 7px 0; border-bottom: 1px solid var(--border-subtle); }
.panel-tabs button { position: relative; flex: 1; padding: 0 3px; color: var(--text-muted); background: transparent; border: 0; font: inherit; font-size: 10.5px; cursor: pointer; }
.panel-tabs button.active { color: var(--text-primary); }
.panel-tabs button.active::after { position: absolute; right: 6px; bottom: -1px; left: 6px; height: 2px; background: var(--accent); content: ''; }
.asset-tools { display: flex; height: 38px; flex: 0 0 auto; align-items: center; gap: 3px; padding: 5px 7px; border-bottom: 1px solid var(--border-subtle); }
.search-box { display: flex; min-width: 0; height: 27px; flex: 1; align-items: center; gap: 6px; padding: 0 7px; color: var(--text-muted); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 4px; }
.search-box:focus-within { border-color: var(--focus); box-shadow: 0 0 0 1px #424b70; }
.search-box input { width: 100%; min-width: 0; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 10.5px; }
.asset-body { min-height: 0; flex: 1; overflow: auto; }
.folder-list { padding: 5px 5px 3px; border-bottom: 1px solid var(--border-subtle); }
.folder-list button { display: flex; width: 100%; height: 26px; align-items: center; gap: 6px; padding: 0 6px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 4px; font: inherit; font-size: 10.5px; cursor: pointer; }
.folder-list button:hover { background: var(--bg-hover); }.folder-list button.active { color: #cdd5ff; background: var(--bg-selected); border-color: var(--accent-border); }
.folder-list small { margin-left: auto; color: var(--text-muted); }.folder-indent { width: 11px; }
.section-label { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 5px; color: var(--text-secondary); font-size: 9px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; }
.section-label small { color: var(--text-muted); font-weight: 400; letter-spacing: 0; text-transform: none; }
.asset-list { padding: 0 6px 8px; }.asset-list.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.asset-card { display: flex; min-width: 0; align-items: center; gap: 7px; padding: 4px; overflow: hidden; color: var(--text-secondary); text-align: left; background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: grab; }
.grid .asset-card { display: block; padding: 3px; }.asset-card:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.asset-thumbnail { position: relative; display: grid; width: 64px; height: 39px; flex: 0 0 auto; place-items: center; overflow: hidden; color: #8993c7; background: #171a23; border: 1px solid #303440; border-radius: 3px; }
.grid .asset-thumbnail { width: 100%; height: auto; aspect-ratio: 16 / 9; }.asset-thumbnail img { width: 100%; height: 100%; object-fit: cover; }.asset-thumbnail.image img { transform: scale(1.45); }
.asset-kind { position: absolute; bottom: 2px; left: 3px; display: grid; width: 15px; height: 15px; place-items: center; color: #dce2ff; background: rgb(11 14 21 / .75); border-radius: 2px; backdrop-filter: blur(3px); }
.asset-thumbnail time { position: absolute; right: 3px; bottom: 2px; padding: 1px 3px; color: #eef0f8; background: rgb(10 12 17 / .72); border-radius: 2px; font-size: 8px; }
.asset-info { display: flex; min-width: 0; flex-direction: column; gap: 2px; padding: 4px 1px 1px; }.asset-info strong, .asset-info small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.asset-info strong { color: var(--text-secondary); font-size: 9.5px; font-weight: 520; }.asset-info small { color: var(--text-muted); font-size: 8.5px; }
.mini-wave { display: flex; height: 25px; align-items: center; gap: 1px; }.mini-wave i { width: 2px; background: #5f9e85; border-radius: 1px; }
.browser-list { min-height: 0; flex: 1; padding: 5px; overflow: auto; }.browser-list > button { display: flex; width: 100%; height: 37px; align-items: center; gap: 7px; padding: 0 6px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 4px; font: inherit; text-align: left; cursor: pointer; }.browser-list > button:hover { background: var(--bg-hover); border-color: var(--border-subtle); }.browser-list > button > span:nth-child(2) { display: flex; min-width: 0; flex: 1; flex-direction: column; }.browser-list strong { font-size: 10px; font-weight: 520; }.browser-list small { color: var(--text-muted); font-size: 8.5px; }.effect-icon { display: grid; width: 25px; height: 25px; place-items: center; color: var(--accent); background: var(--bg-selected); border-radius: 4px; }
.import-dropzone { display: flex; height: 32px; flex: 0 0 auto; align-items: center; justify-content: center; gap: 5px; margin: 6px; color: var(--text-secondary); background: #171a21; border: 1px dashed #3a3f4c; border-radius: 4px; font: inherit; font-size: 9.5px; cursor: pointer; }.import-dropzone:hover { color: var(--text-primary); border-color: var(--accent-border); }.import-dropzone span { color: var(--text-muted); }.hidden-input { display: none; }
.drop-overlay { position: absolute; z-index: 5; inset: 4px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 6px; color: #dbe0ff; background: rgb(28 32 49 / .92); border: 1px dashed var(--accent-border); border-radius: 5px; pointer-events: none; }.drop-overlay span { color: var(--text-muted); font-size: 10px; }
</style>
