<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { ChevronDown, Plus, RotateCcw, Spline, Trash2 } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { rigBoneChannels } from '@/engine/rig/rigFactory'
import { MAX_RIG_CELLS, MIN_RIG_CELLS } from '@/engine/rig/rigMesh'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import type { AuroraRigBone } from '@/models/editor'
import MSelect, { type MSelectOption } from './MSelect.vue'
import NumberField from './NumberField.vue'
import KeyframeControl from './KeyframeControl.vue'

/**
 * The rig editor, shared by the timeline inspector and the 3D inspector.
 *
 * Rigs are project-wide, so the only thing that differs between the two is which selection the
 * attachment lands on — the skeleton, its bones and their pose read and edit identically either way.
 */
const props = defineProps<{
  rigId?: string
  scope: 'layer' | 'object'
  /** Shown instead of the controls when the selection cannot carry a rig. */
  unavailable?: string
}>()

const store = useEditorStore()
const { rigs, selectedRigBoneId, currentTime } = storeToRefs(store)

const rig = computed(() => rigs.value.find((item) => item.id === props.rigId) ?? null)
const rigOptions = computed<MSelectOption[]>(() => [
  { value: '', label: 'None' },
  ...rigs.value.map((item) => ({ value: item.id, label: `${item.name} · ${item.bones.length} ${item.bones.length === 1 ? 'bone' : 'bones'}` })),
])
const bone = computed(() => rig.value?.bones.find((item) => item.id === selectedRigBoneId.value) ?? null)
const parentOptions = computed<MSelectOption[]>(() => {
  const current = bone.value
  if (!rig.value || !current) return []
  return [
    { value: '', label: 'None (root)' },
    ...store.rigParentCandidates(rig.value.id, current.id).map((item) => ({ value: item.id, label: item.name })),
  ]
})

const restFields = [
  { key: 'x' as const, label: 'X', step: .02 },
  { key: 'y' as const, label: 'Y', step: .02 },
  { key: 'angle' as const, label: 'Angle', step: 1, suffix: '°' },
  { key: 'length' as const, label: 'Length', step: .02, min: 0 },
  { key: 'falloff' as const, label: 'Falloff', step: .02, min: 0 },
]

function attach(rigId: string) {
  if (props.scope === 'layer') store.attachRigToLayer(rigId || null)
  else store.attachRigToObject(rigId || null)
}

function createAndAttach() {
  attach(store.addRig().id)
}

function boneDepth(item: AuroraRigBone) {
  let depth = 0
  const byId = new Map(rig.value?.bones.map((entry) => [entry.id, entry]) ?? [])
  for (let parent = item.parentId ? byId.get(item.parentId) : undefined; parent && depth < 8; parent = parent.parentId ? byId.get(parent.parentId) : undefined) depth += 1
  return depth
}

const poseValue = (property: AuroraRigBone['rotation']) => evaluateNumericProperty(property, currentTime.value)
</script>

<template>
  <section class="rig-panel">
    <div class="section-header static"><Spline :size="12" /><span>Rig</span><small>{{ rig ? `${rig.bones.length} ${rig.bones.length === 1 ? 'bone' : 'bones'}` : 'Off' }}</small></div>
    <p v-if="unavailable" class="rig-note">{{ unavailable }}</p>
    <div v-else class="rig-body">
      <label class="rig-row"><span>Skeleton</span><MSelect :model-value="rigId ?? ''" :options="rigOptions" label="Rig attached to this selection" @update:model-value="attach($event)" /></label>
      <button class="rig-action" type="button" @click="createAndAttach"><Plus :size="10" /> New rig</button>

      <template v-if="rig">
        <label class="rig-row"><span>Name</span><input :value="rig.name" aria-label="Rig name" @change="store.renameRig(rig.id, ($event.target as HTMLInputElement).value)" /></label>
        <div class="rig-grid">
          <strong>Mesh</strong>
          <label><span>Cols</span><NumberField :model-value="rig.columns" :min="MIN_RIG_CELLS" :max="MAX_RIG_CELLS" :step="1" label="Rig mesh columns" @update:model-value="store.setRigGrid(rig.id, $event, rig.rows)" /></label>
          <label><span>Rows</span><NumberField :model-value="rig.rows" :min="MIN_RIG_CELLS" :max="MAX_RIG_CELLS" :step="1" label="Rig mesh rows" @update:model-value="store.setRigGrid(rig.id, rig.columns, $event)" /></label>
        </div>

        <div class="bone-list">
          <button
            v-for="item in rig.bones"
            :key="item.id"
            class="bone-row"
            type="button"
            :class="{ active: item.id === selectedRigBoneId }"
            :style="{ paddingLeft: `${6 + boneDepth(item) * 9}px` }"
            @click="selectedRigBoneId = item.id"
          >
            <ChevronDown :size="9" :class="{ closed: item.id !== selectedRigBoneId }" />
            <strong>{{ item.name }}</strong>
            <small v-if="item.rotation.animated || item.offsetX.animated || item.offsetY.animated || item.stretch.animated">keyed</small>
            <span class="bone-delete" title="Delete bone" @click.stop="store.deleteRigBone(rig.id, item.id)"><Trash2 :size="9" /></span>
          </button>
          <p v-if="!rig.bones.length" class="rig-note">No bones yet. Add one here, or draw it over the image with the Rig tool in the viewer.</p>
        </div>
        <button class="rig-action" type="button" @click="store.addRigBone(rig.id, { parentId: selectedRigBoneId ?? undefined, ...(bone ? { x: bone.x, y: bone.y } : {}) })"><Plus :size="10" /> Add bone</button>

        <template v-if="bone">
          <label class="rig-row"><span>Bone name</span><input :value="bone.name" aria-label="Bone name" @change="store.renameRigBone(rig.id, bone.id, ($event.target as HTMLInputElement).value)" /></label>
          <label class="rig-row"><span>Parent</span><MSelect :model-value="bone.parentId ?? ''" :options="parentOptions" label="Bone parent" @update:model-value="store.setRigBoneParent(rig.id, bone.id, $event || null)" /></label>
          <div class="rest-grid">
            <strong>Rest</strong>
            <label v-for="field in restFields" :key="field.key" :title="`Rest ${field.label}`">
              <span>{{ field.label }}</span>
              <NumberField :model-value="bone[field.key]" :min="field.min" :step="field.step" :suffix="field.suffix" :label="`bone rest ${field.label}`" @update:model-value="store.setRigBoneRest(rig.id, bone.id, { [field.key]: $event })" />
            </label>
          </div>
          <div class="pose-list">
            <strong>Pose<button type="button" title="Reset this bone's pose" @click="store.resetRigBonePose(rig.id, bone.id)"><RotateCcw :size="9" /></button></strong>
            <label v-for="channel in rigBoneChannels(bone)" :key="channel.key">
              <span>{{ channel.label }}</span>
              <NumberField :model-value="poseValue(channel.property)" :step="channel.step" :suffix="channel.suffix" :label="`bone ${channel.label}`" @update:model-value="store.setRigBonePose(rig.id, bone.id, channel.key, $event)" />
              <KeyframeControl variant="inline" scope="layer" :property="channel.property" :label="`bone ${channel.label}`" />
            </label>
          </div>
        </template>

        <button class="rig-action danger" type="button" @click="store.deleteRig(rig.id)"><Trash2 :size="10" /> Delete rig</button>
        <p class="rig-note">Rig space runs from -1 to 1 across the image, Y up. The same skeleton can drive a timeline image and a 3D image plane at once.</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.rig-panel { border-bottom: 1px solid var(--border-subtle); }.section-header { display: grid; width: 100%; height: 28px; grid-template-columns: 14px 1fr auto; align-items: center; gap: 4px; padding: 0 7px; color: var(--text-secondary); text-align: left; background: #17191f; border: 0; font: inherit; }.section-header span { font-size: 9px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; }.section-header small { color: var(--text-muted); font-size: 7.5px; }
.rig-body { display: grid; gap: 5px; padding: 5px 6px 8px; }.rig-note { margin: 2px 2px 0; color: var(--text-muted); font-size: 7.5px; line-height: 1.45; }.rig-note:first-child { padding: 6px; }
.rig-row { display: grid; min-height: 24px; grid-template-columns: 1fr 118px; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 8.5px; }.rig-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.rig-row input { width: 100%; height: 23px; padding: 0 5px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; outline: 0; font: inherit; font-size: 8.5px; }.rig-row input:focus { border-color: var(--focus); }.rig-row :deep(.m-select) { width: 100%; min-width: 0; }
.rig-action { display: flex; height: 24px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: #181a20; border: 1px dashed #3a3e49; border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; }.rig-action:hover { color: var(--text-primary); border-color: var(--accent-border); }.rig-action.danger:hover { color: #f0a3ad; border-color: #6d3b44; }
.rig-grid, .rest-grid { display: grid; grid-template-columns: 40px repeat(2, minmax(0, 1fr)); align-items: center; gap: 3px; }.rest-grid { grid-template-columns: 40px repeat(5, minmax(0, 1fr)); }.rig-grid > strong, .rest-grid > strong { color: var(--text-muted); font-size: 8px; font-weight: 500; }.rig-grid label, .rest-grid label { display: flex; height: 22px; min-width: 0; align-items: center; overflow: hidden; background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.rig-grid label:focus-within, .rest-grid label:focus-within { border-color: var(--focus); }.rig-grid label > span, .rest-grid label > span { padding-left: 4px; color: var(--text-muted); font-size: 7px; }.rig-grid :deep(input), .rest-grid :deep(input) { width: 100%; min-width: 0; padding: 0 2px; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 8px; }
.bone-list { display: grid; gap: 2px; }.bone-row { display: flex; height: 22px; align-items: center; gap: 4px; padding: 0 5px 0 6px; color: var(--text-secondary); text-align: left; background: #15171d; border: 1px solid #292d36; border-radius: 3px; font: inherit; cursor: pointer; }.bone-row:hover { background: var(--bg-hover); }.bone-row.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.bone-row strong { min-width: 0; flex: 1; overflow: hidden; font-size: 8.5px; font-weight: 520; text-overflow: ellipsis; white-space: nowrap; }.bone-row small { color: var(--keyframe); font-size: 7px; }.bone-row svg.closed { transform: rotate(-90deg); }.bone-delete { display: grid; width: 16px; height: 16px; place-items: center; color: var(--text-muted); border-radius: 2px; }.bone-delete:hover { color: #f0a3ad; background: rgb(240 163 173 / .12); }
.pose-list { display: grid; gap: 3px; }.pose-list > strong { display: flex; align-items: center; gap: 3px; color: var(--text-muted); font-size: 8px; font-weight: 500; }.pose-list > strong button { display: grid; width: 15px; height: 15px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; cursor: pointer; }.pose-list > strong button:hover { color: var(--text-primary); }.pose-list label { display: grid; min-height: 22px; grid-template-columns: 1fr 74px 24px; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 8.5px; }.pose-list :deep(input) { width: 100%; height: 21px; padding: 0 5px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; outline: 0; font: inherit; font-size: 8.5px; }.pose-list :deep(input:focus) { border-color: var(--focus); }
</style>
