<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorStore, type ClusterSettings } from '@/stores/editor'
import MDialog from './MDialog.vue'

const props = withDefaults(defineProps<{
  open: boolean
  mode?: 'create' | 'edit'
  assetId?: string
  name?: string
  width?: number
  height?: number
}>(), {
  mode: 'create', assetId: undefined, name: '', width: 1920, height: 1080,
})

const emit = defineEmits<{ close: []; confirm: [settings: ClusterSettings] }>()
const store = useEditorStore()
const clusterName = ref('')
const clusterWidth = ref(1920)
const clusterHeight = ref(1080)

watch(() => props.open, (open) => {
  if (!open) return
  clusterName.value = props.name
  clusterWidth.value = props.width
  clusterHeight.value = props.height
})

const trimmedName = computed(() => clusterName.value.trim())
const duplicateName = computed(() => Boolean(trimmedName.value)
  && !store.isClusterNameAvailable(trimmedName.value, props.assetId))
const invalid = computed(() => !trimmedName.value
  || duplicateName.value
  || !Number.isFinite(clusterWidth.value)
  || !Number.isFinite(clusterHeight.value)
  || clusterWidth.value < 16
  || clusterHeight.value < 16)

function confirm() {
  if (invalid.value) return
  emit('confirm', {
    name: trimmedName.value,
    width: Math.round(clusterWidth.value),
    height: Math.round(clusterHeight.value),
  })
}
</script>

<template>
  <MDialog
    :open="open"
    :title="mode === 'create' ? 'Create empty cluster' : 'Cluster settings'"
    description="Clusters use their own canvas size and publish a reusable Library item."
    :confirm-label="mode === 'create' ? 'Create cluster' : 'Save settings'"
    :confirm-disabled="invalid"
    @close="emit('close')"
    @confirm="confirm"
  >
    <div class="cluster-settings-form">
      <label><span>Name</span><input v-model="clusterName" autofocus maxlength="96" aria-label="Cluster name" /></label>
      <small v-if="duplicateName" class="field-error">A cluster with this name already exists.</small>
      <div class="dimension-grid">
        <label><span>Width</span><input v-model.number="clusterWidth" type="number" min="16" max="16384" step="1" aria-label="Cluster width" /></label>
        <label><span>Height</span><input v-model.number="clusterHeight" type="number" min="16" max="16384" step="1" aria-label="Cluster height" /></label>
      </div>
      <small>16–16384 px per side</small>
    </div>
  </MDialog>
</template>

<style scoped>
.cluster-settings-form { display: grid; gap: 8px; }.cluster-settings-form label { display: grid; gap: 4px; }.cluster-settings-form label > span { color: var(--text-secondary); font-size: 9px; }.dimension-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }.cluster-settings-form small { color: var(--text-muted); font-size: 8px; }.cluster-settings-form .field-error { margin-top: -4px; color: #d88991; }
</style>
