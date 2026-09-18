<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { projectVersions, snapshotDiff, type ProjectVersion } from '@/engine/project/projectVersions'
import MSelect from './common/MSelect.vue'
const emit = defineEmits<{ close: [] }>()
const store = useEditorStore()
const name = ref(''), versions = ref<ProjectVersion[]>([]), selected = ref(''), compare = ref('current'), error = ref(''), busy = ref(false)
const options = computed(() => versions.value.map(version => ({ value: version.id, label: `${version.name} · ${new Date(version.createdAt).toLocaleString()}` })))
const active = computed(() => versions.value.find(version => version.id === selected.value))
const compared = computed(() => compare.value === 'current' ? store.projectSnapshot() : versions.value.find(version => version.id === compare.value)?.snapshot)
const changes = computed(() => active.value && compared.value ? snapshotDiff(active.value.snapshot, compared.value) : [])
async function load() { versions.value = (await projectVersions.versions.where('projectId').equals(store.project.id).sortBy('createdAt')).reverse(); selected.value ||= versions.value[0]?.id ?? '' }
async function capture() {
  busy.value = true; error.value = ''
  try { selected.value = (await projectVersions.capture(name.value, store.projectSnapshot())).id; name.value = ''; await load() }
  catch (e) { error.value = String(e) } finally { busy.value = false }
}
function restore() { if (active.value) store.restoreProjectVersion(active.value.snapshot) }
watch(() => store.project.id, () => { selected.value = ''; void load().catch(e => { error.value = String(e) }) }, { immediate: true })
</script>
<template>
  <section class="versions" role="dialog" aria-label="Project versions">
    <header><strong>Project versions</strong><button type="button" aria-label="Close versions" @click="emit('close')">×</button></header>
    <div class="capture"><input v-model="name" placeholder="Snapshot name" aria-label="Snapshot name" /><button type="button" :disabled="busy" @click="capture">Save snapshot</button></div>
    <p>Snapshots are stored on this device. Restoring creates an undoable edit.</p>
    <MSelect v-model="selected" :options="options" label="Saved snapshot" />
    <MSelect v-model="compare" :options="[{ value: 'current', label: 'Current project' }, ...options]" label="Compare snapshot with" />
    <button type="button" :disabled="!active" @click="restore">Restore selected snapshot</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p>{{ changes.length }} changes</p>
    <div class="diff"><article v-for="change in changes" :key="change.path"><strong>{{ change.path }}</strong><del>{{ change.before }}</del><ins>{{ change.after }}</ins></article></div>
  </section>
</template>
<style scoped>
.versions { position: fixed; z-index: 80; inset: 12% 15%; display: flex; flex-direction: column; gap: 8px; padding: 12px; color: var(--text-secondary); background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: 4px; box-shadow: 0 15px 48px rgb(0 0 0 / .62); font-size: 10px; }
header, .capture { display: flex; align-items: center; gap: 7px; }
header { min-height: 25px; padding-bottom: 7px; color: var(--text-primary); border-bottom: 1px solid var(--border-subtle); }
header strong { flex: 1; font-size: 11px; font-weight: 620; }
button, input { height: 25px; min-width: 0; padding: 0 8px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; }
button { cursor: pointer; white-space: nowrap; }
button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); border-color: var(--accent-border); }
button:disabled { opacity: .45; cursor: default; }
header button { display: grid; width: 23px; place-items: center; padding: 0; font-size: 15px; line-height: 1; }
.capture input { flex: 1; }
.capture button, .versions > button { color: #151827; background: var(--button-accent); border-color: var(--button-accent); font-weight: 650; }
.capture button:hover:not(:disabled), .versions > button:hover:not(:disabled) { color: #10131c; background: var(--button-accent-hover); border-color: var(--button-accent-hover); }
p { margin: 0; color: var(--text-muted); line-height: 1.4; }
p[role=alert] { color: var(--danger); }
.diff { min-height: 0; padding: 0 2px; overflow: auto; border-top: 1px solid var(--border-subtle); }
article { display: grid; gap: 3px; padding: 7px 2px; border-bottom: 1px solid var(--border-subtle); }
article strong { overflow: hidden; color: var(--text-primary); font-size: 9px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
del, ins { display: block; overflow-wrap: anywhere; text-decoration: none; white-space: pre-wrap; }
del { color: #d98b90; } ins { color: #80bb9c; }
</style>
