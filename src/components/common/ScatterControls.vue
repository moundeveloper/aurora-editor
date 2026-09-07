<script setup lang="ts">
import { computed } from 'vue'
import type { Aurora3DObject, Aurora3DScene } from '@/models/editor'
import { useEditorStore } from '@/stores/editor'
import MSelect from './MSelect.vue'
import NumberField from './NumberField.vue'
const props = defineProps<{ object: Aurora3DObject; scene: Aurora3DScene }>()
const store = useEditorStore()
const targets = computed(() => [{value:'',label:'Choose target'}, ...(props.object.scatter?.mode === 'path'
  ? props.scene.paths : props.scene.objects.filter(item => item.id !== props.object.id && item.type === 'mesh' && item.primitive !== 'model'))
  .map(item => ({value:item.id,label:item.name}))])
function enable() {
  props.object.scatter ??= {enabled:true,targetId:'',mode:'surface',count:50,seed:1,jitter:0,scaleVariation:0,align:true}
  props.object.scatter.enabled = true
  store.markSceneChanged()
}
</script>
<template>
  <section class="scatter-controls">
    <strong>Scatter copies</strong>
    <button v-if="!object.scatter?.enabled" type="button" @click="enable">Enable scattering</button>
    <template v-else>
      <button type="button" @click="object.scatter.enabled = false; store.markSceneChanged()">Disable scattering</button>
      <MSelect v-model="object.scatter.mode" :options="[{value:'surface',label:'Mesh surface'},{value:'path',label:'Along path'}]" label="Scatter distribution" @update:model-value="object.scatter.targetId = ''; store.markSceneChanged()" />
      <MSelect v-model="object.scatter.targetId" :options="targets" label="Scatter target" @update:model-value="store.markSceneChanged()" />
      <label>Copies<NumberField v-model="object.scatter.count" :min="1" :max="5000" :step="1" label="Scatter count" @update:model-value="store.markSceneChanged()" /></label>
      <label>Seed<NumberField v-model="object.scatter.seed" :step="1" label="Scatter seed" @update:model-value="store.markSceneChanged()" /></label>
      <label>Position jitter<NumberField v-model="object.scatter.jitter" :min="0" :step=".05" label="Scatter position jitter" @update:model-value="store.markSceneChanged()" /></label>
      <label>Scale variation<NumberField v-model="object.scatter.scaleVariation" :min="0" :max="1" :step=".05" label="Scatter scale variation" @update:model-value="store.markSceneChanged()" /></label>
      <label><input v-model="object.scatter.align" type="checkbox" @change="store.markSceneChanged()" />Align Y axis to surface or path</label>
      <small>Copies follow the target in world space. The source remains editable and visible.</small>
    </template>
  </section>
</template>
<style scoped>
.scatter-controls{display:flex;flex-direction:column;gap:7px;padding:9px;border-bottom:1px solid var(--border-subtle);font-size:10px;color:var(--text-secondary)}label{display:flex;justify-content:space-between;gap:8px}button{padding:5px;color:inherit;background:var(--bg-input);border:1px solid var(--border-strong)}small{color:var(--text-muted)}
</style>
