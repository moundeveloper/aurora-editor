<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Camera, ChevronDown, CircleDot, Diamond, SlidersHorizontal, Sun } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { AnimatableProperty } from '@/models/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import PanelHeader from './common/PanelHeader.vue'

const store = useEditorStore()
const { selectedScene, selectedSceneEntity, currentTime } = storeToRefs(store)
const collapsed = ref<Record<string, boolean>>({})
const entity = computed(() => selectedSceneEntity.value?.value)
const transform = computed(() => entity.value?.transform)

function setTransform(group: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', event: Event) {
  store.set3DEntityTransform(group, axis, Number((event.target as HTMLInputElement).value))
}

function toggle(section: string) {
  collapsed.value[section] = !collapsed.value[section]
}

function isKeyedAtPlayhead(property: AnimatableProperty<number>) {
  const tolerance = (0.5 / store.project.frameRate) + 0.0001
  return property.keyframes.some((keyframe) => Math.abs(keyframe.time - store.currentTime) <= tolerance)
}

function propertyValue(property: AnimatableProperty<number>) {
  return evaluateNumericProperty(property, currentTime.value)
}
</script>

<template>
  <aside class="three-inspector">
    <PanelHeader title="3D Inspector" :subtitle="selectedSceneEntity?.kind">
      <template #icon><SlidersHorizontal :size="13" /></template>
    </PanelHeader>
    <div v-if="selectedSceneEntity" class="entity-summary">
      <span class="entity-icon"><Box v-if="selectedSceneEntity.kind === 'object'" :size="14" /><Camera v-else-if="selectedSceneEntity.kind === 'camera'" :size="14" /><Sun v-else :size="14" /></span>
      <span><strong :title="entity?.name">{{ entity?.name }}</strong><small>{{ selectedSceneEntity.kind }} · {{ selectedScene?.name }}</small></span>
    </div>

    <div v-if="selectedSceneEntity && transform" class="inspector-scroll">
      <section class="property-section">
        <button class="section-header" type="button" @click="toggle('transform')"><ChevronDown :size="12" :class="{ closed: collapsed.transform }" /><span>Transform 3D</span><small>Local</small></button>
        <div v-if="!collapsed.transform" class="transform-groups">
          <div v-for="group in (['position', 'rotation', 'scale'] as const)" :key="group" class="transform-group">
            <strong>{{ group }}</strong>
            <label v-for="axis in (['x', 'y', 'z'] as const)" :key="axis" :class="axis">
              <span>{{ axis.toUpperCase() }}</span>
              <input :value="propertyValue(transform[group][axis])" type="number" :step="group === 'rotation' ? 1 : .1" @input="setTransform(group, axis, $event)" />
              <small>{{ group === 'rotation' ? '°' : '' }}</small>
              <button type="button" :title="`Toggle keyframe for ${group} ${axis}`" :class="{ animated: transform[group][axis].animated, keyed: isKeyedAtPlayhead(transform[group][axis]) }" @click.stop="store.toggle3DKeyframe(transform[group][axis].id)"><Diamond :size="9" :fill="isKeyedAtPlayhead(transform[group][axis]) ? 'currentColor' : 'none'" /></button>
            </label>
          </div>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'object'" class="property-section">
        <button class="section-header" type="button" @click="toggle('material')"><ChevronDown :size="12" :class="{ closed: collapsed.material }" /><span>PBR Material</span><small>Standard</small></button>
        <div v-if="!collapsed.material" class="property-list">
          <label><span>Base color</span><input class="color-field" :value="selectedSceneEntity.value.material.baseColor" type="color" @input="selectedSceneEntity.value.material.baseColor = ($event.target as HTMLInputElement).value; store.markSceneChanged()" /></label>
          <label v-for="property in (['metalness', 'roughness', 'opacity', 'emissiveIntensity'] as const)" :key="property"><span>{{ property }}</span><input :value="propertyValue(selectedSceneEntity.value.material[property])" type="number" min="0" :max="property === 'emissiveIntensity' ? 10 : 1" step=".05" @input="store.set3DObjectMaterial(property, Number(($event.target as HTMLInputElement).value))" /></label>
          <label class="check-row"><span>Cast shadows</span><button type="button" :class="{ checked: selectedSceneEntity.value.castShadow }" @click="selectedSceneEntity.value.castShadow = !selectedSceneEntity.value.castShadow; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
          <label class="check-row"><span>Receive shadows</span><button type="button" :class="{ checked: selectedSceneEntity.value.receiveShadow }" @click="selectedSceneEntity.value.receiveShadow = !selectedSceneEntity.value.receiveShadow; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'camera'" class="property-section">
        <div class="section-header static"><Camera :size="12" /><span>Camera</span><small>{{ selectedSceneEntity.value.projection }}</small></div>
        <div class="property-list"><label><span>Field of view</span><input :value="propertyValue(selectedSceneEntity.value.fov)" type="number" min="1" max="179" @input="store.set3DCameraFov(Number(($event.target as HTMLInputElement).value))" /></label><label><span>Near</span><input v-model.number="selectedSceneEntity.value.near" type="number" min=".001" step=".1" @input="store.markSceneChanged()" /></label><label><span>Far</span><input v-model.number="selectedSceneEntity.value.far" type="number" min="1" step="10" @input="store.markSceneChanged()" /></label><button class="active-camera" type="button" :disabled="selectedScene?.activeCameraId === selectedSceneEntity.value.id" @click="store.setActive3DCamera(selectedSceneEntity.value.id)">{{ selectedScene?.activeCameraId === selectedSceneEntity.value.id ? 'Active render camera' : 'Set as active camera' }}</button></div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'light'" class="property-section">
        <div class="section-header static"><Sun :size="12" /><span>Light</span><small>{{ selectedSceneEntity.value.type }}</small></div>
        <div class="property-list"><label><span>Color</span><input class="color-field" v-model="selectedSceneEntity.value.color" type="color" @input="store.markSceneChanged()" /></label><label><span>Intensity</span><input :value="propertyValue(selectedSceneEntity.value.intensity)" type="number" min="0" step=".1" @input="store.set3DLightIntensity(Number(($event.target as HTMLInputElement).value))" /></label><label class="check-row"><span>Cast shadows</span><button type="button" :class="{ checked: selectedSceneEntity.value.castShadow }" @click="selectedSceneEntity.value.castShadow = !selectedSceneEntity.value.castShadow; store.markSceneChanged()"><CircleDot :size="10" /></button></label></div>
      </section>

      <section class="property-section">
        <div class="section-header static"><Box :size="12" /><span>Renderer</span><small>WebGL2</small></div>
        <div class="metadata"><span>Color space</span><strong>sRGB</strong><span>Alpha</span><strong>Premultiplied</strong><span>Scene revision</span><strong>{{ selectedScene?.revision }}</strong></div>
      </section>
    </div>
    <div v-else class="empty-state"><Box :size="25" /><strong>No 3D selection</strong><span>Select an object, camera, or light in the scene hierarchy.</span></div>
  </aside>
</template>

<style scoped>
.three-inspector { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); }.entity-summary { display: flex; height: 49px; flex: 0 0 auto; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); }.entity-icon { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; color: #cdd5ff; background: #29304b; border: 1px solid #4d5787; border-radius: 4px; }.entity-summary > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 2px; }.entity-summary strong, .entity-summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.entity-summary strong { color: var(--text-primary); font-size: 10px; }.entity-summary small { color: var(--text-muted); font-size: 8px; text-transform: capitalize; }.inspector-scroll { min-height: 0; flex: 1; overflow: auto; }.property-section { border-bottom: 1px solid var(--border-subtle); }.section-header { display: grid; width: 100%; height: 28px; grid-template-columns: 14px 1fr auto; align-items: center; gap: 4px; padding: 0 7px; color: var(--text-secondary); text-align: left; background: #17191f; border: 0; font: inherit; cursor: pointer; }.section-header.static { cursor: default; }.section-header span { overflow: hidden; font-size: 9px; font-weight: 650; letter-spacing: .05em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }.section-header small { color: var(--text-muted); font-size: 7.5px; }.section-header svg.closed { transform: rotate(-90deg); }.transform-groups, .property-list { padding: 5px 6px 7px; }.transform-group { display: grid; grid-template-columns: 52px repeat(3, minmax(0, 1fr)); gap: 3px; margin-bottom: 4px; }.transform-group > strong { align-self: center; color: var(--text-muted); font-size: 8px; font-weight: 500; text-transform: capitalize; }.transform-group label { position: relative; display: flex; height: 23px; min-width: 0; align-items: center; overflow: hidden; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.transform-group label:focus-within { border-color: var(--focus); }.transform-group label > span { width: 15px; padding-left: 4px; font-size: 7px; font-weight: 700; }.transform-group label.x > span { color: #df7886; }.transform-group label.y > span { color: #6bb88f; }.transform-group label.z > span { color: #7998e4; }.transform-group input { width: 100%; min-width: 0; padding: 0 2px; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 8px; }.transform-group label > small { color: var(--text-muted); font-size: 7px; }.transform-group label > button { display: grid; width: 17px; height: 100%; flex: 0 0 auto; place-items: center; padding: 0; color: #565b68; background: transparent; border: 0; border-left: 1px solid var(--border-subtle); cursor: pointer; }.transform-group label > button.animated { color: #9aa8ff; }.transform-group label > button.keyed { color: #e3e7ff; background: var(--bg-selected); }.property-list { display: grid; gap: 5px; }.property-list > label { display: grid; min-height: 24px; grid-template-columns: 1fr 86px; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 8.5px; }.property-list input { width: 100%; height: 23px; padding: 0 5px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; outline: 0; font: inherit; font-size: 8.5px; }.property-list input:focus { border-color: var(--focus); }.property-list input.color-field { padding: 2px; }.check-row button { display: grid; width: 23px; height: 20px; justify-self: end; place-items: center; padding: 0; color: #525762; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; cursor: pointer; }.check-row button.checked { color: #cdd5ff; background: var(--bg-selected); border-color: var(--accent-border); }.active-camera { height: 26px; color: #101219; background: var(--button-accent); border: 1px solid #aab4ff; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; }.active-camera:disabled { color: #8f96ad; background: #202432; border-color: #383e52; cursor: default; }.metadata { display: grid; grid-template-columns: 1fr auto; gap: 7px 10px; padding: 7px 8px 9px; font-size: 8px; }.metadata span { color: var(--text-muted); }.metadata strong { color: var(--text-secondary); font-weight: 500; }.empty-state { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 6px; padding: 20px; color: var(--text-muted); text-align: center; }.empty-state svg { color: var(--accent); }.empty-state strong { color: var(--text-primary); font-size: 10px; }.empty-state span { font-size: 8.5px; line-height: 1.4; }
</style>
