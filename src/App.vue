<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Activity, CircleHelp, HardDrive, PanelBottomClose, PanelLeftClose, PanelRightClose, ShieldCheck } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import TopBar from '@/components/TopBar.vue'
import AssetPanel from '@/components/AssetPanel.vue'
import ViewerPanel from '@/components/ViewerPanel.vue'
import InspectorPanel from '@/components/InspectorPanel.vue'
import TimelinePanel from '@/components/TimelinePanel.vue'
import NodeWorkspace from '@/components/NodeWorkspace.vue'
import AudioWorkspace from '@/components/AudioWorkspace.vue'
import ExportWorkspace from '@/components/ExportWorkspace.vue'

const ThreeDWorkspace = defineAsyncComponent(() => import('@/components/ThreeDWorkspace.vue'))
const SceneHierarchyPanel = defineAsyncComponent(() => import('@/components/SceneHierarchyPanel.vue'))
const ThreeDInspectorPanel = defineAsyncComponent(() => import('@/components/ThreeDInspectorPanel.vue'))

const store = useEditorStore()
const { workspace, currentTime, project, selectedLayer } = storeToRefs(store)
const leftWidth = ref(224)
const rightWidth = ref(275)
const bottomHeight = ref(258)
const leftOpen = ref(true)
const rightOpen = ref(true)
const bottomOpen = ref(true)
const resizing = ref<'left' | 'right' | 'bottom' | null>(null)

const layoutStyle = computed(() => ({
  '--left-width': leftOpen.value ? `${leftWidth.value}px` : '0px',
  '--right-width': rightOpen.value ? `${rightWidth.value}px` : '0px',
  '--bottom-height': bottomOpen.value ? `${bottomHeight.value}px` : '0px',
}))

function startResize(type: 'left' | 'right' | 'bottom') {
  resizing.value = type
  document.body.classList.add('is-resizing')
}

function resize(event: PointerEvent) {
  if (!resizing.value) return
  if (resizing.value === 'left') leftWidth.value = Math.max(170, Math.min(360, event.clientX))
  if (resizing.value === 'right') rightWidth.value = Math.max(220, Math.min(390, window.innerWidth - event.clientX))
  if (resizing.value === 'bottom') bottomHeight.value = Math.max(150, Math.min(window.innerHeight * .55, window.innerHeight - event.clientY - 23))
}

function stopResize() {
  resizing.value = null
  document.body.classList.remove('is-resizing')
}

function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.matches('input, textarea')) return
  if (event.code === 'Space') { event.preventDefault(); store.togglePlayback() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); store.splitSelectedLayer() }
  if (event.key === 'ArrowLeft') store.stepFrame(-1)
  if (event.key === 'ArrowRight') store.stepFrame(1)
}

onMounted(() => {
  window.addEventListener('pointermove', resize)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', resize)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app-shell" :style="layoutStyle">
    <TopBar />

    <main v-if="workspace !== 'Export'" class="workspace-shell">
      <div class="upper-workspace">
        <div v-show="leftOpen" class="left-pane"><SceneHierarchyPanel v-if="workspace === '3D'" /><AssetPanel v-else /></div>
        <div v-show="leftOpen" class="pane-resizer vertical left" role="separator" aria-label="Resize asset browser" @pointerdown="startResize('left')" />

        <div class="center-pane">
          <ViewerPanel v-if="workspace === 'Motion'" />
          <NodeWorkspace v-else-if="workspace === 'Nodes'" />
          <ThreeDWorkspace v-else-if="workspace === '3D'" />
          <AudioWorkspace v-else />
        </div>

        <div v-show="rightOpen" class="pane-resizer vertical right" role="separator" aria-label="Resize inspector" @pointerdown="startResize('right')" />
        <div v-show="rightOpen" class="right-pane"><ThreeDInspectorPanel v-if="workspace === '3D'" /><InspectorPanel v-else /></div>
      </div>

      <div v-show="bottomOpen" class="pane-resizer horizontal" role="separator" aria-label="Resize timeline" @pointerdown="startResize('bottom')" />
      <div v-show="bottomOpen" class="bottom-pane"><TimelinePanel /></div>
    </main>

    <main v-else class="export-area"><ExportWorkspace /></main>

    <footer class="status-bar">
      <div class="panel-toggles">
        <button type="button" :class="{ active: leftOpen }" title="Toggle asset browser" @click="leftOpen = !leftOpen"><PanelLeftClose :size="12" /></button>
        <button type="button" :class="{ active: bottomOpen }" title="Toggle timeline" @click="bottomOpen = !bottomOpen"><PanelBottomClose :size="12" /></button>
        <button type="button" :class="{ active: rightOpen }" title="Toggle inspector" @click="rightOpen = !rightOpen"><PanelRightClose :size="12" /></button>
      </div>
      <span class="status-divider" />
      <span><ShieldCheck :size="11" /> Local-first</span>
      <span><HardDrive :size="11" /> 2.8 GB cache</span>
      <span class="status-spacer" />
      <span>{{ selectedLayer?.name || 'No selection' }}</span>
      <span class="status-divider" />
      <span class="render-stat"><Activity :size="11" /> 16.4 ms</span>
      <span>{{ Math.round(currentTime * project.frameRate) }} / {{ project.duration * project.frameRate }} frames</span>
      <button type="button" title="Help and shortcuts"><CircleHelp :size="12" /></button>
    </footer>
  </div>
</template>
