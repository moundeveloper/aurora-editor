<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'

export interface MSelectOption { value: string; label: string }

const props = defineProps<{
  modelValue: string
  options: MSelectOption[]
  label: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement>()
const open = ref(false)
const selectedLabel = computed(() => props.options.find((option) => option.value === props.modelValue)?.label ?? 'Select…')

function choose(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

/** Capture phase, so a click inside a panel that stops pointerdown still dismisses the menu. */
function onDocumentPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="m-select">
    <button type="button" class="m-select-trigger" :aria-label="label" :aria-expanded="open" :title="selectedLabel" @click="open = !open">
      <span>{{ selectedLabel }}</span><ChevronDown :size="10" />
    </button>
    <div v-if="open" class="m-select-menu" role="listbox" :aria-label="label">
      <button v-for="option in options" :key="option.value" type="button" role="option" :aria-selected="option.value === modelValue" :title="option.label" @click="choose(option.value)">
        <span>{{ option.label }}</span><Check v-if="option.value === modelValue" :size="10" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.m-select { position: relative; min-width: 0; }.m-select-trigger { display: flex; width: 100%; height: 24px; min-width: 0; align-items: center; justify-content: space-between; gap: 5px; padding: 0 6px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; }.m-select-trigger:hover, .m-select-trigger[aria-expanded='true'] { color: var(--text-primary); border-color: var(--accent-border); }.m-select-trigger span, .m-select-menu span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.m-select-trigger svg { flex: 0 0 auto; }
.m-select-menu { position: absolute; z-index: 80; top: calc(100% + 3px); right: 0; left: 0; display: grid; max-height: 180px; overflow: auto; padding: 3px; background: #181b22; border: 1px solid #444955; border-radius: 3px; box-shadow: 0 10px 24px rgb(0 0 0 / .5); }.m-select-menu button { display: flex; width: 100%; height: 23px; min-width: 0; align-items: center; justify-content: space-between; gap: 5px; padding: 0 5px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 2px; font: inherit; font-size: 8px; text-align: left; cursor: pointer; }.m-select-menu button:hover, .m-select-menu button[aria-selected='true'] { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.m-select-menu svg { flex: 0 0 auto; color: var(--accent); }
</style>
