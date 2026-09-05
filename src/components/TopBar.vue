<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { Command, Download, House, Redo2, Save, Undo2 } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { WorkspaceId } from '@/models/editor'
import IconButton from './common/IconButton.vue'

const store = useEditorStore()
const emit = defineEmits<{ 'open-command-palette': [] }>()
const router = useRouter()
const { project, workspace, canUndo, canRedo } = storeToRefs(store)
const workspaces: WorkspaceId[] = ['Motion', 'Nodes', '3D', 'Audio', 'Export']
const menus = ['File', 'Edit', 'Clip', 'Composition', 'Layer', 'Effect', 'Animation', 'View', 'Window', 'Help']

async function goHome() {
  await store.flushProjectSave()
  await router.push('/')
}
</script>

<template>
  <header class="app-topbar">
    <button class="home-button" type="button" title="All projects" aria-label="Go to project browser" @click="goHome"><House :size="14" /></button>
    <div class="brand-lockup">
      <div class="project-identity">
        <span class="project-name">{{ project.name }}</span>
        <span class="project-meta">{{ project.width }}×{{ project.height }} · {{ project.frameRate }} fps</span>
      </div>
    </div>

    <nav class="main-menu" aria-label="Application menu">
      <button v-for="menu in menus" :key="menu" type="button">{{ menu }}</button>
    </nav>

    <div class="workspace-switcher" aria-label="Workspace">
      <button
        v-for="item in workspaces"
        :key="item"
        type="button"
        :class="{ active: workspace === item }"
        @click="store.setWorkspace(item)"
      >{{ item }}</button>
    </div>

    <div class="topbar-actions">
      <IconButton :icon="Undo2" label="Undo (Ctrl+Z)" :disabled="!canUndo" @click="store.undo()" />
      <IconButton :icon="Redo2" label="Redo (Ctrl+Shift+Z / Ctrl+Y)" :disabled="!canRedo" @click="store.redo()" />
      <span class="divider" />
      <button class="top-action" type="button" @click="store.saveProjectNow()"><Save :size="13" /> Save</button>
      <button class="top-action primary" type="button" @click="store.setWorkspace('Export')"><Download :size="13" /> Export</button>
    </div>
  </header>
  <div class="menu-strip">
    <button class="command-hint" type="button" title="Open command palette" @click="emit('open-command-palette')"><Command :size="12" /> Ctrl K</button>
    <span class="spacer" />
    <span class="status-dot" />
    <span>Local project</span>
  </div>
</template>

<style scoped>
.app-topbar { display: flex; height: 39px; min-width: 1080px; align-items: center; gap: 12px; padding: 0 8px; border-bottom: 1px solid var(--border-subtle); background: #12141a; user-select: none; }
.home-button { display: grid; width: 27px; height: 27px; flex: 0 0 auto; place-items: center; padding: 0; color: #cbd3ff; background: #232943; border: 1px solid #6e7ed0; border-radius: 4px; cursor: pointer; }.home-button:hover { color: #eef0ff; background: #2b3252; border-color: #8290df; }.brand-lockup { display: flex; width: 182px; min-width: 150px; align-items: center; gap: 8px; }
.project-identity { display: flex; min-width: 0; flex-direction: column; line-height: 1.15; }
.project-name { overflow: hidden; color: var(--text-primary); font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.project-meta { color: var(--text-muted); font-size: 9px; }
.main-menu { display: flex; align-items: center; gap: 1px; }
.main-menu button, .workspace-switcher button { height: 27px; padding: 0 7px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 4px; font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.main-menu button:hover { color: var(--text-primary); background: var(--bg-hover); }
.workspace-switcher { display: flex; margin-left: auto; padding: 2px; border: 1px solid var(--border-subtle); border-radius: 5px; background: #0e1015; }
.workspace-switcher button { height: 24px; padding: 0 9px; font-size: 10.5px; }
.workspace-switcher button.active { color: #dce2ff; background: #282e49; border-color: #59669b; }
.topbar-actions { display: flex; align-items: center; gap: 3px; }
.divider { width: 1px; height: 18px; margin: 0 3px; background: var(--border-subtle); }
.top-action { display: inline-flex; height: 27px; align-items: center; gap: 5px; padding: 0 9px; color: var(--text-primary); background: #20232b; border: 1px solid var(--border-strong); border-radius: 4px; font: inherit; font-size: 10.5px; cursor: pointer; white-space: nowrap; }
.top-action:hover { background: #282c36; }
.top-action.primary { color: #10121a; background: var(--button-accent); border-color: #a8b2ff; font-weight: 650; }
.top-action.primary:hover { background: var(--button-accent-hover); }
.menu-strip { display: flex; height: 24px; align-items: center; gap: 7px; padding: 0 10px; color: var(--text-muted); background: #0d0f13; border-bottom: 1px solid var(--border-subtle); font-size: 10px; }
.menu-strip strong { color: var(--text-secondary); font-weight: 500; }
.command-hint { display: inline-flex; align-items: center; gap: 4px; margin-right: 7px; padding: 0; color: inherit; background: transparent; border: 0; font: inherit; cursor: pointer; }.command-hint:hover { color: var(--text-primary); }
.slash { color: #444853; }.spacer { flex: 1; }.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 2px #1c2c27; }
@media (max-width: 1280px) { .main-menu button:nth-child(n+7) { display: none; } .project-meta { display: none; } }
</style>
