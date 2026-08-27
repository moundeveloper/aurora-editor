<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(defineProps<{
  icon: Component
  label: string
  active?: boolean
  disabled?: boolean
  size?: number
}>(), { active: false, disabled: false, size: 14 })

defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <button
    class="icon-button"
    :class="{ active }"
    type="button"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <component :is="icon" :size="size" :stroke-width="1.7" />
  </button>
</template>

<style scoped>
.icon-button {
  display: inline-grid;
  width: 27px;
  height: 27px;
  flex: 0 0 27px;
  place-items: center;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.icon-button:hover { color: var(--text-primary); background: var(--bg-hover); }
.icon-button.active { color: var(--accent); background: var(--bg-selected); border-color: var(--accent-border); }
.icon-button:focus-visible { outline: 2px solid var(--focus); outline-offset: -1px; }
.icon-button:disabled { opacity: .35; cursor: default; }
</style>
