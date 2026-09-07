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
.cluster-parameters{display:flex;flex-direction:column;gap:8px;padding:10px;border-bottom:1px solid #343947;color:#b9c1d3;font-size:11px}label{display:flex;align-items:center;gap:5px}input,button{color:inherit;background:#252b37;border:1px solid #454e61;padding:4px;max-width:100%;min-width:0}summary{cursor:pointer}
</style>
