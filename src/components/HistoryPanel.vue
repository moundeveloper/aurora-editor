<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { Check, History, RotateCcw } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import PanelHeader from '@/components/common/PanelHeader.vue'

defineEmits<{ close: [] }>()

const store = useEditorStore()
const { historyEntries } = storeToRefs(store)
const currentPosition = computed(() => historyEntries.value.find((entry) => entry.current)?.position ?? -1)

function stateFor(position: number) {
  if (position === currentPosition.value) return 'current'
  return position < currentPosition.value ? 'past' : 'future'
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value)
}
</script>

<template>
  <aside class="history-panel" aria-label="Project history">
    <PanelHeader title="History" :subtitle="`${historyEntries.length} states`" closable @close="$emit('close')">
      <template #icon><History :size="13" /></template>
    </PanelHeader>

    <div class="history-scroll">
      <ol>
        <li v-for="(entry, index) in historyEntries" :key="entry.id">
          <div v-if="index === 0 || historyEntries[index - 1]?.workspace !== entry.workspace" class="workspace-label">
            {{ entry.workspace }} workspace
          </div>
          <button
            type="button"
            class="history-entry"
            :class="stateFor(entry.position)"
            :aria-current="entry.current ? 'step' : undefined"
            :title="`Restore “${entry.label}”`"
            @click="store.jumpToHistory(entry.id)"
          >
            <span class="state-icon"><Check v-if="entry.current" :size="10" /><RotateCcw v-else :size="9" /></span>
            <span class="entry-copy"><strong>{{ entry.label }}</strong><small>{{ formatTime(entry.createdAt) }}</small></span>
            <span v-if="entry.current" class="current-badge">Current</span>
          </button>
        </li>
      </ol>
    </div>
    <p class="history-hint">Select a state to move backward or forward without discarding later edits.</p>
  </aside>
</template>

<style scoped>
.history-panel { position: fixed; z-index: 40; right: 7px; bottom: 29px; display: flex; width: 286px; max-height: min(520px, calc(100vh - 76px)); flex-direction: column; overflow: hidden; background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: 4px; box-shadow: 0 12px 36px #0009; }
.history-panel :deep(.panel-heading > svg) { color: var(--accent); }
.history-scroll { min-height: 86px; flex: 1; overflow: auto; padding: 5px 0; }
ol { margin: 0; padding: 0; list-style: none; }
.workspace-label { height: 20px; padding: 5px 10px 2px 28px; color: var(--text-muted); font-size: 7.5px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; }
.history-entry { position: relative; display: grid; width: 100%; min-height: 32px; grid-template-columns: 19px minmax(0, 1fr) auto; align-items: center; gap: 5px; padding: 3px 8px; color: var(--text-secondary); text-align: left; background: transparent; border: 0; font: inherit; cursor: pointer; }
.history-entry::before { position: absolute; top: -7px; bottom: 19px; left: 17px; width: 1px; background: var(--border-subtle); content: ''; }
.history-entry:hover { color: var(--text-primary); background: var(--bg-hover); }
.history-entry.future { opacity: .58; }
.history-entry.current { color: #e5e0ff; background: #7166d326; }
.history-entry.current::after { position: absolute; inset: 0 auto 0 0; width: 2px; background: var(--accent); content: ''; }
.state-icon { z-index: 1; display: grid; width: 12px; height: 12px; place-items: center; color: var(--text-muted); background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: 50%; }
.current .state-icon { color: #fff; background: var(--accent); border-color: var(--accent); }
.entry-copy { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.entry-copy strong { overflow: hidden; font-size: 9px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.entry-copy small { color: var(--text-muted); font-size: 7.5px; }
.current-badge { padding: 2px 4px; color: #dcd6ff; background: #7166d333; border: 1px solid #7166d366; border-radius: 2px; font-size: 7px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
.history-hint { margin: 0; padding: 6px 9px; color: var(--text-muted); background: var(--bg-panel-alt); border-top: 1px solid var(--border-subtle); font-size: 7.5px; line-height: 1.4; }
</style>
