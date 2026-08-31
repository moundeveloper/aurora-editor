<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { Clock3, Film, FolderOpen, Plus, Search } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import MSelect, { type MSelectOption } from './common/MSelect.vue'

const store = useEditorStore()
const { availableProjects, project, projectBrowserBusy, projectBrowserError } = storeToRefs(store)
const router = useRouter()
const query = ref('')
const selectedProjectId = ref(project.value.id)
const name = ref('Untitled Project')
const resolution = ref('1920x1080')
const width = ref(1920)
const height = ref(1080)
const frameRate = ref('30')

const resolutionOptions: MSelectOption[] = [
  { value: '3840x2160', label: 'UHD 4K · 3840 × 2160' },
  { value: '2560x1440', label: 'QHD · 2560 × 1440' },
  { value: '1920x1080', label: 'Full HD · 1920 × 1080' },
  { value: '1280x720', label: 'HD · 1280 × 720' },
  { value: '1080x1920', label: 'Vertical · 1080 × 1920' },
  { value: '1080x1080', label: 'Square · 1080 × 1080' },
  { value: 'custom', label: 'Custom resolution' },
]
const frameRateOptions: MSelectOption[] = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]
  .map((value) => ({ value: String(value), label: `${value} fps` }))

const filteredProjects = computed(() => {
  const term = query.value.trim().toLowerCase()
  return term ? availableProjects.value.filter((item) => item.name.toLowerCase().includes(term)) : availableProjects.value
})

function selectResolution(value: string) {
  resolution.value = value
  if (value === 'custom') return
  const [nextWidth, nextHeight] = value.split('x').map(Number)
  if (nextWidth && nextHeight) {
    width.value = nextWidth
    height.value = nextHeight
  }
}

function useCustomResolution() {
  resolution.value = 'custom'
}

async function createProject() {
  if (await store.createEmptyProject({ name: name.value, width: width.value, height: height.value, frameRate: Number(frameRate.value) })) {
    await router.push(`/projects/${store.project.id}`)
  }
}

async function openProject(projectId = selectedProjectId.value) {
  selectedProjectId.value = projectId
  if (await store.openProject(projectId)) await router.push(`/projects/${projectId}`)
}

function formatUpdatedAt(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

</script>

<template>
  <main class="project-browser">
    <header class="browser-header">
      <div class="brand-mark">A</div>
      <span><strong>Aurora Editor</strong><small>Local project library</small></span>
    </header>

    <div class="browser-body">
      <section class="project-library" aria-labelledby="project-library-title">
        <div class="section-heading">
          <span><strong id="project-library-title">Projects</strong><small>{{ availableProjects.length }} saved locally</small></span>
          <label class="project-search"><Search :size="13" /><input v-model="query" type="search" placeholder="Search projects…" autofocus /></label>
        </div>

        <div class="project-list">
          <article v-for="item in filteredProjects" :key="item.id" class="project-row" :class="{ active: item.id === selectedProjectId }" role="button" tabindex="0" @click="selectedProjectId = item.id" @keydown.enter="selectedProjectId = item.id" @dblclick="openProject(item.id)">
            <span class="project-icon"><Film :size="16" /></span>
            <span class="project-details">
              <strong :title="item.name">{{ item.name }}</strong>
              <small>{{ item.width }} × {{ item.height }} · {{ item.frameRate }} fps · {{ item.duration.toFixed(1) }}s</small>
            </span>
            <span class="project-updated"><Clock3 :size="10" /> {{ formatUpdatedAt(item.updatedAt) }}</span>
            <button type="button" :disabled="projectBrowserBusy" @click.stop="openProject(item.id)"><FolderOpen :size="11" /> Open</button>
          </article>

          <div v-if="!filteredProjects.length" class="empty-projects">
            <Search v-if="query" :size="22" /><FolderOpen v-else :size="22" />
            <strong>{{ query ? 'No matching projects' : 'No projects yet' }}</strong>
            <span>{{ query ? 'Try a different project name.' : 'Create an empty project using the settings on the right.' }}</span>
          </div>
        </div>
      </section>

      <aside class="new-project-panel" aria-labelledby="new-project-title">
        <div class="panel-heading"><span class="new-icon"><Plus :size="15" /></span><span><strong id="new-project-title">New empty project</strong><small>Start with a blank timeline and node output.</small></span></div>
        <form @submit.prevent="createProject">
          <label><span>Name</span><input v-model="name" maxlength="120" required @focus="($event.target as HTMLInputElement).select()" /></label>
          <label><span>Resolution</span><MSelect :model-value="resolution" :options="resolutionOptions" label="Project resolution" @update:model-value="selectResolution" /></label>
          <div class="dimension-fields">
            <label><span>Width</span><input v-model.number="width" type="number" min="16" max="16384" step="1" @input="useCustomResolution" /></label>
            <span>×</span>
            <label><span>Height</span><input v-model.number="height" type="number" min="16" max="16384" step="1" @input="useCustomResolution" /></label>
          </div>
          <label><span>Frame rate</span><MSelect v-model="frameRate" :options="frameRateOptions" label="Project frame rate" /></label>
          <div class="format-summary"><Film :size="12" /><span><strong>{{ width }} × {{ height }}</strong><small>{{ frameRate }} frames per second</small></span></div>
          <p v-if="projectBrowserError" class="browser-error">{{ projectBrowserError }}</p>
          <button class="create-button" type="submit" :disabled="projectBrowserBusy || !name.trim()"><Plus :size="12" /> {{ projectBrowserBusy ? 'Working…' : 'Create project' }}</button>
        </form>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.project-browser { display: grid; width: 100%; height: 100%; min-width: 760px; grid-template-rows: 46px minmax(0, 1fr); overflow: hidden; color: var(--text-primary); background: var(--bg-app); }
.browser-header { display: flex; align-items: center; gap: 9px; padding: 0 14px; background: #12141a; border-bottom: 1px solid var(--border-subtle); }.brand-mark { display: grid; width: 27px; height: 27px; place-items: center; color: #cbd3ff; background: #232943; border: 1px solid #6e7ed0; border-radius: 5px; font-size: 13px; font-weight: 800; }.browser-header > span { display: flex; flex-direction: column; gap: 2px; }.browser-header strong { font-size: 11px; }.browser-header small { color: var(--text-muted); font-size: 8px; }
.browser-body { display: grid; min-height: 0; grid-template-columns: minmax(420px, 1fr) 310px; }.project-library { display: flex; min-width: 0; min-height: 0; flex-direction: column; }.section-heading { display: flex; min-height: 58px; align-items: center; gap: 16px; padding: 10px 14px; background: #0f1116; border-bottom: 1px solid var(--border-subtle); }.section-heading > span, .panel-heading > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 3px; }.section-heading strong, .panel-heading strong { font-size: 11px; }.section-heading small, .panel-heading small { color: var(--text-muted); font-size: 8.5px; }.project-search { display: flex; width: min(280px, 45%); height: 28px; margin-left: auto; align-items: center; gap: 6px; padding: 0 7px; color: var(--text-muted); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 4px; }.project-search:focus-within { border-color: var(--focus); box-shadow: 0 0 0 1px #424b70; }.project-search input { width: 100%; min-width: 0; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 9.5px; }
.project-list { min-height: 0; flex: 1; padding: 8px; overflow: auto; }.project-row { display: grid; min-height: 54px; grid-template-columns: 34px minmax(0, 1fr) auto 58px; align-items: center; gap: 8px; margin-bottom: 4px; padding: 6px 7px; color: var(--text-secondary); background: #121419; border: 1px solid var(--border-subtle); border-radius: 4px; cursor: default; }.project-row:hover { background: var(--bg-hover); border-color: var(--border-strong); }.project-row.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); outline: 1px solid var(--accent-border); outline-offset: -1px; }.project-row.active .project-icon { color: #cdd5ff; background: #293152; }.project-icon { display: grid; width: 31px; height: 31px; place-items: center; color: var(--accent); background: #202640; border-radius: 4px; }.project-details { display: flex; min-width: 0; flex-direction: column; gap: 4px; }.project-details strong, .project-details small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.project-details strong { color: var(--text-primary); font-size: 10px; font-weight: 580; }.project-details small, .project-updated { color: var(--text-muted); font-size: 8px; }.project-updated { display: flex; align-items: center; gap: 4px; white-space: nowrap; }.project-row > button { display: flex; height: 25px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: #1a1d24; border: 1px solid var(--border-strong); border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; white-space: nowrap; }.project-row > button:hover:not(:disabled) { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.project-row > button:disabled { opacity: .45; cursor: default; }.empty-projects { display: flex; min-height: 220px; align-items: center; justify-content: center; flex-direction: column; gap: 6px; color: var(--text-muted); text-align: center; }.empty-projects svg { color: var(--accent); }.empty-projects strong { color: var(--text-secondary); font-size: 10px; }.empty-projects span { font-size: 8.5px; }
.new-project-panel { min-height: 0; overflow: auto; background: var(--bg-panel); border-left: 1px solid var(--border-subtle); }.panel-heading { display: flex; min-height: 58px; align-items: center; gap: 8px; padding: 9px 12px; background: #15171d; border-bottom: 1px solid var(--border-subtle); }.new-icon { display: grid; width: 29px; height: 29px; flex: 0 0 auto; place-items: center; color: var(--accent); background: #252b45; border-radius: 4px; }.new-project-panel form { display: grid; gap: 10px; padding: 13px 12px; }.new-project-panel form > label, .dimension-fields label { display: grid; gap: 5px; color: var(--text-secondary); font-size: 8.5px; }.new-project-panel input { width: 100%; height: 28px; min-width: 0; padding: 0 7px; color: var(--text-primary); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; outline: 0; font: inherit; font-size: 9.5px; }.new-project-panel input:focus { border-color: var(--focus); }.dimension-fields { display: grid; grid-template-columns: 1fr 10px 1fr; align-items: end; gap: 5px; }.dimension-fields > span { height: 28px; color: var(--text-muted); font-size: 10px; line-height: 28px; text-align: center; }.format-summary { display: flex; align-items: center; gap: 7px; padding: 8px; color: var(--accent); background: #171a24; border: 1px solid #303650; border-radius: 3px; }.format-summary > span { display: flex; flex-direction: column; gap: 2px; }.format-summary strong { color: var(--text-secondary); font-size: 9px; }.format-summary small { color: var(--text-muted); font-size: 8px; }.browser-error { margin: 0; padding: 7px; color: #dc8f96; background: #24161a; border: 1px solid #563039; border-radius: 3px; font-size: 8.5px; }.create-button { display: flex; height: 31px; align-items: center; justify-content: center; gap: 5px; color: #10121a; background: var(--button-accent); border: 1px solid #a8b2ff; border-radius: 4px; font: inherit; font-size: 9.5px; font-weight: 650; cursor: pointer; white-space: nowrap; }.create-button:hover:not(:disabled) { background: var(--button-accent-hover); }.create-button:disabled { opacity: .5; cursor: default; }
@media (max-width: 900px) { .browser-body { grid-template-columns: minmax(380px, 1fr) 280px; }.project-updated { display: none; }.project-row { grid-template-columns: 34px minmax(0, 1fr) 58px; } }
</style>
