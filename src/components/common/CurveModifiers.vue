<script setup lang="ts">
import { ref } from 'vue'
import type { AnimatableProperty, CurveModifier } from '@/models/editor'
import MSelect from './MSelect.vue'
import NumberField from './NumberField.vue'

const props = defineProps<{ property: AnimatableProperty<number> }>()
const emit = defineEmits<{ change: [] }>()
const kind = ref('noise')
const options = [
  { value: 'cycle', label: 'Cycle' }, { value: 'noise', label: 'Noise' },
  { value: 'offset', label: 'Offset' }, { value: 'limit', label: 'Limit' },
]
function add() {
  props.property.modifiers ??= []
  props.property.modifiers.push({ id: crypto.randomUUID(), kind: kind.value as CurveModifier['kind'], enabled: true, amount: 10, frequency: 1, seed: 0, min: 0, max: 100 })
  emit('change')
}
function move(index: number, direction: number) {
  const list = props.property.modifiers!
  const target = index + direction
  if (target < 0 || target >= list.length) return
  list.splice(target, 0, list.splice(index, 1)[0]!)
  emit('change')
}
</script>

<template>
  <details class="curve-modifiers">
    <summary>Curve modifiers ({{ property.modifiers?.length ?? 0 }})</summary>
    <div class="add"><MSelect v-model="kind" :options="options" label="Curve modifier to add" /><button type="button" @click="add">Add modifier</button></div>
    <div v-for="(modifier, index) in property.modifiers" :key="modifier.id" class="modifier">
      <button type="button" :aria-pressed="modifier.enabled" :aria-label="`Toggle ${modifier.kind} modifier`" @click="modifier.enabled = !modifier.enabled; emit('change')">{{ modifier.kind }}</button>
      <template v-if="modifier.kind === 'noise' || modifier.kind === 'offset'">
        <NumberField v-model="modifier.amount" label="Modifier amount" @update:model-value="emit('change')" />
      </template>
      <template v-if="modifier.kind === 'noise'">
        <NumberField v-model="modifier.frequency" label="Noise frequency" :min="0" :step=".1" @update:model-value="emit('change')" />
        <NumberField v-model="modifier.seed" label="Noise seed" @update:model-value="emit('change')" />
      </template>
      <template v-if="modifier.kind === 'limit'">
        <NumberField v-model="modifier.min" label="Minimum value" @update:model-value="emit('change')" />
        <NumberField v-model="modifier.max" label="Maximum value" @update:model-value="emit('change')" />
      </template>
      <button type="button" :disabled="index === 0" aria-label="Move modifier up" @click="move(index, -1)">↑</button>
      <button type="button" :disabled="index === property.modifiers!.length - 1" aria-label="Move modifier down" @click="move(index, 1)">↓</button>
      <button type="button" aria-label="Delete modifier" @click="property.modifiers!.splice(index, 1); emit('change')">×</button>
    </div>
  </details>
</template>

<style scoped>
.curve-modifiers { flex: 0 0 auto; max-height: 130px; overflow: auto; padding: 5px 10px; color: #b9c1d3; background: #171a22; font-size: 11px; }
summary { cursor: pointer; }.add, .modifier { display: flex; align-items: center; gap: 8px; padding-top: 5px; }.modifier > :deep(*) { max-width: 130px; }button { color: inherit; background: #252a36; border: 1px solid #424958; border-radius: 3px; padding: 3px 8px; }button[aria-pressed=false] { opacity: .45; }
</style>
