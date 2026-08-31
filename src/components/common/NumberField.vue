<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  label?: string
  disabled?: boolean
  /** Value change per pixel dragged, before speed and modifiers. Defaults to one step per two pixels. */
  sensitivity?: number
}>(), { step: 1 })

const emit = defineEmits<{ 'update:modelValue': [value: number]; 'scrub-end': [] }>()

const input = ref<HTMLInputElement>()
const dragging = ref(false)

/** Enough movement to mean a drag rather than a click that wants to place a caret. */
const DRAG_THRESHOLD = 3

interface ScrubState {
  pointerId: number
  startX: number
  startY: number
  lastY: number
  lastTime: number
  value: number
  speed: number
  moved: boolean
}

let scrub: ScrubState | null = null

const decimals = computed(() => {
  const text = String(props.step)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
})

const display = computed(() => Number(props.modelValue.toFixed(decimals.value)))

function clamp(value: number) {
  const lower = props.min ?? Number.NEGATIVE_INFINITY
  const upper = props.max ?? Number.POSITIVE_INFINITY
  return Math.min(upper, Math.max(lower, value))
}

function commit(value: number) {
  const snapped = Number(clamp(value).toFixed(decimals.value))
  if (Number.isFinite(snapped) && snapped !== props.modelValue) emit('update:modelValue', snapped)
}

function onInput(event: Event) {
  const next = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(next)) commit(next)
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || props.disabled) return
  // Native spinner arrows live inside the input; leaving them alone until the pointer actually moves
  // keeps them clickable, and keeps a plain click free to focus the field for typing.
  scrub = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastY: event.clientY,
    lastTime: event.timeStamp,
    value: props.modelValue,
    speed: 1,
    moved: false,
  }
}

function onPointerMove(event: PointerEvent) {
  const state = scrub
  if (!state || state.pointerId !== event.pointerId) return
  const travel = Math.abs(event.clientY - state.startY) + Math.abs(event.clientX - state.startX)
  if (!state.moved && travel < DRAG_THRESHOLD) return
  if (!state.moved) {
    state.moved = true
    dragging.value = true
    input.value?.blur()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  event.preventDefault()

  /*
   * Speed follows the pointer: a slow drag stays near one step per pixel for placing an exact value,
   * a fast one multiplies up so a large range is reachable without letting go. It eases rather than
   * tracking instantaneously, or the value would jitter with every frame's noise.
   */
  const elapsed = Math.max(1, event.timeStamp - state.lastTime)
  const velocity = Math.abs(event.clientY - state.lastY) / elapsed
  state.speed += (Math.min(6, 1 + velocity * 3) - state.speed) * .25
  state.lastY = event.clientY
  state.lastTime = event.timeStamp

  const fine = event.shiftKey ? .2 : event.ctrlKey || event.metaKey ? 5 : 1
  const perPixel = (props.sensitivity ?? props.step / 2) * state.speed * fine
  // Up increases, matching the arrow that sits above the one pointing down.
  state.value -= (event.clientY - state.startY) * perPixel
  state.startY = event.clientY
  commit(state.value)
}

function onPointerUp(event: PointerEvent) {
  const state = scrub
  scrub = null
  if (!state) return
  const element = event.currentTarget as HTMLElement
  if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  if (state.moved) {
    dragging.value = false
    emit('scrub-end')
    return
  }
  input.value?.focus()
  input.value?.select()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const scale = event.shiftKey ? 10 : event.altKey ? .1 : 1
  commit(props.modelValue + props.step * scale * (event.key === 'ArrowUp' ? 1 : -1))
}
</script>

<template>
  <div
    class="number-field"
    :class="{ dragging, disabled }"
    :title="label ? `${label} — drag up or down to scrub, or type a value` : 'Drag up or down to scrub, or type a value'"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <input
      ref="input"
      :value="display"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :aria-label="label"
      @input="onInput"
      @keydown="onKeyDown"
    />
    <span v-if="suffix" class="suffix">{{ suffix }}</span>
  </div>
</template>

<style scoped>
.number-field { position: relative; display: flex; min-width: 0; align-items: center; cursor: ns-resize; touch-action: none; }
.number-field.disabled { cursor: default; opacity: .55; }
.number-field.dragging { cursor: ns-resize; user-select: none; }
/* Neutral by default: the box, font and colour come from whatever the call site puts on the root. */
.number-field input { width: 100%; min-width: 0; flex: 1; padding: 0; color: inherit; background: transparent; border: 0; outline: 0; font: inherit; cursor: inherit; }
.number-field.dragging input { pointer-events: none; }
.number-field .suffix { flex: 0 0 auto; padding-left: 3px; color: var(--text-muted); pointer-events: none; }
</style>
