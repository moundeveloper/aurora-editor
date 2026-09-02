<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Camera, ChevronDown, ChevronUp, CircleDot, Image as ImageIcon, Layers3, Lock, Plus, RotateCcw, SlidersHorizontal, Spline, Sun, Target, Trash2 } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { AnimatableProperty, Aurora3DPathPoint, AuroraPathPointMode } from '@/models/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { INFLUENCE_DEFINITIONS, INFLUENCE_TYPES, influenceParameters } from '@/engine/scene3d/influences'
import { cameraIdAtTime } from '@/engine/scene3d/cameraCuts'
import type { PathHandleKey } from '@/engine/scene3d/pathEditing'
import KeyframeControl from './common/KeyframeControl.vue'
import NumberField from './common/NumberField.vue'
import PanelHeader from './common/PanelHeader.vue'
import MSelect, { type MSelectOption } from './common/MSelect.vue'
import RigPanel from './common/RigPanel.vue'

const store = useEditorStore()
const { selectedLayer, selectedScene, selectedSceneEntity, currentTime, assets } = storeToRefs(store)
const collapsed = ref<Record<string, boolean>>({})
const expandedPoints = ref<Record<string, boolean>>({})
const entity = computed(() => selectedSceneEntity.value?.value)
const transform = computed(() => entity.value?.transform)
const scenePaths = computed(() => selectedScene.value?.paths ?? [])
const programCameraId = computed(() => selectedScene.value ? cameraIdAtTime(selectedScene.value, currentTime.value) : null)
const imageAssetOptions = computed<MSelectOption[]>(() => [
  { value: '', label: 'No image' },
  ...assets.value
    .filter((asset) => asset.kind === 'image' || asset.kind === 'texture')
    .map((asset) => ({ value: asset.id, label: asset.name })),
])
const environmentOptions = computed<MSelectOption[]>(() => [
  { value: '', label: 'No environment' },
  ...assets.value.filter((asset) => asset.kind === 'hdr').map((asset) => ({ value: asset.id, label: asset.name })),
])
const modelAssetOptions = computed<MSelectOption[]>(() => [
  { value: '', label: 'No model' },
  ...assets.value.filter((asset) => asset.kind === 'model3d').map((asset) => ({ value: asset.id, label: asset.name })),
])
const pathOptions = computed<MSelectOption[]>(() => [
  { value: '', label: 'None' },
  ...scenePaths.value.map((path) => ({ value: path.id, label: path.name })),
])
const objectFollowOptions = computed<MSelectOption[]>(() => [
  { value: '', label: 'None' },
  ...(selectedScene.value?.objects ?? []).map((object) => ({ value: object.id, label: object.name })),
])
const availableInfluenceTypes = computed(() => {
  const object = selectedSceneEntity.value?.kind === 'object' ? selectedSceneEntity.value.value : null
  if (object?.primitive === 'model') return []
  return object?.type === 'group' ? INFLUENCE_TYPES.filter((type) => type === 'array') : INFLUENCE_TYPES
})
const lookAtCandidates = computed(() => {
  const scene = selectedScene.value
  if (!scene) return []
  return [
    ...scene.objects.map((item) => ({ id: item.id, name: item.name, group: 'Objects' })),
    ...scene.lights.map((item) => ({ id: item.id, name: item.name, group: 'Lights' })),
    ...scene.cameras.filter((item) => item.id !== entity.value?.id).map((item) => ({ id: item.id, name: item.name, group: 'Cameras' })),
  ]
})
const lookAtOptions = computed<MSelectOption[]>(() => [
  { value: '', label: 'Followed object / path direction' },
  ...lookAtCandidates.value.map((candidate) => ({ value: candidate.id, label: `${candidate.group} · ${candidate.name}` })),
])

function setTransform(group: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', value: number) {
  store.set3DEntityTransform(group, axis, value)
}

function toggle(section: string) {
  collapsed.value[section] = !collapsed.value[section]
}

function propertyValue(property: AnimatableProperty<number>) {
  return evaluateNumericProperty(property, currentTime.value)
}

function setPathAxis(pathId: string, point: Aurora3DPathPoint, target: PathHandleKey, axis: 0 | 1 | 2, value: number) {
  store.set3DPathPointAxis(pathId, point.id, target, axis, value)
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
      <span class="entity-icon"><Layers3 v-if="selectedSceneEntity.kind === 'object' && selectedSceneEntity.value.type === 'group'" :size="14" /><Box v-else-if="selectedSceneEntity.kind === 'object'" :size="14" /><Camera v-else-if="selectedSceneEntity.kind === 'camera'" :size="14" /><Spline v-else-if="selectedSceneEntity.kind === 'path'" :size="14" /><Sun v-else :size="14" /></span>
      <span><strong :title="entity?.name">{{ entity?.name }}</strong><small>{{ selectedSceneEntity.kind === 'object' && selectedSceneEntity.value.type === 'group' ? 'group' : selectedSceneEntity.kind }} · {{ selectedScene?.name }}</small></span>
    </div>

    <div v-if="selectedSceneEntity && transform" class="inspector-scroll">
      <section class="property-section">
        <button class="section-header" type="button" @click="toggle('transform')"><ChevronDown :size="12" :class="{ closed: collapsed.transform }" /><span>Transform 3D</span><small>Local</small></button>
        <div v-if="!collapsed.transform" class="transform-groups">
          <div v-for="group in (['position', 'rotation', 'scale'] as const)" :key="group" class="transform-group">
            <strong>{{ group }}</strong>
            <label v-for="axis in (['x', 'y', 'z'] as const)" :key="axis" :class="axis">
              <span>{{ axis.toUpperCase() }}</span>
              <NumberField :model-value="propertyValue(transform[group][axis])" :step="group === 'rotation' ? 1 : .1" :label="`${group} ${axis}`" @update:model-value="setTransform(group, axis, $event)" />
              <small>{{ group === 'rotation' ? '°' : '' }}</small>
              <KeyframeControl variant="inline" :property="transform[group][axis]" :label="`${group} ${axis}`" />
            </label>
          </div>
          <p v-if="selectedSceneEntity.kind === 'camera' && (selectedSceneEntity.value.pathConstraint || selectedSceneEntity.value.objectConstraint)" class="section-note">Position and orientation are driven by the active camera constraint below.</p>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'object' && selectedSceneEntity.value.primitive === 'model'" class="property-section">
        <div class="section-header static"><Box :size="12" /><span>Imported mesh</span><small>glTF</small></div>
        <div class="property-list">
          <label><span>Model</span><MSelect :model-value="selectedSceneEntity.value.assetId ?? ''" :options="modelAssetOptions" label="Imported mesh file" @update:model-value="store.set3DObjectModel($event || null)" /></label>
          <p v-if="modelAssetOptions.length === 1" class="section-note">Import a .glb or .gltf file in the Media library, then select it here.</p>
          <p v-else class="section-note">The file keeps its own materials and node hierarchy, so the PBR sliders and the influence stack do not apply to it. The transform and shadow casting do.</p>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'object' && selectedSceneEntity.value.type === 'mesh' && selectedSceneEntity.value.primitive === 'plane'" class="property-section">
        <button class="section-header" type="button" @click="toggle('image')"><ChevronDown :size="12" :class="{ closed: collapsed.image }" /><span>Surface image</span><small>Alpha enabled</small></button>
        <div v-if="!collapsed.image" class="property-list">
          <label><span>Image</span><MSelect :model-value="selectedSceneEntity.value.assetId ?? ''" :options="imageAssetOptions" label="Image on plane" @update:model-value="store.set3DObjectImage($event || null)" /></label>
          <p v-if="imageAssetOptions.length === 1" class="section-note">Import an image in the Media library, then select it here.</p>
          <p v-else class="section-note alpha-note"><ImageIcon :size="10" /> Transparent pixels in PNG, WebP, and other alpha-capable images stay transparent in 3D.</p>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'object' && selectedSceneEntity.value.type === 'mesh' && selectedSceneEntity.value.primitive !== 'model'" class="property-section">
        <button class="section-header" type="button" @click="toggle('material')"><ChevronDown :size="12" :class="{ closed: collapsed.material }" /><span>PBR Material</span><small>Standard</small></button>
        <div v-if="!collapsed.material" class="property-list">
          <label><span>Base color</span><input class="color-field" :value="selectedSceneEntity.value.material.baseColor" type="color" @input="selectedSceneEntity.value.material.baseColor = ($event.target as HTMLInputElement).value; store.markSceneChanged()" /></label>
          <label v-for="property in (['metalness', 'roughness', 'opacity', 'emissiveIntensity'] as const)" :key="property" class="keyable">
            <span>{{ property === 'emissiveIntensity' ? 'Emissive intensity' : property }}</span>
            <NumberField :model-value="propertyValue(selectedSceneEntity.value.material[property])" :min="0" :max="property === 'emissiveIntensity' ? 10 : 1" :step=".05" :label="property" @update:model-value="store.set3DObjectMaterial(property, $event)" />
            <KeyframeControl :property="selectedSceneEntity.value.material[property]" :label="property" />
          </label>
          <label class="check-row"><span>Cast shadows</span><button type="button" :class="{ checked: selectedSceneEntity.value.castShadow }" @click="selectedSceneEntity.value.castShadow = !selectedSceneEntity.value.castShadow; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
          <label class="check-row"><span>Receive shadows</span><button type="button" :class="{ checked: selectedSceneEntity.value.receiveShadow }" @click="selectedSceneEntity.value.receiveShadow = !selectedSceneEntity.value.receiveShadow; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
        </div>
      </section>

      <RigPanel
        v-if="selectedSceneEntity.kind === 'object' && selectedSceneEntity.value.type === 'mesh'"
        :rig-id="selectedSceneEntity.value.rigId"
        scope="object"
        :unavailable="selectedSceneEntity.value.primitive === 'plane' ? undefined : 'Rigs bend a flat card, so they attach to image planes.'"
      />

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
              <NumberField :model-value="propertyValue(parameter.property)" :min="parameter.definition.min" :max="parameter.definition.max" :step="parameter.definition.step ?? .1" :label="parameter.definition.key" @update:model-value="store.set3DInfluenceParameter(influence.id, parameter.definition.key, $event)" />
              <KeyframeControl :property="parameter.property" :label="`${influence.name} ${parameter.definition.label}`" />
            </label>
          </article>
          <div class="influence-add">
            <button v-for="type in availableInfluenceTypes" :key="type" type="button" :title="INFLUENCE_DEFINITIONS[type].description" @click="store.add3DInfluence(type)"><Plus :size="10" /> {{ INFLUENCE_DEFINITIONS[type].label }}</button>
          </div>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'camera'" class="property-section">
        <button class="section-header" type="button" @click="toggle('objectConstraint')"><ChevronDown :size="12" :class="{ closed: collapsed.objectConstraint }" /><span>Object follow</span><small>{{ selectedSceneEntity.value.objectConstraint ? 'Active' : 'Off' }}</small></button>
        <div v-if="!collapsed.objectConstraint" class="property-list">
          <label><span>Follow object</span><MSelect :model-value="selectedSceneEntity.value.objectConstraint?.objectId ?? ''" :options="objectFollowOptions" label="Object to follow" @update:model-value="store.setCameraObjectConstraint($event || null)" /></label>
          <p v-if="objectFollowOptions.length === 1" class="section-note">Add an object to this scene before creating an object-follow camera rig.</p>

          <template v-if="selectedSceneEntity.value.objectConstraint">
            <div class="mode-switch">
              <button type="button" :class="{ active: selectedSceneEntity.value.objectConstraint.orientation === 'target' }" title="Inherit the followed object's world orientation" @click="store.setCameraObjectOrientation('target')"><Box :size="10" /> Follow rotation</button>
              <button type="button" :class="{ active: selectedSceneEntity.value.objectConstraint.orientation === 'look-at' }" title="Point the camera at the followed object or another entity" @click="store.setCameraObjectOrientation('look-at')"><Target :size="10" /> Look at</button>
            </div>
            <label v-if="selectedSceneEntity.value.objectConstraint.orientation === 'look-at'">
              <span>Look at</span>
              <MSelect :model-value="selectedSceneEntity.value.objectConstraint.lookAtEntityId ?? ''" :options="lookAtOptions" label="Look-at target" @update:model-value="store.setCameraObjectLookAtTarget($event || null)" />
            </label>
            <div class="transform-group offset-group">
              <strong>Position<button type="button" title="Reset position offset" @click="store.resetCameraObjectOffset('positionOffset')"><RotateCcw :size="9" /></button></strong>
              <label v-for="axis in (['x', 'y', 'z'] as const)" :key="axis" :class="axis">
                <span>{{ axis.toUpperCase() }}</span>
                <NumberField :model-value="propertyValue(selectedSceneEntity.value.objectConstraint.positionOffset[axis])" :step=".1" :label="`follow position offset ${axis}`" @update:model-value="store.setCameraObjectOffset('positionOffset', axis, $event)" />
                <KeyframeControl variant="inline" :property="selectedSceneEntity.value.objectConstraint.positionOffset[axis]" :label="`follow position offset ${axis}`" />
              </label>
            </div>
            <div class="transform-group offset-group">
              <strong>Rotation<button type="button" title="Reset rotation offset" @click="store.resetCameraObjectOffset('rotationOffset')"><RotateCcw :size="9" /></button></strong>
              <label v-for="axis in (['x', 'y', 'z'] as const)" :key="axis" :class="axis">
                <span>{{ axis.toUpperCase() }}</span>
                <NumberField :model-value="propertyValue(selectedSceneEntity.value.objectConstraint.rotationOffset[axis])" :step="1" :label="`follow rotation offset ${axis}`" @update:model-value="store.setCameraObjectOffset('rotationOffset', axis, $event)" />
                <small>°</small>
                <KeyframeControl variant="inline" :property="selectedSceneEntity.value.objectConstraint.rotationOffset[axis]" :label="`follow rotation offset ${axis}`" />
              </label>
            </div>
            <p class="section-note">Position offset uses the object's local axes. Follow rotation inherits its orientation; Look at points at the chosen entity (or the followed object) before applying rotation offset.</p>
          </template>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'camera'" class="property-section">
        <div class="section-header static"><Camera :size="12" /><span>Camera</span><small>{{ selectedSceneEntity.value.projection }}</small></div>
        <div class="property-list">
          <label class="keyable">
            <span>Field of view</span>
            <NumberField :model-value="propertyValue(selectedSceneEntity.value.fov)" :min="1" :max="179" label="field of view" @update:model-value="store.set3DCameraFov($event)" />
            <KeyframeControl :property="selectedSceneEntity.value.fov" label="field of view" />
          </label>
          <label><span>Near</span><NumberField v-model="selectedSceneEntity.value.near" :min=".001" :step=".1" label="near plane" @update:model-value="store.markSceneChanged()" /></label>
          <label><span>Far</span><NumberField v-model="selectedSceneEntity.value.far" :min="1" :step="10" label="far plane" @update:model-value="store.markSceneChanged()" /></label>
          <label class="check-row"><span>Depth of field</span><button type="button" :class="{ checked: selectedSceneEntity.value.depthOfField }" :disabled="selectedSceneEntity.value.projection !== 'perspective'" :title="selectedSceneEntity.value.projection === 'perspective' ? 'Blur everything outside the focus plane' : 'An orthographic camera has no lens to defocus'" @click="store.set3DCameraDepthOfField(!selectedSceneEntity.value.depthOfField)"><CircleDot :size="10" /></button></label>
          <template v-if="selectedSceneEntity.value.depthOfField && selectedSceneEntity.value.focusDistance && selectedSceneEntity.value.fStop">
            <label class="keyable">
              <span>Focus distance</span>
              <NumberField :model-value="propertyValue(selectedSceneEntity.value.focusDistance)" :min=".01" :max="1000" :step=".25" label="focus distance" @update:model-value="store.set3DCameraLens('focusDistance', $event)" />
              <KeyframeControl :property="selectedSceneEntity.value.focusDistance" label="focus distance" />
            </label>
            <label class="keyable">
              <span>Aperture f/</span>
              <NumberField :model-value="propertyValue(selectedSceneEntity.value.fStop)" :min="1" :max="22" :step=".1" label="aperture f-number" @update:model-value="store.set3DCameraLens('fStop', $event)" />
              <KeyframeControl :property="selectedSceneEntity.value.fStop" label="aperture" />
            </label>
            <p class="section-note">Lower f-numbers shrink the sharp range and grow the bokeh. The viewport working view stays sharp; focus shows in the camera preview and the render.</p>
          </template>
          <button class="active-camera" type="button" :disabled="programCameraId === selectedSceneEntity.value.id" @click="store.add3DCameraCut(selectedSceneEntity.value.id)">{{ programCameraId === selectedSceneEntity.value.id ? 'Live program camera' : 'Cut to camera at playhead' }}</button>
        </div>
      </section>

      <section v-if="selectedSceneEntity.kind === 'camera'" class="property-section">
        <button class="section-header" type="button" @click="toggle('constraint')"><ChevronDown :size="12" :class="{ closed: collapsed.constraint }" /><span>Path constraint</span><small>{{ selectedSceneEntity.value.pathConstraint ? 'Active' : 'Off' }}</small></button>
        <div v-if="!collapsed.constraint" class="property-list">
          <label><span>Follow path</span><MSelect :model-value="selectedSceneEntity.value.pathConstraint?.pathId ?? ''" :options="pathOptions" label="Path to follow" @update:model-value="store.setCameraPathConstraint($event || null)" /></label>
          <p v-if="!scenePaths.length" class="section-note">No paths in this scene yet. Add one from the scene hierarchy.</p>

          <template v-if="selectedSceneEntity.value.pathConstraint">
            <div class="mode-switch">
              <button type="button" :class="{ active: selectedSceneEntity.value.pathConstraint.orientation === 'tangent' }" title="Orient the camera along the path tangent" @click="store.setCameraPathOrientation('tangent')"><Spline :size="10" /> Along path</button>
              <button type="button" :class="{ active: selectedSceneEntity.value.pathConstraint.orientation === 'look-at' }" title="Keep the camera pointed at a target entity" @click="store.setCameraPathOrientation('look-at')"><Target :size="10" /> Look at</button>
            </div>
            <label v-if="selectedSceneEntity.value.pathConstraint.orientation === 'look-at'"><span>Target</span><MSelect :model-value="selectedSceneEntity.value.pathConstraint.lookAtEntityId ?? ''" :options="lookAtOptions" label="Path look-at target" @update:model-value="store.setCameraPathTarget($event || null)" /></label>
            <label class="keyable">
              <span>Progress</span>
              <NumberField :model-value="propertyValue(selectedSceneEntity.value.pathConstraint.progress)" :min="0" :max="1" :step=".01" label="path progress" @update:model-value="store.setCameraPathProgress($event)" />
              <KeyframeControl :property="selectedSceneEntity.value.pathConstraint.progress" label="path progress" />
            </label>
            <label class="keyable">
              <span>Bank</span>
              <NumberField :model-value="propertyValue(selectedSceneEntity.value.pathConstraint.bank)" :step="1" label="bank" @update:model-value="store.setCameraPathBank($event)" />
              <KeyframeControl :property="selectedSceneEntity.value.pathConstraint.bank" label="path bank" />
            </label>
            <div class="transform-group offset-group">
              <strong>Offset<button type="button" title="Reset the offset to zero" @click="store.resetCameraPathOffset()"><RotateCcw :size="9" /></button></strong>
              <label v-for="axis in (['x', 'y', 'z'] as const)" :key="axis" :class="axis">
                <span>{{ axis.toUpperCase() }}</span>
                <NumberField :model-value="propertyValue(selectedSceneEntity.value.pathConstraint.offset[axis])" :step=".1" :label="`offset ${axis}`" @update:model-value="store.setCameraPathOffset(axis, $event)" />
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
            <NumberField :model-value="propertyValue(selectedSceneEntity.value.intensity)" :min="0" :step=".1" label="intensity" @update:model-value="store.set3DLightIntensity($event)" />
            <KeyframeControl :property="selectedSceneEntity.value.intensity" label="intensity" />
          </label>
          <template v-if="selectedSceneEntity.value.type === 'spot' && selectedSceneEntity.value.angle && selectedSceneEntity.value.distance && selectedSceneEntity.value.penumbra">
            <label class="keyable">
              <span>Cone angle</span>
              <NumberField :model-value="propertyValue(selectedSceneEntity.value.angle)" :min="1" :max="89" :step="1" label="spot cone angle" @update:model-value="store.set3DLightCone('angle', $event)" />
              <KeyframeControl :property="selectedSceneEntity.value.angle" label="spot cone angle" />
            </label>
            <label class="keyable">
              <span>Range</span>
              <NumberField :model-value="propertyValue(selectedSceneEntity.value.distance)" :min="0" :max="1000" :step=".25" label="spot light range, zero for unlimited" @update:model-value="store.set3DLightCone('distance', $event)" />
              <KeyframeControl :property="selectedSceneEntity.value.distance" label="spot light range" />
            </label>
            <label class="keyable">
              <span>Soft edge</span>
              <NumberField :model-value="propertyValue(selectedSceneEntity.value.penumbra)" :min="0" :max="1" :step=".05" label="spot light soft edge" @update:model-value="store.set3DLightCone('penumbra', $event)" />
              <KeyframeControl :property="selectedSceneEntity.value.penumbra" label="spot light soft edge" />
            </label>
            <p class="section-note">Range 0 lights to infinity. Any other value hard-stops the beam at that distance, however bright it is. Drag the cone rim in the viewport to widen the cone.</p>
          </template>
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
              <label v-for="(axis, axisIndex) in (['x', 'y', 'z'] as const)" :key="axis" :class="axis"><span>{{ axis.toUpperCase() }}</span><NumberField :model-value="point.position[axisIndex] ?? 0" :step=".1" :disabled="selectedSceneEntity.value.locked" :label="axis" @update:model-value="setPathAxis(selectedSceneEntity.value.id, point, 'position', axisIndex as 0 | 1 | 2, $event)" /></label>
            </div>
            <template v-if="expandedPoints[point.id]">
              <div v-for="handle in (['handleIn', 'handleOut'] as const)" :key="handle" class="vector-row">
                <strong>{{ handle === 'handleIn' ? 'in' : 'out' }}</strong>
                <label v-for="(axis, axisIndex) in (['x', 'y', 'z'] as const)" :key="axis" :class="axis"><span>{{ axis.toUpperCase() }}</span><NumberField :model-value="point[handle][axisIndex] ?? 0" :step=".1" :disabled="selectedSceneEntity.value.locked" :label="axis" @update:model-value="setPathAxis(selectedSceneEntity.value.id, point, handle, axisIndex as 0 | 1 | 2, $event)" /></label>
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
        <div class="section-header static"><Box :size="12" /><span>Renderer</span><small>WebGL2 · GTAO</small></div>
        <div v-if="selectedScene" class="property-list">
          <label class="check-row"><span>Shadows</span><button type="button" :class="{ checked: selectedScene.settings.shadows }" @click="selectedScene.settings.shadows = !selectedScene.settings.shadows; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
          <label><span>Shadow map</span><NumberField :model-value="selectedScene.settings.shadowMapSize" :min="256" :max="4096" :step="256" label="shadow map size" @update:model-value="selectedScene.settings.shadowMapSize = $event; store.markSceneChanged()" /></label>
          <label class="check-row"><span>Ambient occlusion</span><button type="button" :class="{ checked: selectedScene.settings.ambientOcclusion }" @click="selectedScene.settings.ambientOcclusion = !selectedScene.settings.ambientOcclusion; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
          <label><span>AO intensity</span><NumberField :model-value="selectedScene.settings.ambientOcclusionIntensity" :min="0" :max="3" :step=".05" label="ambient occlusion intensity" @update:model-value="selectedScene.settings.ambientOcclusionIntensity = $event; store.markSceneChanged()" /></label>
          <label><span>AO radius</span><NumberField :model-value="selectedScene.settings.ambientOcclusionRadius" :min=".01" :max="5" :step=".05" label="ambient occlusion radius" @update:model-value="selectedScene.settings.ambientOcclusionRadius = $event; store.markSceneChanged()" /></label>
          <label class="check-row"><span>Motion blur</span><button type="button" :class="{ checked: selectedScene.settings.motionBlur }" @click="selectedScene.settings.motionBlur = !selectedScene.settings.motionBlur; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
          <template v-if="selectedScene.settings.motionBlur">
            <label v-if="selectedLayer?.type === '3d-scene'" class="check-row"><span>This scene layer</span><button type="button" :class="{ checked: selectedLayer.motionBlur !== false }" @click="selectedLayer.motionBlur = selectedLayer.motionBlur === false; store.markSceneChanged()"><CircleDot :size="10" /></button></label>
            <label><span>Shutter angle</span><NumberField :model-value="selectedScene.settings.motionBlurShutter" :min="0" :max="360" :step="15" label="motion blur shutter angle in degrees" @update:model-value="selectedScene.settings.motionBlurShutter = $event; store.markSceneChanged()" /></label>
            <label><span>Full samples</span><NumberField :model-value="selectedScene.settings.motionBlurSamples" :min="2" :max="16" :step="1" label="full quality motion blur samples" @update:model-value="selectedScene.settings.motionBlurSamples = Math.round($event); store.markSceneChanged()" /></label>
            <p class="section-note">Preview uses up to 8 samples. Draft disables blur; full quality uses the authored count.</p>
          </template>
          <label><span>Environment light</span><NumberField :model-value="selectedScene.environmentIntensity" :min="0" :max="4" :step=".05" label="environment light intensity" @update:model-value="selectedScene.environmentIntensity = $event; store.markSceneChanged()" /></label>
          <label><span>Environment map</span><MSelect :model-value="selectedScene.environmentAssetId ?? ''" :options="environmentOptions" label="Environment radiance map" @update:model-value="store.set3DEnvironmentMap($event || null)" /></label>
          <label v-if="selectedScene.environmentAssetId" class="check-row"><span>Map as background</span><button type="button" :class="{ checked: selectedScene.environmentBackground }" @click="store.set3DEnvironmentBackground(!selectedScene.environmentBackground)"><CircleDot :size="10" /></button></label>
          <p v-if="!environmentOptions.length || environmentOptions.length === 1" class="section-note">Import an .hdr or .exr file to light the scene from a radiance map.</p>
        </div>
        <div class="metadata"><span>Color space</span><strong>sRGB + ACES</strong><span>AO</span><strong>Ground-truth approximation</strong><span>Full samples</span><strong>{{ selectedScene?.settings.motionBlur && selectedLayer?.motionBlur !== false ? selectedScene.settings.motionBlurSamples : 'Off' }}</strong><span>Scene revision</span><strong>{{ selectedScene?.revision }}</strong></div>
      </section>
    </div>
    <div v-else class="empty-state"><Box :size="25" /><strong>No 3D selection</strong><span>Select an object, camera, light, or path in the scene hierarchy.</span></div>
  </aside>
</template>

<style scoped>
.three-inspector { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); }.entity-summary { display: flex; height: 49px; flex: 0 0 auto; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); }.entity-icon { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; color: #cdd5ff; background: #29304b; border: 1px solid #4d5787; border-radius: 4px; }.entity-summary > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 2px; }.entity-summary strong, .entity-summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.entity-summary strong { color: var(--text-primary); font-size: 10px; }.entity-summary small { color: var(--text-muted); font-size: 8px; text-transform: capitalize; }.inspector-scroll { min-height: 0; flex: 1; overflow: auto; }.property-section { border-bottom: 1px solid var(--border-subtle); }.section-header { display: grid; width: 100%; height: 28px; grid-template-columns: 14px 1fr auto; align-items: center; gap: 4px; padding: 0 7px; color: var(--text-secondary); text-align: left; background: #17191f; border: 0; font: inherit; cursor: pointer; }.section-header.static { cursor: default; }.section-header span { overflow: hidden; font-size: 9px; font-weight: 650; letter-spacing: .05em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }.section-header small { color: var(--text-muted); font-size: 7.5px; }.section-header svg.closed { transform: rotate(-90deg); }.section-note { margin: 2px 2px 0; color: var(--text-muted); font-size: 7.5px; line-height: 1.4; }
.transform-groups, .property-list { padding: 5px 6px 7px; }.transform-group { display: grid; grid-template-columns: 52px repeat(3, minmax(0, 1fr)); gap: 3px; margin-bottom: 4px; }.transform-group > strong { align-self: center; color: var(--text-muted); font-size: 8px; font-weight: 500; text-transform: capitalize; }.transform-group label { position: relative; display: flex; height: 23px; min-width: 0; align-items: center; overflow: hidden; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.transform-group label:focus-within { border-color: var(--focus); }.transform-group label > span { width: 15px; padding-left: 4px; font-size: 7px; font-weight: 700; }.transform-group label.x > span { color: #df7886; }.transform-group label.y > span { color: #6bb88f; }.transform-group label.z > span { color: #7998e4; }.transform-group :deep(input) { width: 100%; min-width: 0; padding: 0 2px; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 8px; }.transform-group label > small { color: var(--text-muted); font-size: 7px; }.offset-group { margin: 0; }.offset-group > strong { display: flex; align-items: center; gap: 3px; }.offset-group > strong button { display: grid; width: 15px; height: 15px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; cursor: pointer; }.offset-group > strong button:hover { color: var(--text-primary); }
.alpha-note { display: flex; align-items: flex-start; gap: 5px; }.alpha-note svg { flex: 0 0 auto; margin-top: 1px; color: var(--accent); }
.property-list { display: grid; gap: 5px; }.property-list > label { display: grid; min-height: 24px; grid-template-columns: 1fr 118px; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 8.5px; }.property-list > label.keyable { grid-template-columns: 1fr 74px 48px; }.property-list > label > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }.property-list :deep(.m-select) { min-width: 0; width: 100%; }.property-list input, .select-field { width: 100%; height: 23px; padding: 0 5px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; outline: 0; font: inherit; font-size: 8.5px; }.property-list input:focus, .select-field:focus { border-color: var(--focus); }.property-list input.color-field { padding: 2px; }.select-field { cursor: pointer; }.check-row button { display: grid; width: 23px; height: 20px; justify-self: end; place-items: center; padding: 0; color: #525762; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; cursor: pointer; }.check-row button.checked { color: #cdd5ff; background: var(--bg-selected); border-color: var(--accent-border); }.active-camera { height: 26px; color: #101219; background: var(--button-accent); border: 1px solid #aab4ff; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; }.active-camera:disabled { color: #8f96ad; background: #202432; border-color: #383e52; cursor: default; }
.mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }.mode-switch button { display: flex; height: 24px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; }.mode-switch button:hover { color: var(--text-primary); background: var(--bg-hover); }.mode-switch button.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }
.influence-stack { display: grid; gap: 5px; padding: 5px 6px 8px; }.influence-block { background: #15171d; border: 1px solid #292d36; border-radius: 3px; }.influence-block.disabled { opacity: .5; }.influence-block header { display: flex; height: 25px; align-items: center; gap: 4px; padding: 0 4px; border-bottom: 1px solid #282b33; }.influence-block header strong { min-width: 0; flex: 1; overflow: hidden; color: var(--text-secondary); font-size: 9px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }.influence-block header button { display: grid; width: 18px; height: 18px; flex: 0 0 18px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.influence-block header button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }.influence-block header button:disabled { opacity: .3; cursor: default; }.influence-block header button.checked { color: #9aa8ff; }.influence-block label { display: grid; min-height: 24px; grid-template-columns: 1fr 74px 48px; align-items: center; gap: 5px; padding: 2px 6px; color: var(--text-secondary); font-size: 8.5px; }.influence-block label > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.influence-block :deep(input) { width: 100%; height: 21px; padding: 0 5px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; outline: 0; font: inherit; font-size: 8.5px; }.influence-block :deep(input:focus) { border-color: var(--focus); }.influence-add { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }.influence-add button { display: flex; height: 24px; align-items: center; justify-content: center; gap: 3px; overflow: hidden; color: var(--text-secondary); background: #181a20; border: 1px dashed #3a3e49; border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; white-space: nowrap; }.influence-add button:hover { color: var(--text-primary); border-color: var(--accent-border); }
.point-list { display: grid; gap: 5px; padding: 0 6px 8px; }.point-block { background: #15171d; border: 1px solid #292d36; border-radius: 3px; }.point-block header { display: flex; height: 24px; align-items: center; gap: 4px; padding: 0 4px; border-bottom: 1px solid #282b33; }.point-block header strong { flex: 1; color: var(--text-secondary); font-size: 8.5px; font-weight: 550; }.point-block header button { display: grid; width: 18px; height: 18px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.point-block header button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }.point-block header button:disabled { opacity: .35; cursor: default; }.point-block header button.point-mode { width: auto; padding: 0 6px; color: #9aa8ff; background: #1d2130; border: 1px solid #343b52; font-size: 7.5px; }.point-toggle svg.closed { transform: rotate(-90deg); }
.vector-row { display: grid; grid-template-columns: 34px repeat(3, minmax(0, 1fr)); align-items: center; gap: 3px; padding: 3px 4px; }.vector-row > strong { color: var(--text-muted); font-size: 7px; font-weight: 500; text-transform: uppercase; }.vector-row label { display: flex; height: 21px; min-width: 0; align-items: center; overflow: hidden; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.vector-row label:focus-within { border-color: var(--focus); }.vector-row label > span { width: 13px; padding-left: 3px; font-size: 6.5px; font-weight: 700; }.vector-row label.x > span { color: #df7886; }.vector-row label.y > span { color: #6bb88f; }.vector-row label.z > span { color: #7998e4; }.vector-row :deep(input) { width: 100%; min-width: 0; padding: 0 2px; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 8px; }.vector-row :deep(input:disabled) { color: var(--text-muted); }
.path-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }.path-actions button { display: flex; height: 25px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: #181a20; border: 1px dashed #3a3e49; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; }.path-actions button:hover { color: var(--text-primary); border-color: var(--accent-border); }.path-actions button.danger:hover { color: #f0a7a7; border-color: #6d3d45; }
.metadata { display: grid; grid-template-columns: 1fr auto; gap: 7px 10px; padding: 7px 8px 9px; font-size: 8px; }.metadata span { color: var(--text-muted); }.metadata strong { color: var(--text-secondary); font-weight: 500; }.empty-state { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 6px; padding: 20px; color: var(--text-muted); text-align: center; }.empty-state svg { color: var(--accent); }.empty-state strong { color: var(--text-primary); font-size: 10px; }.empty-state span { font-size: 8.5px; line-height: 1.4; }
</style>
