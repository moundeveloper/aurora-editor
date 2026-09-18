<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EditorLayer } from '@/models/editor'
import { useEditorStore } from '@/stores/editor'
import { collectNumericProperties } from '@/engine/animation/propertyScope'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { setNumericPropertyAtTime } from '@/engine/animation/editNumericProperty'
import MSelect from './MSelect.vue'
import NumberField from './NumberField.vue'
const props = defineProps<{ layer: EditorLayer }>()
const store = useEditorStore(), selected = ref(''), label = ref('')
const properties = computed(() => collectNumericProperties(props.layer.children))
const options = computed(() => [...properties.value.keys()].map(id => ({ value: id, label: id })))
const exposed = computed(() => (props.layer.publicParameters ?? []).flatMap(parameter => {
  const property = properties.value.get(parameter.propertyId)
  return property ? [{ ...parameter, property }] : []
}))
function expose() {
  const id = selected.value || options.value[0]?.value
  if (!id || props.layer.publicParameters?.some(parameter => parameter.propertyId === id)) return
  ;(props.layer.publicParameters ??= []).push({ id: crypto.randomUUID(), propertyId: id, label: label.value.trim() || id })
  label.value = ''; store.markChanged()
}
</script>
<template>
  <section class="cluster-parameters">
    <strong>Template controls</strong>
    <label v-for="parameter in exposed" :key="parameter.id">{{ parameter.label }}<NumberField :model-value="evaluateNumericProperty(parameter.property, store.currentTime)" :label="parameter.label" @update:model-value="setNumericPropertyAtTime(parameter.property, $event, store.currentTime, store.project.frameRate, { autoKey: store.autoKey }); store.markChanged()" /><button type="button" :aria-label="`Unpublish ${parameter.label}`" @click="layer.publicParameters = layer.publicParameters!.filter(item => item.id !== parameter.id); store.markChanged()">×</button></label>
    <details><summary>Publish a control</summary><MSelect v-model="selected" :options="options" label="Template property" /><input v-model="label" placeholder="Control label" aria-label="Template control label" /><button type="button" :disabled="!options.length" @click="expose">Publish control</button></details>
  </section>
</template>
<style scoped>
.cluster-parameters { display: flex; flex-direction: column; gap: 7px; padding: 9px; color: var(--text-secondary); border-bottom: 1px solid var(--border-subtle); font-size: 10px; }
.cluster-parameters > strong { color: var(--text-primary); font-size: 10px; font-weight: 620; }
label { display: flex; min-width: 0; align-items: center; gap: 5px; }
label > :deep(.number-field) { min-width: 0; margin-left: auto; }
input, button { height: 24px; min-width: 0; max-width: 100%; padding: 0 6px; color: inherit; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; }
button { cursor: pointer; white-space: nowrap; } button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); border-color: var(--accent-border); } button:disabled { opacity: .45; cursor: default; }
details { display: grid; gap: 6px; padding-top: 2px; } summary { color: var(--text-muted); cursor: pointer; } details :deep(.m-select) { width: 100%; }
</style>
