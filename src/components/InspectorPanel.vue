<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  ChevronDown, ChevronUp, Eye, EyeOff, Link2, MoreHorizontal, Plus, RotateCcw,
  SlidersHorizontal, Sparkles, Clock3, Trash2,
} from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { LAYER_EFFECT_OPTIONS, layerEffectLabel, layerEffectParameters } from '@/engine/nodes/layerEffects'
import type { EditorLayer, LayerEffectKind } from '@/models/editor'
import IconButton from './common/IconButton.vue'
import KeyframeControl from './common/KeyframeControl.vue'
import NumberField from './common/NumberField.vue'
import PanelHeader from './common/PanelHeader.vue'
import RigPanel from './common/RigPanel.vue'
import MSelect from './common/MSelect.vue'

const store = useEditorStore()
const { selectedLayer, selectedKeyframeId, currentTime, project } = storeToRefs(store)
const activeTab = ref('Inspector')
const scaleLinked = ref(true)
const collapsed = ref<Record<string, boolean>>({})
const blendMode = ref('Normal')
const effectToAdd = ref<LayerEffectKind>('blur')
const tabs = ['Inspector', 'Effects', 'Metadata']
/** Only textured quads have a surface a skeleton can bend. */
const riggable = computed(() => selectedLayer.value?.type === 'image' || selectedLayer.value?.type === 'video')

type TransformKey = keyof EditorLayer['transform']
interface PropertyConfig { key: TransformKey; label: string; suffix?: string; min?: number; max?: number; step?: number }
const transformProperties: PropertyConfig[] = [
  { key: 'x', label: 'Position X', step: .1 }, { key: 'y', label: 'Position Y', step: .1 },
  { key: 'scaleX', label: 'Scale X', suffix: '%', min: 0, step: .1 }, { key: 'scaleY', label: 'Scale Y', suffix: '%', min: 0, step: .1 },
  { key: 'rotation', label: 'Rotation', suffix: '°', step: .1 }, { key: 'opacity', label: 'Opacity', suffix: '%', min: 0, max: 100, step: .1 },
]
const layerIcon = computed(() => selectedLayer.value?.type === 'text' ? 'T' : selectedLayer.value?.type.slice(0, 1).toUpperCase())
const selectedEffects = computed(() => selectedLayer.value?.effects ?? [])

function valueFor(key: TransformKey) {
  const channel = selectedLayer.value?.transform[key]
  if (!channel) return 0
  const selectedKeyframe = channel.keyframes.find((keyframe) => keyframe.id === selectedKeyframeId.value)
  return selectedKeyframe?.value ?? evaluateNumericProperty(channel, currentTime.value)
}
function setValue(key: TransformKey, value: number) { store.setLayerValue(key, value) }
function toggleAnimated(key: TransformKey) {
  const property = selectedLayer.value?.transform[key]
  if (!property) return
  property.animated = !property.animated
  store.markChanged()
}
function toggleGroup(group: string) { collapsed.value[group] = !collapsed.value[group] }
function addEffect() { store.addLayerEffect(effectToAdd.value) }
</script>

<template>
  <aside class="inspector-panel">
    <PanelHeader title="Inspector" :subtitle="selectedLayer?.type">
      <template #icon><SlidersHorizontal :size="13" /></template>
    </PanelHeader>
    <div class="panel-tabs">
      <button v-for="tab in tabs" :key="tab" type="button" :class="{ active: activeTab === tab }" @click="activeTab = tab">{{ tab }}</button>
    </div>

    <template v-if="activeTab === 'Inspector' && selectedLayer">
      <div class="selection-summary">
        <span class="selection-icon">{{ layerIcon }}</span>
        <span><strong>{{ selectedLayer.name }}</strong><small>{{ selectedLayer.type }} layer · {{ selectedLayer.effects.length }} effects</small></span>
        <IconButton :icon="MoreHorizontal" label="Selection menu" />
      </div>

      <div class="inspector-scroll">
        <section class="property-section">
          <button class="section-header" type="button" @click="toggleGroup('transform')"><ChevronDown :size="13" :class="{ closed: collapsed.transform }" /><span>Transform</span><small>2D</small><RotateCcw :size="11" /></button>
          <div v-if="!collapsed.transform" class="property-list">
            <div v-for="property in transformProperties" :key="property.key" class="property-row">
              <button class="animate-toggle" type="button" :class="{ active: selectedLayer.transform[property.key].animated }" :title="`Animate ${property.label}`" @click="toggleAnimated(property.key)">
                <Clock3 :size="11" />
              </button>
              <label :title="property.label">{{ property.label }}</label>
              <NumberField class="numeric-field" :model-value="valueFor(property.key)" :min="property.min" :max="property.max" :step="property.step" :suffix="property.suffix" :label="property.label" @update:model-value="setValue(property.key, $event)" />
              <KeyframeControl :property="selectedLayer.transform[property.key]" :label="property.label" scope="layer" />
              <button v-if="property.key === 'scaleX'" class="link-button" type="button" :class="{ active: scaleLinked }" title="Link scale" @click="scaleLinked = !scaleLinked"><Link2 :size="10" /></button>
            </div>
          </div>
        </section>

        <section class="property-section">
          <button class="section-header" type="button" @click="toggleGroup('compositing')"><ChevronDown :size="13" :class="{ closed: collapsed.compositing }" /><span>Compositing</span><small /><RotateCcw :size="11" /></button>
          <div v-if="!collapsed.compositing" class="property-list simple">
            <div class="property-row"><span class="row-indent" /><label>Blend mode</label><button class="select-control" type="button">{{ blendMode }} <ChevronDown :size="10" /></button></div>
            <div class="property-row"><span class="row-indent" /><label>Track matte</label><button class="select-control" type="button">None <ChevronDown :size="10" /></button></div>
          </div>
        </section>

        <section class="property-section">
          <button class="section-header" type="button" @click="toggleGroup('timing')"><ChevronDown :size="13" :class="{ closed: collapsed.timing }" /><span>Timing</span><small /><RotateCcw :size="11" /></button>
          <div v-if="!collapsed.timing" class="property-list simple">
            <div class="property-row"><span class="row-indent" /><label>Start</label><div class="numeric-field time">{{ selectedLayer.start.toFixed(2) }} s</div></div>
            <div class="property-row"><span class="row-indent" /><label>Duration</label><div class="numeric-field time">{{ selectedLayer.duration.toFixed(2) }} s</div></div>
            <div class="property-row"><span class="row-indent" /><label>Speed</label><div class="numeric-field time">100 %</div></div>
          </div>
        </section>

        <RigPanel
          :rig-id="selectedLayer.rigId"
          scope="layer"
          :unavailable="riggable ? undefined : 'Rigs bend a texture, so they attach to image and video layers.'"
        />

        <section class="property-section effects-section">
          <div class="section-header static"><ChevronDown :size="13" /><span>Effects</span><small>{{ selectedEffects.length }}</small><span /></div>
          <div v-if="selectedLayer.type !== 'audio'" class="effect-add-row">
            <MSelect v-model="effectToAdd" :options="LAYER_EFFECT_OPTIONS" label="Effect to add" />
            <button type="button" title="Add selected effect" @click="addEffect"><Plus :size="12" /> Add</button>
          </div>
          <article v-for="(effect, index) in selectedEffects" :key="effect.id" class="effect-panel" :class="{ disabled: !effect.enabled }">
            <header>
              <button type="button" :title="effect.enabled ? 'Disable effect' : 'Enable effect'" @click="store.toggleLayerEffect(effect.id)"><Eye v-if="effect.enabled" :size="11" /><EyeOff v-else :size="11" /></button>
              <strong :title="layerEffectLabel(effect.kind)">{{ layerEffectLabel(effect.kind) }}</strong><span />
              <button type="button" title="Move effect up" :disabled="index === 0" @click="store.moveLayerEffect(effect.id, -1)"><ChevronUp :size="11" /></button>
              <button type="button" title="Move effect down" :disabled="index === selectedEffects.length - 1" @click="store.moveLayerEffect(effect.id, 1)"><ChevronDown :size="11" /></button>
              <button type="button" title="Delete effect" @click="store.removeLayerEffect(effect.id)"><Trash2 :size="11" /></button>
            </header>
            <div v-for="parameter in layerEffectParameters(effect.kind)" :key="parameter.key" class="effect-parameter">
              <span :title="parameter.label">{{ parameter.label }}</span>
              <NumberField
                class="effect-number" :model-value="effect.values[parameter.key] ?? parameter.value ?? 0"
                :min="parameter.min" :max="parameter.max" :step="parameter.step" :suffix="parameter.suffix"
                :label="`${layerEffectLabel(effect.kind)} ${parameter.label}`"
                @update:model-value="store.setLayerEffectValue(effect.id, parameter.key, $event)"
              />
            </div>
          </article>
          <div v-if="selectedLayer.type === 'audio'" class="effects-empty">Pixel effects are unavailable on audio layers.</div>
        </section>
      </div>
    </template>

    <div v-else-if="activeTab === 'Effects'" class="tab-placeholder">
      <Sparkles :size="25" /><strong>Effect stack</strong><span>{{ selectedEffects.length }} effects applied to {{ selectedLayer?.name }}</span>
      <button type="button" @click="activeTab = 'Inspector'"><SlidersHorizontal :size="12" /> Edit in Inspector</button>
    </div>
    <div v-else class="metadata-list">
      <div><span>Project</span><strong>{{ project.name }}</strong></div><div><span>Resolution</span><strong>{{ project.width }} × {{ project.height }}</strong></div><div><span>Frame rate</span><strong>{{ project.frameRate }} fps</strong></div><div><span>Color space</span><strong>Rec. 709</strong></div><div><span>Layer ID</span><strong>{{ selectedLayer?.id }}</strong></div>
    </div>
  </aside>
</template>

<style scoped>
.inspector-panel { display: flex; height: 100%; min-height: 0; flex-direction: column; background: var(--bg-panel); }.panel-tabs { display: flex; height: 31px; flex: 0 0 auto; padding: 3px 6px 0; border-bottom: 1px solid var(--border-subtle); }.panel-tabs button { position: relative; flex: 1; color: var(--text-muted); background: transparent; border: 0; font: inherit; font-size: 10px; cursor: pointer; }.panel-tabs button.active { color: var(--text-primary); }.panel-tabs button.active::after { position: absolute; right: 7px; bottom: -1px; left: 7px; height: 2px; background: var(--accent); content: ''; }
.selection-summary { display: flex; height: 49px; flex: 0 0 auto; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); }.selection-icon { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; color: #d7ddff; background: #29304b; border: 1px solid #4d5787; border-radius: 4px; font-size: 12px; font-weight: 700; }.selection-summary > span:nth-child(2) { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }.selection-summary strong, .selection-summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.selection-summary strong { color: var(--text-primary); font-size: 10.5px; font-weight: 580; }.selection-summary small { color: var(--text-muted); font-size: 8.5px; text-transform: capitalize; }
.inspector-scroll { min-height: 0; flex: 1; overflow: auto; }.property-section { border-bottom: 1px solid var(--border-subtle); }.section-header { display: grid; width: 100%; height: 28px; grid-template-columns: 14px auto 1fr 15px; align-items: center; gap: 3px; padding: 0 7px; color: var(--text-secondary); text-align: left; background: #17191f; border: 0; font: inherit; cursor: pointer; }.section-header:hover { background: var(--bg-hover); }.section-header span { font-size: 9.5px; font-weight: 650; letter-spacing: .055em; text-transform: uppercase; }.section-header small { color: var(--text-muted); font-size: 8px; text-align: right; }.section-header svg.closed { transform: rotate(-90deg); }.section-header.static { cursor: default; }.section-header.static > button { display: grid; width: 18px; height: 18px; place-items: center; padding: 0; color: var(--text-secondary); background: transparent; border: 0; cursor: pointer; }
.property-list { padding: 5px 4px 7px; }.property-row { position: relative; display: grid; min-height: 27px; grid-template-columns: 18px minmax(54px, .9fr) minmax(65px, 1fr) 50px; align-items: center; gap: 3px; padding: 1px 2px; }.property-row label { overflow: hidden; color: var(--text-secondary); font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }.animate-toggle { display: grid; width: 18px; height: 18px; place-items: center; padding: 0; color: #565b66; background: transparent; border: 0; border-radius: 3px; cursor: pointer; }.animate-toggle:hover { color: var(--text-secondary); background: var(--bg-hover); }.animate-toggle.active { color: var(--keyframe); }.numeric-field { display: flex; height: 23px; min-width: 0; align-items: center; overflow: hidden; color: var(--text-muted); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font-size: 9px; }.numeric-field:focus-within { border-color: var(--focus); }.numeric-field :deep(input) { width: 100%; min-width: 0; height: 100%; padding: 0 5px; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 9.5px; font-variant-numeric: tabular-nums; }.numeric-field :deep(.suffix) { padding-right: 5px; }.numeric-field.time { justify-content: flex-end; padding: 0 5px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }.link-button { position: absolute; z-index: 2; right: 52px; bottom: -13px; display: grid; width: 16px; height: 16px; place-items: center; padding: 0; color: var(--text-muted); background: var(--bg-panel); border: 0; cursor: pointer; }.link-button.active { color: var(--accent); }.row-indent { width: 18px; }.property-list.simple .property-row { grid-template-columns: 18px 1fr minmax(82px, 1.15fr); }.select-control { display: flex; height: 23px; align-items: center; justify-content: space-between; padding: 0 6px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 9.5px; cursor: pointer; }
.effect-add-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px; padding: 5px 6px 0; }.effect-add-row > button { display: flex; height: 24px; align-items: center; gap: 3px; padding: 0 7px; color: var(--text-primary); background: var(--bg-selected); border: 1px solid var(--accent-border); border-radius: 3px; font: inherit; font-size: 9px; white-space: nowrap; cursor: pointer; }
.effect-panel { margin: 5px 6px; background: #15171d; border: 1px solid #292d36; border-radius: 3px; }.effect-panel.disabled { opacity: .58; }.effect-panel header { display: flex; height: 27px; align-items: center; gap: 3px; padding: 0 4px; border-bottom: 1px solid #282b33; }.effect-panel header strong { min-width: 0; overflow: hidden; color: var(--text-secondary); font-size: 9.5px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }.effect-panel header span { flex: 1; }.effect-panel button { display: grid; width: 18px; height: 18px; flex: 0 0 auto; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }.effect-panel button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }.effect-panel button:disabled { opacity: .3; cursor: default; }.effect-parameter { display: grid; min-height: 27px; grid-template-columns: minmax(0, 1fr) 82px; align-items: center; gap: 5px; padding: 2px 6px 2px 24px; color: var(--text-muted); font-size: 9px; }.effect-parameter > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.effect-number { height: 23px; }.effects-empty { padding: 8px; color: var(--text-muted); font-size: 9px; line-height: 1.4; }
.tab-placeholder { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 7px; padding: 20px; color: var(--text-muted); text-align: center; }.tab-placeholder svg { color: var(--accent); }.tab-placeholder strong { color: var(--text-primary); font-size: 11px; }.tab-placeholder span { font-size: 9.5px; line-height: 1.45; }.tab-placeholder button { display: flex; height: 27px; align-items: center; gap: 4px; padding: 0 8px; color: var(--text-primary); background: var(--bg-selected); border: 1px solid var(--accent-border); border-radius: 4px; font: inherit; font-size: 9.5px; cursor: pointer; }.metadata-list { padding: 7px; }.metadata-list div { display: flex; min-height: 28px; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--border-subtle); font-size: 9.5px; }.metadata-list span { color: var(--text-muted); }.metadata-list strong { overflow: hidden; color: var(--text-secondary); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
</style>
