<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, Diamond } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { AnimatableProperty } from '@/models/editor'

/**
 * The single keyframe affordance for every animatable numeric channel.
 * `full` is used in row-based property lists, `inline` inside the compact axis fields
 * of the 3D transform grid where there is only room for the diamond itself.
 */
const props = withDefaults(defineProps<{
  property: AnimatableProperty<number>
  label: string
  scope?: 'layer' | 'scene'
  variant?: 'full' | 'inline'
}>(), { scope: 'scene', variant: 'full' })

const store = useEditorStore()
const keyed = computed(() => store.isKeyedAtPlayhead(props.property))
const hasPrevious = computed(() => store.hasAdjacentKeyframe(props.property, -1))
const hasNext = computed(() => store.hasAdjacentKeyframe(props.property, 1))
const toggleTitle = computed(() => `${keyed.value ? 'Remove' : 'Add'} ${props.label} keyframe at the playhead`)

function toggle() {
  if (props.scope === 'layer') store.toggleLayerPropertyKeyframe(props.property)
  else store.toggle3DPropertyKeyframe(props.property)
}
</script>

<template>
  <button
    v-if="variant === 'inline'"
    type="button"
    class="keyframe-inline"
    :class="{ animated: property.animated, keyed }"
    :title="toggleTitle"
    @click.stop="toggle"
  ><Diamond :size="9" :fill="keyed ? 'currentColor' : 'none'" /></button>

  <div v-else class="keyframe-control">
    <button type="button" :disabled="!hasPrevious" :title="`Previous ${label} keyframe`" @click.stop="store.stepToAdjacentKeyframe(property, -1)"><ChevronLeft :size="10" /></button>
    <button type="button" class="diamond" :class="{ animated: property.animated, keyed }" :title="toggleTitle" @click.stop="toggle"><Diamond :size="10" :fill="keyed ? 'currentColor' : 'none'" /></button>
    <button type="button" :disabled="!hasNext" :title="`Next ${label} keyframe`" @click.stop="store.stepToAdjacentKeyframe(property, 1)"><ChevronRight :size="10" /></button>
  </div>
</template>

<style scoped>
.keyframe-control { display: flex; justify-self: end; }.keyframe-control button { display: grid; width: 16px; height: 19px; place-items: center; padding: 0; color: #50545e; background: transparent; border: 0; cursor: pointer; }.keyframe-control button:hover:not(:disabled) { color: var(--text-primary); }.keyframe-control button:disabled { opacity: .35; cursor: default; }.keyframe-control button.animated { color: #8796dc; }.keyframe-control button.keyed { color: var(--keyframe); }
.keyframe-inline { display: grid; width: 17px; height: 100%; min-height: 19px; flex: 0 0 auto; place-items: center; padding: 0; color: #565b68; background: transparent; border: 0; border-left: 1px solid var(--border-subtle); cursor: pointer; }.keyframe-inline:hover { color: #cbd3ff; background: var(--bg-hover); }.keyframe-inline.animated { color: #9aa8ff; }.keyframe-inline.keyed { color: #e3e7ff; background: var(--bg-selected); }
</style>
