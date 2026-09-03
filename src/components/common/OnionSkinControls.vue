<script setup lang="ts">
import { computed } from 'vue'
import { Layers3 } from '@lucide/vue'
import { MAX_ONION_SKIN_FRAMES } from '@/engine/rendering/onionSkin'
import IconButton from './IconButton.vue'
import NumberField from './NumberField.vue'

const props = defineProps<{
  enabled: boolean
  previousFrames: number
  nextFrames: number
  opacity: number
}>()

const emit = defineEmits<{
  'update:enabled': [value: boolean]
  'update:previousFrames': [value: number]
  'update:nextFrames': [value: number]
  'update:opacity': [value: number]
}>()

const opacityPercent = computed(() => Math.round(props.opacity * 100))
</script>

<template>
  <div class="onion-controls" :class="{ enabled }" aria-label="Onion skin controls">
    <IconButton
      :icon="Layers3"
      label="Onion skin previous and next frames (hidden during playback)"
      :active="enabled"
      @click="emit('update:enabled', !enabled)"
    />
    <template v-if="enabled">
      <label title="Previous ghost frames">
        <span class="previous-dot" />
        <span>P</span>
        <NumberField
          :model-value="previousFrames"
          :min="0"
          :max="MAX_ONION_SKIN_FRAMES"
          :step="1"
          label="Previous onion skin frames"
          @update:model-value="emit('update:previousFrames', Math.round($event))"
        />
      </label>
      <label title="Next ghost frames">
        <span class="next-dot" />
        <span>N</span>
        <NumberField
          :model-value="nextFrames"
          :min="0"
          :max="MAX_ONION_SKIN_FRAMES"
          :step="1"
          label="Next onion skin frames"
          @update:model-value="emit('update:nextFrames', Math.round($event))"
        />
      </label>
      <label class="opacity" title="Onion skin opacity">
        <span>α</span>
        <NumberField
          :model-value="opacityPercent"
          :min="1"
          :max="100"
          :step="1"
          suffix="%"
          label="Onion skin opacity"
          @update:model-value="emit('update:opacity', $event / 100)"
        />
      </label>
    </template>
  </div>
</template>

<style scoped>
.onion-controls { display: flex; height: 27px; flex: 0 0 auto; align-items: center; gap: 2px; }
.onion-controls.enabled { box-sizing: border-box; padding-right: 3px; background: var(--bg-selected); border: 1px solid var(--accent-border); border-radius: 4px; }
.onion-controls.enabled :deep(.icon-button.active) { border-color: transparent; }
label { display: flex; height: 21px; align-items: center; gap: 2px; color: var(--text-muted); font-size: 7.5px; white-space: nowrap; }
label + label { padding-left: 3px; border-left: 1px solid var(--border-subtle); }
.previous-dot, .next-dot { width: 4px; height: 4px; flex: 0 0 auto; border-radius: 50%; }
.previous-dot { background: #d98b7f; }
.next-dot { background: #8c9bff; }
.number-field { width: 20px; height: 19px; color: var(--text-primary); background: #171920; border: 1px solid var(--border-strong); border-radius: 3px; font-size: 8px; font-variant-numeric: tabular-nums; text-align: center; }
.number-field :deep(input) { appearance: textfield; }
.number-field :deep(input::-webkit-inner-spin-button), .number-field :deep(input::-webkit-outer-spin-button) { margin: 0; appearance: none; }
.opacity .number-field { width: 34px; padding: 0 2px; text-align: right; }
</style>
