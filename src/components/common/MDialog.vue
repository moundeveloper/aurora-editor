<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from '@lucide/vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  confirmDisabled?: boolean
}>(), {
  description: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel', danger: false, confirmDisabled: false,
})

const emit = defineEmits<{ close: []; confirm: [] }>()
const panel = ref<HTMLElement>()
let returnFocus: HTMLElement | null = null

watch(() => props.open, async (open) => {
  if (open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    const focusTarget = panel.value?.querySelector<HTMLElement>('[autofocus]')
      ?? panel.value?.querySelector<HTMLElement>('input, textarea, select, button')
    focusTarget?.focus()
  } else {
    returnFocus?.focus()
    returnFocus = null
  }
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onBeforeUnmount(() => returnFocus?.focus())
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="m-dialog-backdrop" @pointerdown.self="emit('close')" @keydown="onKeydown">
      <form ref="panel" class="m-dialog" role="dialog" aria-modal="true" :aria-label="title" @submit.prevent="emit('confirm')">
        <header>
          <span><strong :title="title">{{ title }}</strong><small v-if="description">{{ description }}</small></span>
          <button type="button" title="Close dialog" aria-label="Close dialog" @click="emit('close')"><X :size="13" /></button>
        </header>
        <div class="m-dialog-body"><slot /></div>
        <footer>
          <button type="button" class="secondary" @click="emit('close')">{{ cancelLabel }}</button>
          <button type="submit" class="primary" :class="{ danger }" :disabled="confirmDisabled">{{ confirmLabel }}</button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.m-dialog-backdrop { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(4 5 8 / .68); backdrop-filter: blur(2px); }
.m-dialog { width: min(360px, calc(100vw - 32px)); overflow: hidden; color: var(--text-primary); background: #171920; border: 1px solid #454b59; border-radius: 5px; box-shadow: 0 18px 48px rgb(0 0 0 / .58); }
.m-dialog > header { display: flex; min-height: 42px; align-items: flex-start; gap: 10px; padding: 8px 9px 7px 11px; background: #1b1e26; border-bottom: 1px solid var(--border-subtle); }
.m-dialog > header > span { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }.m-dialog > header strong { overflow: hidden; font-size: 10.5px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }.m-dialog > header small { color: var(--text-muted); font-size: 8px; line-height: 1.35; }
.m-dialog > header button { display: grid; width: 23px; height: 23px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }.m-dialog > header button:hover { color: var(--text-primary); background: var(--bg-hover); }
.m-dialog-body { padding: 12px; }.m-dialog-body :deep(input), .m-dialog-body :deep(textarea) { width: 100%; height: 30px; padding: 0 8px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 4px; font: inherit; font-size: 10px; }.m-dialog-body :deep(input:focus), .m-dialog-body :deep(textarea:focus) { border-color: #a5b4fc; outline: 1px solid #a5b4fc; outline-offset: -1px; }
.m-dialog > footer { display: flex; height: 43px; align-items: center; justify-content: flex-end; gap: 6px; padding: 6px 10px; background: #14161c; border-top: 1px solid var(--border-subtle); }.m-dialog > footer button { min-width: 72px; height: 27px; padding: 0 10px; border-radius: 4px; font: inherit; font-size: 9px; cursor: pointer; white-space: nowrap; }.m-dialog > footer .secondary { color: var(--text-secondary); background: #1d2028; border: 1px solid var(--border-strong); }.m-dialog > footer .secondary:hover { color: var(--text-primary); background: var(--bg-hover); }.m-dialog > footer .primary { color: #0e1120; background: var(--button-accent); border: 1px solid #a5b4fc; font-weight: 650; }.m-dialog > footer .primary:hover:not(:disabled) { background: var(--button-accent-hover); }.m-dialog > footer .primary.danger { color: #fff; background: #b85d67; border-color: #d88991; }.m-dialog > footer .primary.danger:hover:not(:disabled) { background: #a9515b; }.m-dialog > footer button:disabled { opacity: .4; cursor: default; }
</style>
