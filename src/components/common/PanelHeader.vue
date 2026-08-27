<script setup lang="ts">
import { MoreHorizontal, X } from '@lucide/vue'
import IconButton from './IconButton.vue'

defineProps<{ title: string; subtitle?: string; closable?: boolean }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <header class="panel-header">
    <div class="panel-heading">
      <slot name="icon" />
      <span class="panel-title">{{ title }}</span>
      <span v-if="subtitle" class="panel-subtitle">{{ subtitle }}</span>
    </div>
    <div class="panel-actions">
      <slot name="actions" />
      <IconButton :icon="MoreHorizontal" label="Panel menu" :size="14" />
      <IconButton v-if="closable" :icon="X" label="Close panel" :size="13" @click="$emit('close')" />
    </div>
  </header>
</template>

<style scoped>
.panel-header { display: flex; height: 31px; align-items: center; justify-content: space-between; padding: 0 6px 0 10px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-panel-alt); }
.panel-heading, .panel-actions { display: flex; min-width: 0; align-items: center; gap: 7px; }
.panel-title { color: var(--text-primary); font-size: 11px; font-weight: 650; letter-spacing: .055em; text-transform: uppercase; white-space: nowrap; }
.panel-subtitle { overflow: hidden; color: var(--text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
:deep(.panel-actions .icon-button) { width: 23px; height: 23px; flex-basis: 23px; }
</style>
