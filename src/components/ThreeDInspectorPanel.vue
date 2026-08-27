<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Camera, ChevronDown, ChevronUp, CircleDot, Lock, Plus, RotateCcw, SlidersHorizontal, Spline, Sun, Target, Trash2 } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { AnimatableProperty, Aurora3DPathPoint, AuroraPathPointMode } from '@/models/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { INFLUENCE_DEFINITIONS, INFLUENCE_TYPES, influenceParameters } from '@/engine/scene3d/influences'
import { cameraIdAtTime } from '@/engine/scene3d/cameraCuts'
import type { PathHandleKey } from '@/engine/scene3d/pathEditing'
import KeyframeControl from './common/KeyframeControl.vue'
import PanelHeader from './common/PanelHeader.vue'

const store = useEditorStore()
const { selectedScene, selectedSceneEntity, currentTime } = storeToRefs(store)
const collapsed = ref<Record<string, boolean>>({})
const expandedPoints = ref<Record<string, boolean>>({})
const entity = computed(() => selectedSceneEntity.value?.value)
const transform = computed(() => entity.value?.transform)
const scenePaths = computed(() => selectedScene.value?.paths ?? [])
const programCameraId = computed(() => selectedScene.value ? cameraIdAtTime(selectedScene.value, currentTime.value) : null)
const lookAtCandidates = computed(() => {
  const scene = selectedScene.value
  if (!scene) return []
  return [
    ...scene.objects.map((item) => ({ id: item.id, name: item.name, group: 'Objects' })),
    ...scene.lights.map((item) => ({ id: item.id, name: item.name, group: 'Lights' })),
    ...scene.cameras.filter((item) => item.id !== entity.value?.id).map((item) => ({ id: item.id, name: item.name, group: 'Cameras' })),
  ]
})

function setTransform(group: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', event: Event) {
  store.set3DEntityTransform(group, axis, Number((event.target as HTMLInputElement).value))
}

function toggle(section: string) {
  collapsed.value[section] = !collapsed.value[section]
}

function propertyValue(property: AnimatableProperty<number>) {
  return evaluateNumericProperty(property, currentTime.value)
}

function setPathAxis(pathId: string, point: Aurora3DPathPoint, target: PathHandleKey, axis: 0 | 1 | 2, event: Event) {
  store.set3DPathPointAxis(pathId, point.id, target, axis, Number((event.target as HTMLInputElement).value))
}

function pointModeLabel(mode: AuroraPathPointMode) {
  return mode === 'smooth' ? 'Smooth' : 'Corner'
}
</script>

<template>
  <aside class="three-inspector">
    <PanelHeader title="3D Inspector" :subtitle="selectedSceneEntity?.kind">
      <template #icon><SlidersHorizontal :size="13" /></template>
    </PanelHeader>
    <div v-if="selectedSceneEntity" class="entity-summary">
      <span class="entity-icon"><Box v-if="selectedSceneEntity.kind === 'object'" :size="14" /><Camera v-else-if="selectedSceneEntity.kind === 'camera'" :size="14" /><Spline v-else-if="selectedSceneEntity.kind === 'path'" :size="14" /><Sun v-else :size="14" /></span>
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
              <KeyframeControl variant="inline" :property="transform[group][axis]" :label="`${group} ${axis}`" />
            </label>
          </div>
          <p v-if="selectedSceneEntity.kind === 'camera' && selectedSceneEntity.value.pathConstraint" class="section-note">Position and orientation are driven by the path constraint below.</p>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'object'" class="property-section">
        <button class="section-header" type="button" @click="toggle('material')"><ChevronDown :size="12" :class="{ closed: collapsed.material }" /><span>PBR Material</span><small>Standard</small></button>
        <div v-if="!collapsed.material" class="property-list">
          <label><span>Base color</span><input class="color-field" :value="selectedSceneEntity.value.material.baseColor" type="color" @input="selectedSceneEntity.value.material.baseColor = ($event.target as HTMLInputElement).value; store.markSceneChanged()" /></label>
          <label v-for="property in (['metalness', 'roughness', 'opacity', 'emissiveIntensity'] as const)" :key="property" class="keyable">
            <span>{{ property === 'emissiveIntensity' ? 'Emissive intensity' : property }}</span>
            <input :value="propertyValue(selectedSceneEntity.value.material[property])" type="number" min="0" :max="property === 'emissiveIntensity' ? 10 : 1" step=".05" @input="store.set3DObjectMaterial(property, Number(($event.target as HTMLInputElement).value))" />
            <KeyframeControl :property="selectedSceneEntity.value.material[property]" :label="property" />
          </label>
          <label class="check-row"><span>Cast shadows</span><button type="button" :class="{ checked: selectedSceneEntity.value.castShadow }" @click="selectedSceneEntity.value.castShadow = !selectedSceneEntity.value.castShadow; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
          <label class="check-row"><span>Receive shadows</span><button type="button" :class="{ checked: selectedSceneEntity.value.receiveShadow }" @click="selectedSceneEntity.value.receiveShadow = !selectedSceneEntity.value.receiveShadow; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'object'" class="property-section">
        <button class="section-header" type="button" @click="toggle('influences')"><ChevronDown :size="12" :class="{ closed: collapsed.influences }" /><span>Influences</span><small>{{ selectedSceneEntity.value.influences?.length ?? 0 }} in stack</small></button>
        <div v-if="!collapsed.influences" class="influence-stack">
          <article v-for="(influence, index) in selectedSceneEntity.value.influences ?? []" :key="influence.id" class="influence-block" :class="{ disabled: !influence.enabled }">
            <header>
              <button type="button" :title="influence.enabled ? 'Disable influence' : 'Enable influence'" :class="{ checked: influence.enabled }" @click="store.toggle3DInfluence(influence.id)"><CircleDot :size="10" /></button>
              <strong :title="INFLUENCE_DEFINITIONS[influence.type].description">{{ influence.name }}</strong>
              <button type="button" title="Move earlier in the stack" :disabled="index === 0" @click="store.move3DInfluence(influence.id, -1)"><ChevronUp :size="10" /></button>
              <button type="button" title="Move later in the stack" :disabled="index === (selectedSceneEntity.value.influences?.length ?? 0) - 1" @click="store.move3DInfluence(influence.id, 1)"><ChevronDown :size="10" /></button>
              <button type="button" title="Remove influence" @click="store.remove3DInfluence(influence.id)"><Trash2 :size="10" /></button>
            </header>
            <label v-for="parameter in influenceParameters(influence)" :key="parameter.definition.key" class="keyable">
              <span>{{ parameter.definition.label }}</span>
              <input :value="propertyValue(parameter.property)" type="number" :min="parameter.definition.min" :max="parameter.definition.max" :step="parameter.definition.step ?? .1" @input="store.set3DInfluenceParameter(influence.id, parameter.definition.key, Number(($event.target as HTMLInputElement).value))" />
              <KeyframeControl :property="parameter.property" :label="`${influence.name} ${parameter.definition.label}`" />
            </label>
          </article>
          <div class="influence-add">
            <button v-for="type in INFLUENCE_TYPES" :key="type" type="button" :title="INFLUENCE_DEFINITIONS[type].description" @click="store.add3DInfluence(type)"><Plus :size="10" /> {{ INFLUENCE_DEFINITIONS[type].label }}</button>
          </div>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'camera'" class="property-section">
        <div class="section-header static"><Camera :size="12" /><span>Camera</span><small>{{ selectedSceneEntity.value.projection }}</small></div>
        <div class="property-list">
          <label class="keyable">
            <span>Field of view</span>
            <input :value="propertyValue(selectedSceneEntity.value.fov)" type="number" min="1" max="179" @input="store.set3DCameraFov(Number(($event.target as HTMLInputElement).value))" />
            <KeyframeControl :property="selectedSceneEntity.value.fov" label="field of view" />
          </label>
          <label><span>Near</span><input v-model.number="selectedSceneEntity.value.near" type="number" min=".001" step=".1" @input="store.markSceneChanged()" /></label>
          <label><span>Far</span><input v-model.number="selectedSceneEntity.value.far" type="number" min="1" step="10" @input="store.markSceneChanged()" /></label>
          <button class="active-camera" type="button" :disabled="programCameraId === selectedSceneEntity.value.id" @click="store.add3DCameraCut(selectedSceneEntity.value.id)">{{ programCameraId === selectedSceneEntity.value.id ? 'Live program camera' : 'Cut to camera at playhead' }}</button>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'camera'" class="property-section">
        <button class="section-header" type="button" @click="toggle('constraint')"><ChevronDown :size="12" :class="{ closed: collapsed.constraint }" /><span>Path constraint</span><small>{{ selectedSceneEntity.value.pathConstraint ? 'Active' : 'Off' }}</small></button>
        <div v-if="!collapsed.constraint" class="property-list">
          <label>
            <span>Follow path</span>
            <select class="select-field" :value="selectedSceneEntity.value.pathConstraint?.pathId ?? ''" @change="store.setCameraPathConstraint(($event.target as HTMLSelectElement).value || null)">
              <option value="">None</option>
              <option v-for="path in scenePaths" :key="path.id" :value="path.id">{{ path.name }}</option>
            </select>
          </label>
          <p v-if="!scenePaths.length" class="section-note">No paths in this scene yet. Add one from the scene hierarchy.</p>

          <template v-if="selectedSceneEntity.value.pathConstraint">
            <div class="mode-switch">
              <button type="button" :class="{ active: selectedSceneEntity.value.pathConstraint.orientation === 'tangent' }" title="Orient the camera along the path tangent" @click="store.setCameraPathOrientation('tangent')"><Spline :size="10" /> Along path</button>
              <button type="button" :class="{ active: selectedSceneEntity.value.pathConstraint.orientation === 'look-at' }" title="Keep the camera pointed at a target entity" @click="store.setCameraPathOrientation('look-at')"><Target :size="10" /> Look at</button>
            </div>
            <label v-if="selectedSceneEntity.value.pathConstraint.orientation === 'look-at'">
              <span>Target</span>
              <select class="select-field" :value="selectedSceneEntity.value.pathConstraint.lookAtEntityId ?? ''" @change="store.setCameraPathTarget(($event.target as HTMLSelectElement).value || null)">
                <option value="">None (tangent)</option>
                <option v-for="candidate in lookAtCandidates" :key="candidate.id" :value="candidate.id">{{ candidate.group }} · {{ candidate.name }}</option>
              </select>
            </label>
            <label class="keyable">
              <span>Progress</span>
              <input :value="propertyValue(selectedSceneEntity.value.pathConstraint.progress)" type="number" min="0" max="1" step=".01" @input="store.setCameraPathProgress(Number(($event.target as HTMLInputElement).value))" />
              <KeyframeControl :property="selectedSceneEntity.value.pathConstraint.progress" label="path progress" />
            </label>
            <label class="keyable">
              <span>Bank</span>
              <input :value="propertyValue(selectedSceneEntity.value.pathConstraint.bank)" type="number" step="1" @input="store.setCameraPathBank(Number(($event.target as HTMLInputElement).value))" />
              <KeyframeControl :property="selectedSceneEntity.value.pathConstraint.bank" label="path bank" />
            </label>
            <div class="transform-group offset-group">
              <strong>Offset<button type="button" title="Reset the offset to zero" @click="store.resetCameraPathOffset()"><RotateCcw :size="9" /></button></strong>
              <label v-for="axis in (['x', 'y', 'z'] as const)" :key="axis" :class="axis">
                <span>{{ axis.toUpperCase() }}</span>
                <input :value="propertyValue(selectedSceneEntity.value.pathConstraint.offset[axis])" type="number" step=".1" @input="store.setCameraPathOffset(axis, Number(($event.target as HTMLInputElement).value))" />
                <KeyframeControl variant="inline" :property="selectedSceneEntity.value.pathConstraint.offset[axis]" :label="`path offset ${axis}`" />
              </label>
            </div>
            <p class="section-note">Offset travels with the camera: X is right of the direction of travel, Y is up, Z pulls back along it.</p>
          </template>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'light'" class="property-section">
        <div class="section-header static"><Sun :size="12" /><span>Light</span><small>{{ selectedSceneEntity.value.type }}</small></div>
        <div class="property-list">
          <label><span>Color</span><input v-model="selectedSceneEntity.value.color" class="color-field" type="color" @input="store.markSceneChanged()" /></label>
          <label class="keyable">
            <span>Intensity</span>
            <input :value="propertyValue(selectedSceneEntity.value.intensity)" type="number" min="0" step=".1" @input="store.set3DLightIntensity(Number(($event.target as HTMLInputElement).value))" />
            <KeyframeControl :property="selectedSceneEntity.value.intensity" label="intensity" />
          </label>
          <label class="check-row"><span>Cast shadows</span><button type="button" :class="{ checked: selectedSceneEntity.value.castShadow }" @click="selectedSceneEntity.value.castShadow = !selectedSceneEntity.value.castShadow; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'path'" class="property-section">
        <div class="section-header static"><Spline :size="12" /><span>Path</span><small>{{ selectedSceneEntity.value.points.length }} points</small></div>
        <div class="property-list">
          <label><span>Color</span><input class="color-field" :value="selectedSceneEntity.value.color" type="color" @input="store.set3DPathColor(selectedSceneEntity.value.id, ($event.target as HTMLInputElement).value)" /></label>
          <label class="check-row"><span>Closed loop</span><button type="button" :class="{ checked: selectedSceneEntity.value.closed }" @click="store.toggle3DPathClosed(selectedSceneEntity.value.id)"><CircleDot :size="10" /></button></label>
          <label class="check-row"><span>Locked</span><button type="button" :class="{ checked: selectedSceneEntity.value.locked }" @click="store.set3DPathLocked(selectedSceneEntity.value.id, !selectedSceneEntity.value.locked)"><Lock :size="10" /></button></label>
        </div>

        <div class="point-list">
          <article v-for="(point, index) in selectedSceneEntity.value.points" :key="point.id" class="point-block">
            <header>
              <button class="point-toggle" type="button" :title="expandedPoints[point.id] ? 'Hide handles' : 'Show handles'" @click="expandedPoints[point.id] = !expandedPoints[point.id]"><ChevronDown :size="10" :class="{ closed: !expandedPoints[point.id] }" /></button>
              <strong>Point {{ index + 1 }}</strong>
              <button class="point-mode" type="button" :title="`Switch to ${point.mode === 'smooth' ? 'corner' : 'smooth'} point`" @click="store.set3DPathPointMode(selectedSceneEntity.value.id, point.id, point.mode === 'smooth' ? 'corner' : 'smooth')">{{ pointModeLabel(point.mode) }}</button>
              <button type="button" title="Insert a point after this one" @click="store.add3DPathPoint(selectedSceneEntity.value.id, point.id)"><Plus :size="10" /></button>
              <button type="button" title="Delete this point" :disabled="selectedSceneEntity.value.points.length <= 2" @click="store.delete3DPathPoint(selectedSceneEntity.value.id, point.id)"><Trash2 :size="10" /></button>
            </header>
            <div class="vector-row">
              <strong>anchor</strong>
              <label v-for="(axis, axisIndex) in (['x', 'y', 'z'] as const)" :key="axis" :class="axis"><span>{{ axis.toUpperCase() }}</span><input :value="point.position[axisIndex]" type="number" step=".1" :disabled="selectedSceneEntity.value.locked" @input="setPathAxis(selectedSceneEntity.value.id, point, 'position', axisIndex as 0 | 1 | 2, $event)" /></label>
            </div>
            <template v-if="expandedPoints[point.id]">
              <div v-for="handle in (['handleIn', 'handleOut'] as const)" :key="handle" class="vector-row">
                <strong>{{ handle === 'handleIn' ? 'in' : 'out' }}</strong>
                <label v-for="(axis, axisIndex) in (['x', 'y', 'z'] as const)" :key="axis" :class="axis"><span>{{ axis.toUpperCase() }}</span><input :value="point[handle][axisIndex]" type="number" step=".1" :disabled="selectedSceneEntity.value.locked" @input="setPathAxis(selectedSceneEntity.value.id, point, handle, axisIndex as 0 | 1 | 2, $event)" /></label>
              </div>
            </template>
          </article>
          <div class="path-actions">
            <button type="button" @click="store.add3DPathPoint(selectedSceneEntity.value.id)"><Plus :size="11" /> Add point</button>
            <button class="danger" type="button" @click="store.delete3DPath(selectedSceneEntity.value.id)"><Trash2 :size="11" /> Delete path</button>
          </div>
        </div>
      </section>

      <section class="property-section">
        <div class="section-header static"><Box :size="12" /><span>Renderer</span><small>WebGL2</small></div>
        <div class="metadata"><span>Color space</span><strong>sRGB</strong><span>Alpha</span><strong>Premultiplied</strong><span>Scene revision</span><strong>{{ selectedScene?.revision }}</strong></div>
      </section>
    </div>
    <div v-else class="empty-state"><Box :size="25" /><strong>No 3D selection</strong><span>Select an object, camera, light, or path in the scene hierarchy.</span></div>
  </aside>
</template>

<style scoped>
.three-inspector { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); }.entity-summary { display: flex; height: 49px; flex: 0 0 auto; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); }.entity-icon { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; color: #cdd5ff; background: #29304b; border: 1px solid #4d5787; border-radius: 4px; }.entity-summary > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 2px; }.entity-summary strong, .entity-summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.entity-summary strong { color: var(--text-primary); font-size: 10px; }.entity-summary small { color: var(--text-muted); font-size: 8px; text-transform: capitalize; }.inspector-scroll { min-height: 0; flex: 1; overflow: auto; }.property-section { border-bottom: 1px solid var(--border-subtle); }.section-header { display: grid; width: 100%; height: 28px; grid-template-columns: 14px 1fr auto; align-items: center; gap: 4px; padding: 0 7px; color: var(--text-secondary); text-align: left; background: #17191f; border: 0; font: inherit; cursor: pointer; }.section-header.static { cursor: default; }.section-header span { overflow: hidden; font-size: 9px; font-weight: 650; letter-spacing: .05em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }.section-header small { color: var(--text-muted); font-size: 7.5px; }.section-header svg.closed { transform: rotate(-90deg); }.section-note { margin: 2px 2px 0; color: var(--text-muted); font-size: 7.5px; line-height: 1.4; }
.transform-groups, .property-list { padding: 5px 6px 7px; }.transform-group { display: grid; grid-template-columns: 52px repeat(3, minmax(0, 1fr)); gap: 3px; margin-bottom: 4px; }.transform-group > strong { align-self: center; color: var(--text-muted); font-size: 8px; font-weight: 500; text-transform: capitalize; }.transform-group label { position: relative; display: flex; height: 23px; min-width: 0; align-items: center; overflow: hidden; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.transform-group label:focus-within { border-color: var(--focus); }.transform-group label > span { width: 15px; padding-left: 4px; font-size: 7px; font-weight: 700; }.transform-group label.x > span { color: #df7886; }.transform-group label.y > span { color: #6bb88f; }.transform-group label.z > span { color: #7998e4; }.transform-group input { width: 100%; min-width: 0; padding: 0 2px; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 8px; }.transform-group label > small { color: var(--text-muted); font-size: 7px; }.offset-group { margin: 0; }.offset-group > strong { display: flex; align-items: center; gap: 3px; }.offset-group > strong button { display: grid; width: 15px; height: 15px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; cursor: pointer; }.offset-group > strong button:hover { color: var(--text-primary); }
.property-list { display: grid; gap: 5px; }.property-list > label { display: grid; min-height: 24px; grid-template-columns: 1fr 86px; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 8.5px; }.property-list > label.keyable { grid-template-columns: 1fr 74px 48px; }.property-list > label > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }.property-list input, .select-field { width: 100%; height: 23px; padding: 0 5px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; outline: 0; font: inherit; font-size: 8.5px; }.property-list input:focus, .select-field:focus { border-color: var(--focus); }.property-list input.color-field { padding: 2px; }.select-field { cursor: pointer; }.check-row button { display: grid; width: 23px; height: 20px; justify-self: end; place-items: center; padding: 0; color: #525762; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; cursor: pointer; }.check-row button.checked { color: #cdd5ff; background: var(--bg-selected); border-color: var(--accent-border); }.active-camera { height: 26px; color: #101219; background: var(--button-accent); border: 1px solid #aab4ff; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; }.active-camera:disabled { color: #8f96ad; background: #202432; border-color: #383e52; cursor: default; }
.mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }.mode-switch button { display: flex; height: 24px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; }.mode-switch button:hover { color: var(--text-primary); background: var(--bg-hover); }.mode-switch button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }
.influence-stack { display: grid; gap: 5px; padding: 5px 6px 8px; }.influence-block { background: #15171d; border: 1px solid #292d36; border-radius: 3px; }.influence-block.disabled { opacity: .5; }.influence-block header { display: flex; height: 25px; align-items: center; gap: 4px; padding: 0 4px; border-bottom: 1px solid #282b33; }.influence-block header strong { min-width: 0; flex: 1; overflow: hidden; color: var(--text-secondary); font-size: 9px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }.influence-block header button { display: grid; width: 18px; height: 18px; flex: 0 0 18px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.influence-block header button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }.influence-block header button:disabled { opacity: .3; cursor: default; }.influence-block header button.checked { color: #9aa8ff; }.influence-block label { display: grid; min-height: 24px; grid-template-columns: 1fr 74px 48px; align-items: center; gap: 5px; padding: 2px 6px; color: var(--text-secondary); font-size: 8.5px; }.influence-block label > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.influence-block input { width: 100%; height: 21px; padding: 0 5px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; outline: 0; font: inherit; font-size: 8.5px; }.influence-block input:focus { border-color: var(--focus); }.influence-add { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }.influence-add button { display: flex; height: 24px; align-items: center; justify-content: center; gap: 3px; overflow: hidden; color: var(--text-secondary); background: #181a20; border: 1px dashed #3a3e49; border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; white-space: nowrap; }.influence-add button:hover { color: var(--text-primary); border-color: var(--accent-border); }
.point-list { display: grid; gap: 5px; padding: 0 6px 8px; }.point-block { background: #15171d; border: 1px solid #292d36; border-radius: 3px; }.point-block header { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 4px; border-bottom: 1px solid #282b33; }.point-block header strong { flex: 1; color: var(--text-secondary); font-size: 8.5px; font-weight: 550; }.point-block header button { display: grid; width: 18px; height: 18px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.point-block header button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }.point-block header button:disabled { opacity: .35; cursor: default; }.point-block header button.point-mode { width: auto; padding: 0 6px; color: #9aa8ff; background: #1d2130; border: 1px solid #343b52; font-size: 7.5px; }.point-toggle svg.closed { transform: rotate(-90deg); }
.vector-row { display: grid; grid-template-columns: 34px repeat(3, minmax(0, 1fr)); align-items: center; gap: 3px; padding: 3px 4px; }.vector-row > strong { color: var(--text-muted); font-size: 7px; font-weight: 500; text-transform: uppercase; }.vector-row label { display: flex; height: 21px; min-width: 0; align-items: center; overflow: hidden; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.vector-row label:focus-within { border-color: var(--focus); }.vector-row label > span { width: 13px; padding-left: 3px; font-size: 6.5px; font-weight: 700; }.vector-row label.x > span { color: #df7886; }.vector-row label.y > span { color: #6bb88f; }.vector-row label.z > span { color: #7998e4; }.vector-row input { width: 100%; min-width: 0; padding: 0 2px; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 8px; }.vector-row input:disabled { color: var(--text-muted); }
.path-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }.path-actions button { display: flex; height: 25px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: #181a20; border: 1px dashed #3a3e49; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; }.path-actions button:hover { color: var(--text-primary); border-color: var(--accent-border); }.path-actions button.danger:hover { color: #f0a7a7; border-color: #6d3d45; }
.metadata { display: grid; grid-template-columns: 1fr auto; gap: 7px 10px; padding: 7px 8px 9px; font-size: 8px; }.metadata span { color: var(--text-muted); }.metadata strong { color: var(--text-secondary); font-weight: 500; }.empty-state { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 6px; padding: 20px; color: var(--text-muted); text-align: center; }.empty-state svg { color: var(--accent); }.empty-state strong { color: var(--text-primary); font-size: 10px; }.empty-state span { font-size: 8.5px; line-height: 1.4; }
</style>
