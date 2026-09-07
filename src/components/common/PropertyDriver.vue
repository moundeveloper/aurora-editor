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
.property-driver { flex: 0 0 auto; max-height: 160px; overflow: auto; padding: 5px 10px; color: #b9c1d3; background: #171a22; font-size: 11px; }summary { cursor: pointer; }input,button { color: inherit; background: #252a36; border: 1px solid #424958; padding: 4px; border-radius: 3px; }input { width: min(60vw,500px); }small { display:block; margin: 5px 0; }span[role=alert] { color: #f99; }
</style>
