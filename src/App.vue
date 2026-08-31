<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { Activity, CircleHelp, HardDrive, PanelBottomClose, PanelLeftClose, PanelRightClose, ShieldCheck } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import TopBar from '@/components/TopBar.vue'
import AssetPanel from '@/components/AssetPanel.vue'
import ViewerPanel from '@/components/ViewerPanel.vue'
import InspectorPanel from '@/components/InspectorPanel.vue'
import TimelinePanel from '@/components/TimelinePanel.vue'
import NodeWorkspace from '@/components/NodeWorkspace.vue'
import NodePreviewPanel from '@/components/NodePreviewPanel.vue'
import MaskEdgePanel from '@/components/MaskEdgePanel.vue'
import AudioWorkspace from '@/components/AudioWorkspace.vue'
import ExportWorkspace from '@/components/ExportWorkspace.vue'
import ProjectBrowser from '@/components/ProjectBrowser.vue'

const ThreeDWorkspace = defineAsyncComponent(() => import('@/components/ThreeDWorkspace.vue'))
const ThreeDPreviewPanel = defineAsyncComponent(() => import('@/components/ThreeDPreviewPanel.vue'))
const SceneHierarchyPanel = defineAsyncComponent(() => import('@/components/SceneHierarchyPanel.vue'))
const ThreeDInspectorPanel = defineAsyncComponent(() => import('@/components/ThreeDInspectorPanel.vue'))
const ThreeDTimelinePanel = defineAsyncComponent(() => import('@/components/ThreeDTimelinePanel.vue'))

const store = useEditorStore()
const { workspace, currentTime, project, selectedLayer, nodes, selectedNodeId } = storeToRefs(store)
const route = useRoute()
const router = useRouter()
const homeOpen = computed(() => route.name !== 'project')
const leftWidth = ref(224)
const rightWidth = ref(275)
const bottomHeight = ref(258)
const leftOpen = ref(true)
const rightOpen = ref(true)
const bottomOpen = ref(true)
const nodePreviewHeight = computed(() => Math.round(Math.max(120, (rightWidth.value - 28) * 9 / 16 + 50)))
const maskEditorOpen = computed(() => workspace.value === 'Nodes' && nodes.value.some((node) => node.id === selectedNodeId.value && node.kind === 'mask'))
const inspectorAvailable = computed(() => workspace.value !== 'Audio')
const inspectorVisible = computed(() => inspectorAvailable.value && rightOpen.value)
const resizing = ref<'left' | 'right' | 'bottom' | null>(null)

const layoutStyle = computed(() => ({
  '--left-width': leftOpen.value ? `${leftWidth.value}px` : '0px',
  '--right-width': inspectorVisible.value ? `${rightWidth.value}px` : '0px',
  '--bottom-height': bottomOpen.value ? `${bottomHeight.value}px` : '0px',
  '--node-preview-height': `${nodePreviewHeight.value}px`,
}))

function startResize(type: 'left' | 'right' | 'bottom') {
  resizing.value = type
  document.body.classList.add('is-resizing')
  document.body.dataset.resize = type
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
  delete document.body.dataset.resize
}

function onKeydown(event: KeyboardEvent) {
  if (homeOpen.value) return
  if ((event.target as HTMLElement)?.matches('input, textarea')) return
  if (event.code === 'Space') { event.preventDefault(); store.togglePlayback() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); store.splitSelectedLayer() }
  if (event.key === 'ArrowLeft') store.stepFrame(-1)
  if (event.key === 'ArrowRight') store.stepFrame(1)
}

watch(() => route.params.projectId, async (projectId) => {
  if (typeof projectId !== 'string' || projectId === project.value.id) return
  if (!await store.openProject(projectId)) await router.replace('/')
}, { immediate: true })

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
  <ProjectBrowser v-if="homeOpen" />
  <div v-else class="app-shell" :style="layoutStyle">
    <TopBar />

    <main v-if="workspace !== 'Export'" class="workspace-shell">
      <div class="upper-workspace" :class="{ 'no-right-pane': !inspectorVisible }">
        <div v-show="leftOpen" class="left-pane"><SceneHierarchyPanel v-if="workspace === '3D'" /><AssetPanel v-else /></div>
        <div v-show="leftOpen" class="pane-resizer vertical left" role="separator" aria-label="Resize asset browser" @pointerdown="startResize('left')" />

        <div class="center-pane">
          <ViewerPanel v-if="workspace === 'Motion'" />
          <NodeWorkspace v-else-if="workspace === 'Nodes'" />
          <ThreeDWorkspace v-else-if="workspace === '3D'" />
          <AudioWorkspace v-else />
        </div>

        <div v-show="inspectorVisible" class="pane-resizer vertical right" role="separator" aria-label="Resize inspector" @pointerdown="startResize('right')" />
        <div v-show="inspectorVisible" class="right-pane" :class="{ 'preview-right-pane': workspace === 'Nodes' || workspace === '3D', 'mask-editor-open': maskEditorOpen }">
          <template v-if="workspace === 'Nodes'">
            <NodePreviewPanel />
            <MaskEdgePanel v-if="maskEditorOpen" />
            <div class="node-inspector-pane"><InspectorPanel /></div>
          </template>
          <template v-else-if="workspace === '3D'">
            <ThreeDPreviewPanel />
            <div class="node-inspector-pane"><ThreeDInspectorPanel /></div>
          </template>
          <InspectorPanel v-else />
        </div>
      </div>

      <div v-show="bottomOpen" class="pane-resizer horizontal" role="separator" aria-label="Resize timeline" @pointerdown="startResize('bottom')" />
      <div v-show="bottomOpen" class="bottom-pane"><ThreeDTimelinePanel v-if="workspace === '3D'" /><TimelinePanel v-else /></div>
    </main>

    <main v-else class="export-area"><ExportWorkspace /></main>

    <footer class="status-bar">
      <div class="panel-toggles">
        <button type="button" :class="{ active: leftOpen }" title="Toggle asset browser" @click="leftOpen = !leftOpen"><PanelLeftClose :size="12" /></button>
        <button type="button" :class="{ active: bottomOpen }" title="Toggle timeline" @click="bottomOpen = !bottomOpen"><PanelBottomClose :size="12" /></button>
        <button v-if="inspectorAvailable" type="button" :class="{ active: rightOpen }" title="Toggle inspector" @click="rightOpen = !rightOpen"><PanelRightClose :size="12" /></button>
      </div>
      <span class="status-divider" />
      <span><ShieldCheck :size="11" /> Local-first</span>
      <span><HardDrive :size="11" /> 2.8 GB cache</span>
      <span class="status-spacer" />
      <span>{{ selectedLayer?.name || 'No selection' }}</span>
      <span class="status-divider" />
      <span class="render-stat"><Activity :size="11" /> 16.4 ms</span>
      <span>{{ Math.round(currentTime * project.frameRate) }} / {{ Math.ceil(project.duration * project.frameRate) }} frames</span>
      <button type="button" title="Help and shortcuts"><CircleHelp :size="12" /></button>
    </footer>
  </div>
</template>
