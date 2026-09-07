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
.versions { position: fixed; z-index: 80; inset: 12% 15%; display:flex; flex-direction:column; gap: 10px; padding: 18px; background: #191c24; color:#d0d6e4; border:1px solid #4b5468; border-radius:8px; box-shadow:0 15px 60px #000a; font-size:12px; }header,.capture {display:flex; justify-content:space-between; gap:10px;}button,input { color:inherit; background:#292f3c; padding:6px 10px; border:1px solid #4b5468; border-radius:4px; }input {flex:1;}p {margin:0;color:#a0aabc}.diff {overflow:auto;min-height:0;}article {padding:8px 0;border-bottom:1px solid #353b48;}del,ins {display:block;overflow-wrap:anywhere;text-decoration:none;white-space:pre-wrap;}del{color:#eaa4a4}ins{color:#9bd2b1}
</style>
