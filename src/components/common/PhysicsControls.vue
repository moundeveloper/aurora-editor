<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { Aurora3DObject, Aurora3DScene } from '@/models/editor'
import { useEditorStore } from '@/stores/editor'
import MSelect from './MSelect.vue'
import NumberField from './NumberField.vue'
const props = defineProps<{object:Aurora3DObject;scene:Aurora3DScene}>()
const store = useEditorStore()
const start = ref(store.currentTime), end = ref(Math.min(store.project.duration,store.currentTime+3)), gravity = ref(-9.81), ground = ref(0)
const busy = ref(false), progress = ref(0), message = ref('')
let abort: AbortController | undefined
function enable() {
  props.object.rigidBody ??= {enabled:true,mode:'dynamic',mass:1,restitution:.3,friction:.4,velocity:[0,0,0],angularVelocity:[0,0,0]}
  props.object.rigidBody.enabled = true; store.markSceneChanged()
}
async function bake() {
  busy.value = true; message.value = ''; progress.value = 0; abort = new AbortController()
  const scene = props.scene, revision = scene.revision, from = start.value, to = end.value
  const snapshot = JSON.parse(JSON.stringify(scene)) as Aurora3DScene
  try {
    const {bakeRigidBodies,applyPhysicsBake} = await import('@/engine/scene3d/physicsBake')
    const results = await bakeRigidBodies(snapshot,{start:from,end:to,frameRate:store.project.frameRate,gravity:gravity.value,ground:ground.value,signal:abort.signal,progress:value => {progress.value = value}})
    if (abort.signal.aborted) return
    if (scene !== store.selectedScene || scene.revision !== revision) throw new Error('Scene changed during the bake. Bake again to use the latest edits.')
    applyPhysicsBake(scene,results,from,to); store.markSceneChanged(scene)
    message.value = `Baked ${results.length} bodies. Undo restores their previous animation.`
  } catch (error) { message.value = error instanceof Error ? error.message : String(error) }
  finally { busy.value = false }
}
onBeforeUnmount(() => abort?.abort())
</script>
<template>
  <section class="physics-controls">
    <strong>Rigid body bake</strong>
    <button v-if="!object.rigidBody?.enabled" type="button" @click="enable">Enable rigid body</button>
    <template v-else>
      <button type="button" :disabled="busy" @click="object.rigidBody.enabled = false; store.markSceneChanged()">Disable rigid body</button>
      <MSelect v-model="object.rigidBody.mode" :options="[{value:'dynamic',label:'Dynamic'},{value:'static',label:'Static collider'}]" label="Rigid body mode" @update:model-value="store.markSceneChanged()" />
      <label>Mass<NumberField v-model="object.rigidBody.mass" :min=".001" label="Body mass" @update:model-value="store.markSceneChanged()" /></label>
      <label>Bounce<NumberField v-model="object.rigidBody.restitution" :min="0" :max="1" :step=".05" label="Restitution" @update:model-value="store.markSceneChanged()" /></label>
      <label>Friction<NumberField v-model="object.rigidBody.friction" :min="0" :max="1" :step=".05" label="Body friction" @update:model-value="store.markSceneChanged()" /></label>
      <label v-for="(axis,index) in ['X','Y','Z']" :key="axis">Velocity {{ axis }}<NumberField v-model="object.rigidBody.velocity[index]!" :label="`Velocity ${axis}`" @update:model-value="store.markSceneChanged()" /></label>
      <label v-for="(axis,index) in ['X','Y','Z']" :key="`spin-${axis}`">Spin {{ axis }} (rad/s)<NumberField v-model="object.rigidBody.angularVelocity[index]!" :step=".1" :label="`Angular velocity ${axis}`" @update:model-value="store.markSceneChanged()" /></label>
      <label>Start (s)<NumberField v-model="start" :min="0" label="Physics bake start" /></label>
      <label>End (s)<NumberField v-model="end" :min="0" :max="store.project.duration" label="Physics bake end" /></label>
      <label>Gravity Y<NumberField v-model="gravity" :step=".1" label="Physics gravity" /></label>
      <label>Ground Y<NumberField v-model="ground" label="Physics ground height" /></label>
      <small>All enabled root cubes and spheres collide using primitive shapes at the start pose. Influences are excluded. Baking replaces position and rotation in this range and bypasses their drivers and modifiers.</small>
      <button v-if="!busy" type="button" :disabled="end <= start" @click="bake">Bake scene bodies to keyframes</button>
      <button v-else type="button" @click="abort?.abort()">Cancel bake · {{ Math.round(progress*100) }}%</button>
      <p v-if="message" role="status">{{ message }}</p>
    </template>
  </section>
</template>
<style scoped>
.physics-controls{display:flex;flex-direction:column;gap:7px;padding:9px;border-bottom:1px solid var(--border-subtle);font-size:10px;color:var(--text-secondary)}label{display:flex;justify-content:space-between;gap:8px}button{padding:5px;color:inherit;background:var(--bg-input);border:1px solid var(--border-strong)}small,p{color:var(--text-muted);line-height:1.4}
</style>
