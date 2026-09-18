<script setup lang="ts">
import type { Aurora3DObject, Aurora3DScene } from '@/models/editor'
import { useEditorStore } from '@/stores/editor'
import MSelect from './MSelect.vue'
const props=defineProps<{object:Aurora3DObject;scene:Aurora3DScene}>(),store=useEditorStore()
function mode(value:'all'|'include'|'exclude') {props.object.lightLink={mode:value,ids:props.object.lightLink?.ids ?? []};store.markSceneChanged()}
function toggle(id:string) {const link=props.object.lightLink!;link.ids=link.ids.includes(id)?link.ids.filter(value=>value!==id):[...link.ids,id];store.markSceneChanged()}
</script>
<template>
  <section class="light-links"><strong>Light linking</strong>
    <MSelect :model-value="object.lightLink?.mode ?? 'all'" :options="[{value:'all',label:'All lights'},{value:'include',label:'Only selected lights'},{value:'exclude',label:'Exclude selected lights'}]" label="Light linking mode" @update:model-value="mode($event as 'all'|'include'|'exclude')" />
    <template v-if="object.lightLink && object.lightLink.mode !== 'all'"><label v-for="light in scene.lights" :key="light.id"><input type="checkbox" :checked="object.lightLink.ids.includes(light.id)" @change="toggle(light.id)" />{{light.name}}</label></template>
    <small>Controls illumination on this surface. Environment lighting and shadow casting remain separate.</small>
  </section>
</template>
<style scoped>
.light-links { display: flex; flex-direction: column; gap: 7px; padding: 9px; color: var(--text-secondary); border-bottom: 1px solid var(--border-subtle); font-size: 10px; }.light-links > strong { color: var(--text-primary); font-weight: 620; } label { display: flex; align-items: center; gap: 6px; min-height: 22px; padding: 0 5px; background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 3px; } input { accent-color: var(--button-accent); } small { color: var(--text-muted); line-height: 1.4; }
</style>
