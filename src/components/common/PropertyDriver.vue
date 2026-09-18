<script setup lang="ts">
import { computed } from 'vue'
import type { AnimatableProperty } from '@/models/editor'
import { useEditorStore } from '@/stores/editor'
import { collectNumericProperties } from '@/engine/animation/propertyScope'
import { compileExpression } from '@/engine/animation/expressions'
import MSelect from './MSelect.vue'

const props = defineProps<{ property: AnimatableProperty<number> }>()
const emit = defineEmits<{ change: [] }>()
const store = useEditorStore()
const options = computed(() => [
  { value: '', label: 'No source (time / value only)' },
  ...store.layers.filter(layer => layer.type === 'audio').map(layer => ({ value: `audio:${layer.id}`, label: `Audio amplitude · ${layer.name}` })),
  ...[...collectNumericProperties({ layers: store.layers, scenes: store.scenes3D, rigs: store.rigs }).keys()]
    .filter(id => id !== props.property.id).map(id => ({ value: id, label: id })),
])
const error = computed(() => {
  if (!props.property.driver) return ''
  try { compileExpression(props.property.driver.expression); return '' } catch (error) { return String(error) }
})
function toggle() {
  if (!props.property.driver) props.property.driver = { enabled: true, sourceId: '', expression: 'value + sin(time * 2 * pi) * 10' }
  else props.property.driver.enabled = !props.property.driver.enabled
  emit('change')
}
</script>
<template>
  <details class="property-driver">
    <summary>Property driver {{ property.driver?.enabled ? '· On' : '' }}</summary>
    <button type="button" :aria-pressed="property.driver?.enabled ?? false" @click="toggle">{{ property.driver?.enabled ? 'Disable driver' : 'Enable driver' }}</button>
    <template v-if="property.driver">
      <MSelect v-model="property.driver.sourceId" :options="options" label="Driver source" @update:model-value="emit('change')" />
      <label>Expression <input v-model="property.driver.expression" aria-label="Driver expression" :aria-invalid="Boolean(error)" @change="emit('change')" /></label>
      <span v-if="error" role="alert">{{ error }}</span>
      <small>time: seconds · value: keyed value · source: linked value or audio RMS. Math: sin, cos, abs, min, max, clamp, pow, sqrt, floor, ceil, round.</small>
    </template>
  </details>
</template>
<style scoped>
.property-driver { display: grid; gap: 6px; max-height: 175px; padding: 7px 9px; overflow: auto; color: var(--text-secondary); background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); font-size: 10px; } summary { color: var(--text-muted); cursor: pointer; } input, button { height: 24px; min-width: 0; padding: 0 7px; color: inherit; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; } input { width: 100%; } button { width: fit-content; cursor: pointer; white-space: nowrap; } button:hover { color: var(--text-primary); background: var(--bg-hover); border-color: var(--accent-border); } button[aria-pressed=true] { color: var(--accent); background: var(--bg-selected); border-color: var(--accent-border); } label { display: grid; gap: 3px; color: var(--text-muted); } small { display: block; margin: 1px 0; color: var(--text-muted); line-height: 1.4; } span[role=alert] { color: var(--danger); }
</style>
