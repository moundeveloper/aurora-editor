<script setup lang="ts">
import type {EditorLayer} from '@/models/editor'
import {useEditorStore} from '@/stores/editor'
import {shapePointChannel} from '@/engine/shapes/shapeAnimation'
import {evaluateNumericProperty} from '@/engine/animation/evaluateProperty'
import {setNumericPropertyAtTime} from '@/engine/animation/editNumericProperty'
import NumberField from './NumberField.vue'
import KeyframeControl from './KeyframeControl.vue'
defineProps<{layer:EditorLayer}>()
const store=useEditorStore()
</script>
<template>
  <section class="shape-points"><strong>Path animation</strong>
    <details v-for="(point,index) in layer.shapePath?.points" :key="point.id"><summary>Point {{index+1}}</summary>
      <div v-for="key in (['position','handleIn','handleOut'] as const)" :key="key">
        <label v-for="axis in (['X','Y'] as const)" :key="axis">{{key}} {{axis}}
          <NumberField :model-value="point.channels?.[`${key}${axis}`] ? evaluateNumericProperty(point.channels[`${key}${axis}`]!,store.currentTime) : point[key][axis==='X'?0:1]" :label="`Point ${index+1} ${key} ${axis}`" @update:model-value="setNumericPropertyAtTime(shapePointChannel(point,key,axis),$event,store.currentTime,store.project.frameRate,{autoKey:store.autoKey});store.markChanged()" />
          <KeyframeControl v-if="point.channels?.[`${key}${axis}`]" :property="point.channels[`${key}${axis}`]!" :label="`Point ${index+1} ${key} ${axis}`" />
          <button v-else type="button" :aria-label="`Animate point ${index+1} ${key} ${axis}`" @click="shapePointChannel(point,key,axis);store.markChanged()">◇</button>
        </label>
      </div>
    </details>
  </section>
</template>
<style scoped>
.shape-points{padding:9px;font-size:10px;color:var(--text-secondary);border-bottom:1px solid var(--border-subtle)}details{margin-top:6px}summary{cursor:pointer}label{display:flex;align-items:center;gap:4px;margin-top:5px}button{background:var(--bg-input);border:1px solid var(--border-strong);color:inherit}
</style>
