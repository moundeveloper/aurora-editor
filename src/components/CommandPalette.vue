<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CornerDownLeft, Keyboard, RotateCcw, Search, X } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import type { WorkspaceId } from '@/models/editor'
import { assignShortcut, matchesShortcut, shortcutFromEvent, type CommandShortcutMap } from '@/services/keymap'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'toggle-panel': [panel: 'left' | 'right' | 'bottom' | 'history']
}>()

interface CommandItem {
  id: string
  label: string
  group: string
  keywords?: string
  shortcut?: string
  disabled?: boolean
  run: () => unknown | Promise<unknown>
}

const STORAGE_KEY = 'aurora-command-shortcuts-v1'
const store = useEditorStore()
const query = ref('')
const selectedIndex = ref(0)
const input = ref<HTMLInputElement | null>(null)
const editingShortcuts = ref(false)
const recordingId = ref<string | null>(null)
const savedShortcuts = ref<CommandShortcutMap>({})

const defaults: CommandShortcutMap = {
  palette: 'Ctrl+K', undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z', play: 'Space',
  previousFrame: 'ArrowLeft', nextFrame: 'ArrowRight', split: 'Ctrl+B', save: 'Ctrl+S',
  motion: 'Ctrl+Shift+1', nodes: 'Ctrl+Shift+2', threeD: 'Ctrl+Shift+3', audio: 'Ctrl+Shift+4', export: 'Ctrl+Shift+5',
}

function shortcut(id: string) {
  return savedShortcuts.value[id] ?? defaults[id] ?? ''
}

const commands = computed<CommandItem[]>(() => {
  const workspaceCommands: Array<[string, WorkspaceId]> = [
    ['motion', 'Motion'], ['nodes', 'Nodes'], ['threeD', '3D'], ['audio', 'Audio'], ['export', 'Export'],
  ]
  return [
    { id: 'palette', label: 'Open command palette', group: 'Window', keywords: 'search actions', shortcut: shortcut('palette'), run: () => emit('update:open', true) },
    { id: 'undo', label: 'Undo', group: 'Edit', shortcut: shortcut('undo'), disabled: !store.canUndo, run: () => store.undo() },
    { id: 'redo', label: 'Redo', group: 'Edit', shortcut: shortcut('redo'), disabled: !store.canRedo, run: () => store.redo() },
    { id: 'split', label: 'Split selected layer', group: 'Edit', keywords: 'cut clip', shortcut: shortcut('split'), disabled: !store.selectedLayer, run: () => store.splitSelectedLayer() },
    { id: 'play', label: store.playing ? 'Pause playback' : 'Start playback', group: 'Playback', keywords: 'space stop', shortcut: shortcut('play'), run: () => store.togglePlayback() },
    { id: 'previousFrame', label: 'Previous frame', group: 'Playback', shortcut: shortcut('previousFrame'), run: () => store.stepFrame(-1) },
    { id: 'nextFrame', label: 'Next frame', group: 'Playback', shortcut: shortcut('nextFrame'), run: () => store.stepFrame(1) },
    { id: 'save', label: 'Save project', group: 'Project', shortcut: shortcut('save'), run: () => store.saveProjectNow() },
    { id: 'addText', label: 'Add text layer', group: 'Layer', keywords: 'title typography', run: () => store.addTimelineLayer('text') },
    { id: 'addRectangle', label: 'Add rectangle layer', group: 'Layer', keywords: 'shape solid', run: () => store.addTimelineLayer('rectangle') },
    { id: 'addAdjustment', label: 'Add adjustment layer', group: 'Layer', keywords: 'effect grade', run: () => store.addTimelineLayer('adjustment') },
    ...workspaceCommands.map(([id, workspace]) => ({ id, label: `Switch to ${workspace}`, group: 'Workspace', shortcut: shortcut(id), run: () => store.setWorkspace(workspace) })),
    ...(['left', 'right', 'bottom', 'history'] as const).map((panel) => ({ id: `panel-${panel}`, label: `Toggle ${panel === 'bottom' ? 'timeline' : panel} panel`, group: 'Window', run: () => emit('toggle-panel', panel) })),
  ]
})

const filtered = computed(() => {
  const terms = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return commands.value
  return commands.value.filter((command) => {
    const haystack = `${command.label} ${command.group} ${command.keywords ?? ''}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
})

function close() {
  editingShortcuts.value = false
  recordingId.value = null
  emit('update:open', false)
}

async function run(command: CommandItem) {
  if (command.disabled) return
  close()
  await command.run()
}

function resetShortcuts() {
  savedShortcuts.value = {}
  window.localStorage.removeItem(STORAGE_KEY)
}

function persistShortcuts() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedShortcuts.value))
}

function onKeydown(event: KeyboardEvent) {
  if (recordingId.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') { recordingId.value = null; return }
    const captured = shortcutFromEvent(event)
    if (!captured) return
    savedShortcuts.value = assignShortcut({ ...defaults, ...savedShortcuts.value }, recordingId.value, captured)
    persistShortcuts()
    recordingId.value = null
    return
  }

  if (!props.open) {
    if ((event.target as Element | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
    const paletteShortcut = shortcut('palette')
    if (matchesShortcut(event, paletteShortcut)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      emit('update:open', true)
      return
    }
    const command = commands.value.find((item) => item.shortcut && matchesShortcut(event, item.shortcut))
    if (!command || command.disabled) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void command.run()
    return
  }

  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (editingShortcuts.value) return
  if (event.key === 'ArrowDown') { event.preventDefault(); selectedIndex.value = Math.min(filtered.value.length - 1, selectedIndex.value + 1) }
  if (event.key === 'ArrowUp') { event.preventDefault(); selectedIndex.value = Math.max(0, selectedIndex.value - 1) }
  if (event.key === 'Enter') { event.preventDefault(); const command = filtered.value[selectedIndex.value]; if (command) void run(command) }
}

watch(() => props.open, async (open) => {
  if (!open) return
  query.value = ''
  selectedIndex.value = 0
  await nextTick()
  input.value?.focus()
})
watch(query, () => { selectedIndex.value = 0 })

onMounted(() => {
  try { savedShortcuts.value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as CommandShortcutMap } catch { savedShortcuts.value = {} }
  window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette-backdrop" @pointerdown.self="close">
      <section class="command-palette" :class="{ 'editing-shortcuts': editingShortcuts }" role="dialog" aria-modal="true" aria-label="Command palette">
        <header class="search-row">
          <Search :size="15" />
          <input ref="input" v-model="query" type="search" placeholder="Search commands…" aria-label="Search commands" />
          <button type="button" :class="{ active: editingShortcuts }" title="Edit shortcuts" @click="editingShortcuts = !editingShortcuts"><Keyboard :size="14" /></button>
          <button type="button" title="Close command palette" @click="close"><X :size="14" /></button>
        </header>

        <div v-if="editingShortcuts" class="shortcut-editor">
          <div class="shortcut-heading"><span>Keyboard shortcuts</span><button type="button" @click="resetShortcuts"><RotateCcw :size="11" /> Reset defaults</button></div>
          <div class="shortcut-list">
            <div v-for="command in commands.filter((item) => item.shortcut || defaults[item.id])" :key="command.id" class="shortcut-row">
              <span><strong>{{ command.label }}</strong><small>{{ command.group }}</small></span>
              <button type="button" :class="{ recording: recordingId === command.id }" @click="recordingId = command.id">
                {{ recordingId === command.id ? 'Press keys…' : (command.shortcut || 'Unassigned') }}
              </button>
            </div>
          </div>
        </div>

        <div v-else class="command-list" role="listbox">
          <template v-for="(command, index) in filtered" :key="command.id">
            <div v-if="index === 0 || filtered[index - 1]?.group !== command.group" class="command-group">{{ command.group }}</div>
            <button type="button" role="option" :aria-selected="index === selectedIndex" :disabled="command.disabled" :class="{ selected: index === selectedIndex }" @pointerenter="selectedIndex = index" @click="run(command)">
              <span>{{ command.label }}</span><kbd v-if="command.shortcut">{{ command.shortcut }}</kbd>
            </button>
          </template>
          <p v-if="!filtered.length" class="empty">No commands match “{{ query }}”.</p>
        </div>
        <footer><span><kbd>↑↓</kbd> Navigate</span><span><CornerDownLeft :size="10" /> Run</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-backdrop { position: fixed; z-index: 100; inset: 0; display: grid; place-items: start center; padding-top: min(15vh, 130px); background: #05060a99; backdrop-filter: blur(2px); }
.command-palette { display: flex; width: min(520px, calc(100vw - 32px)); max-height: min(570px, calc(100vh - 80px)); flex-direction: column; overflow: hidden; color: var(--text-secondary); background: #15171d; border: 1px solid #51586d; border-radius: 6px; box-shadow: 0 22px 70px #000c; }
.search-row { display: grid; height: 43px; flex: 0 0 auto; grid-template-columns: 18px 1fr 27px 27px; align-items: center; gap: 5px; padding: 0 8px 0 12px; color: var(--accent); border-bottom: 1px solid var(--border-strong); }
.search-row input { min-width: 0; height: 100%; padding: 0 4px; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 12px; }
.search-row input::placeholder { color: var(--text-muted); }
.search-row button { display: grid; width: 25px; height: 25px; place-items: center; color: var(--text-muted); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }
.search-row button:hover, .search-row button.active { color: var(--text-primary); background: var(--bg-hover); }
.command-list, .shortcut-list { min-height: 80px; flex: 1; overflow: auto; padding: 5px; }
.command-group { height: 22px; padding: 7px 7px 2px; color: var(--text-muted); font-size: 7.5px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
.command-list > button { display: grid; width: 100%; height: 31px; grid-template-columns: 1fr auto; align-items: center; padding: 0 8px; color: var(--text-secondary); text-align: left; background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: 10px; cursor: pointer; }
.command-list > button.selected { color: var(--text-primary); background: #7166d326; border-color: #7166d34d; }
.command-list > button:disabled { opacity: .35; cursor: default; }
kbd { min-width: 22px; padding: 2px 5px; color: var(--text-muted); text-align: center; background: #0d0f14; border: 1px solid var(--border-strong); border-bottom-color: #5c6270; border-radius: 3px; font: inherit; font-size: 7.5px; }
.empty { padding: 28px; color: var(--text-muted); font-size: 9px; text-align: center; }
.shortcut-editor { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.shortcut-heading { display: flex; height: 31px; flex: 0 0 auto; align-items: center; justify-content: space-between; padding: 0 10px; border-bottom: 1px solid var(--border-subtle); font-size: 9px; font-weight: 650; text-transform: uppercase; }
.shortcut-heading button { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); background: transparent; border: 0; font: inherit; font-size: 8px; cursor: pointer; }
.shortcut-row { display: grid; min-height: 37px; grid-template-columns: 1fr 112px; align-items: center; gap: 8px; padding: 3px 6px; border-bottom: 1px solid var(--border-subtle); }
.shortcut-row > span { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.shortcut-row strong { color: var(--text-secondary); font-size: 9px; font-weight: 500; }.shortcut-row small { color: var(--text-muted); font-size: 7.5px; }
.shortcut-row button { height: 24px; color: var(--text-secondary); background: #0f1117; border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 8px; cursor: pointer; }.shortcut-row button.recording { color: #e0dcff; border-color: var(--accent); background: #7166d326; }
footer { display: flex; height: 27px; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 13px; padding: 0 9px; color: var(--text-muted); background: var(--bg-panel-alt); border-top: 1px solid var(--border-subtle); font-size: 7.5px; }
footer span { display: flex; align-items: center; gap: 4px; }
</style>
