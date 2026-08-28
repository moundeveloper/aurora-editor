<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Camera, ChevronDown, Circle, Eye, EyeOff, Layers3, Lightbulb, Lock, Pencil, Plus, Spline, Square, Sun, Trash2 } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { cameraIdAtTime } from '@/engine/scene3d/cameraCuts'
import PanelHeader from './common/PanelHeader.vue'
import MSelect, { type MSelectOption } from './common/MSelect.vue'
import MDialog from './common/MDialog.vue'

const store = useEditorStore()
const { layers, selectedLayerId, selectedScene, selectedSceneEntityId, currentTime } = storeToRefs(store)
/** The menu drops from whichever control opened it, so it is never detached from its trigger. */
const addMenu = ref<'header' | 'footer' | null>(null)
const contextMenu = ref<{ kind: 'layer' | 'entity'; id: string; x: number; y: number } | null>(null)
const dialog = ref<{ mode: 'rename' | 'delete'; kind: 'layer' | 'entity'; id: string; name: string } | null>(null)
const renameValue = ref('')
const sections = ref({ cameras: true, objects: true, lights: true, paths: true })
const scenePaths = computed(() => selectedScene.value?.paths ?? [])
const entityCount = computed(() => (selectedScene.value?.objects.length ?? 0) + (selectedScene.value?.cameras.length ?? 0) + (selectedScene.value?.lights.length ?? 0) + scenePaths.value.length)
const programCameraId = computed(() => selectedScene.value ? cameraIdAtTime(selectedScene.value, currentTime.value) : null)
const sceneLayerOptions = computed<MSelectOption[]>(() => layers.value
  .filter((layer) => layer.type === '3d-scene' && layer.sceneId)
  .map((layer) => ({ value: layer.id, label: layer.name })))
const selected3DLayerId = computed({
  get: () => {
    const selected = layers.value.find((layer) => layer.id === selectedLayerId.value && layer.type === '3d-scene')
    return selected?.id ?? layers.value.find((layer) => layer.type === '3d-scene' && layer.sceneId === selectedScene.value?.id)?.id ?? ''
  },
  set: (layerId: string) => store.select3DLayer(layerId),
})
const selected3DLayer = computed(() => layers.value.find((layer) => layer.id === selected3DLayerId.value) ?? null)

function select(id: string) {
  if (selectedScene.value) store.selectSceneEntity(selectedScene.value.id, id)
}

function toggleAddMenu(anchor: 'header' | 'footer') {
  addMenu.value = addMenu.value === anchor ? null : anchor
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (addMenu.value && !target?.closest('.add-menu, .add-menu-trigger')) addMenu.value = null
  if (contextMenu.value && !target?.closest('.scene-context-menu')) contextMenu.value = null
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    addMenu.value = null
    contextMenu.value = null
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})

function entityById(id: string) {
  const scene = selectedScene.value
  return scene ? [...scene.objects, ...scene.cameras, ...scene.lights, ...scenePaths.value].find((item) => item.id === id) : null
}

function toggleVisible(id: string) {
  const entity = entityById(id)
  if (entity) store.set3DEntityVisible(id, !entity.visible)
}

function toggleLayerVisible() {
  const layer = selected3DLayer.value
  if (layer) store.setTimelineLayersVisible([layer.id], !layer.visible)
}

function openContextMenu(event: MouseEvent, kind: 'layer' | 'entity', id: string) {
  event.preventDefault()
  select(kind === 'entity' ? id : selectedSceneEntityId.value)
  contextMenu.value = {
    kind,
    id,
    x: Math.min(event.clientX, window.innerWidth - 174),
    y: Math.min(event.clientY, window.innerHeight - 96),
  }
}

function contextTarget() {
  const menu = contextMenu.value
  if (!menu) return null
  return menu.kind === 'layer' ? selected3DLayer.value : entityById(menu.id)
}

function renameContextTarget() {
  const menu = contextMenu.value
  const target = contextTarget()
  if (!menu || !target) return
  contextMenu.value = null
  renameValue.value = target.name
  dialog.value = { mode: 'rename', kind: menu.kind, id: menu.id, name: target.name }
}

function toggleContextTarget() {
  const menu = contextMenu.value
  const target = contextTarget()
  if (!menu || !target) return
  if (menu.kind === 'layer') store.setTimelineLayersVisible([menu.id], !target.visible)
  else store.set3DEntityVisible(menu.id, !target.visible)
  contextMenu.value = null
}

function deleteContextTarget() {
  const menu = contextMenu.value
  const target = contextTarget()
  if (!menu || !target) return
  contextMenu.value = null
  dialog.value = { mode: 'delete', kind: menu.kind, id: menu.id, name: target.name }
}

function confirmDialog() {
  const target = dialog.value
  if (!target) return
  if (target.mode === 'rename') {
    if (target.kind === 'layer') store.renameTimelineLayers([target.id], renameValue.value)
    else store.rename3DEntity(target.id, renameValue.value)
  } else if (target.kind === 'layer') store.deleteTimelineLayers([target.id])
  else store.delete3DEntity(target.id)
  dialog.value = null
}
</script>

<template>
  <aside class="hierarchy-panel">
    <PanelHeader title="Scene" :subtitle="`${entityCount} entities`">
      <template #icon><Box :size="13" /></template>
      <template #actions><button class="header-action add-menu-trigger" type="button" title="Add 3D entity" @click="toggleAddMenu('header')"><Plus :size="13" /></button></template>
    </PanelHeader>
    <div class="scene-layer-picker"><Layers3 :size="11" /><MSelect v-model="selected3DLayerId" :options="sceneLayerOptions" label="3D layer to edit" /><button type="button" :class="{ off: !selected3DLayer?.visible }" :title="selected3DLayer?.visible ? 'Hide 3D layer' : 'Show 3D layer'" @click="toggleLayerVisible"><Eye v-if="selected3DLayer?.visible" :size="10" /><EyeOff v-else :size="10" /></button></div>
    <div class="scene-root" :class="{ muted: !selected3DLayer?.visible }" @contextmenu="openContextMenu($event, 'layer', selected3DLayerId)"><ChevronDown :size="11" /><Box :size="12" /><strong :title="selectedScene?.name">{{ selectedScene?.name }}</strong><small>Right-click for actions</small></div>

    <div class="hierarchy-scroll">
      <section>
        <button class="section-row" type="button" @click="sections.cameras = !sections.cameras"><ChevronDown :size="10" :class="{ closed: !sections.cameras }" /><Camera :size="11" /><span>Cameras</span><small>{{ selectedScene?.cameras.length ?? 0 }}</small></button>
        <template v-if="sections.cameras">
          <div v-for="camera in selectedScene?.cameras" :key="camera.id" class="entity-row" :class="{ active: selectedSceneEntityId === camera.id, muted: !camera.visible }" :title="camera.name" role="button" tabindex="0" @click="select(camera.id)" @keydown.enter="select(camera.id)" @contextmenu="openContextMenu($event, 'entity', camera.id)"><button class="visibility" type="button" :title="camera.visible ? 'Hide camera in viewport' : 'Show camera in viewport'" @click.stop="toggleVisible(camera.id)"><Eye v-if="camera.visible" :size="10" /><EyeOff v-else :size="10" /></button><Camera :size="11" /><span>{{ camera.name }}</span><small v-if="programCameraId === camera.id">LIVE</small></div>
        </template>
      </section>
      <section>
        <button class="section-row" type="button" @click="sections.objects = !sections.objects"><ChevronDown :size="10" :class="{ closed: !sections.objects }" /><Square :size="11" /><span>Objects</span><small>{{ selectedScene?.objects.length ?? 0 }}</small></button>
        <template v-if="sections.objects">
          <div v-for="object in selectedScene?.objects" :key="object.id" class="entity-row" :class="{ active: selectedSceneEntityId === object.id, muted: !object.visible }" :title="object.name" role="button" tabindex="0" @click="select(object.id)" @keydown.enter="select(object.id)" @contextmenu="openContextMenu($event, 'entity', object.id)">
            <button class="visibility" type="button" :title="object.visible ? 'Hide object' : 'Show object'" @click.stop="toggleVisible(object.id)"><Eye v-if="object.visible" :size="10" /><EyeOff v-else :size="10" /></button>
            <component :is="object.primitive === 'sphere' ? Circle : object.primitive === 'plane' ? Square : Box" :size="11" />
            <span>{{ object.name }}</span><Lock v-if="object.locked" :size="9" />
          </div>
        </template>
      </section>
      <section>
        <button class="section-row" type="button" @click="sections.lights = !sections.lights"><ChevronDown :size="10" :class="{ closed: !sections.lights }" /><Sun :size="11" /><span>Lights</span><small>{{ selectedScene?.lights.length ?? 0 }}</small></button>
        <template v-if="sections.lights">
          <div v-for="light in selectedScene?.lights" :key="light.id" class="entity-row" :class="{ active: selectedSceneEntityId === light.id, muted: !light.visible }" :title="light.name" role="button" tabindex="0" @click="select(light.id)" @keydown.enter="select(light.id)" @contextmenu="openContextMenu($event, 'entity', light.id)"><button class="visibility" type="button" :title="light.visible ? 'Hide light in viewport' : 'Show light in viewport'" @click.stop="toggleVisible(light.id)"><Eye v-if="light.visible" :size="10" /><EyeOff v-else :size="10" /></button><Lightbulb :size="11" :style="{ color: light.color }" /><span>{{ light.name }}</span><small>{{ light.type }}</small></div>
        </template>
      </section>
      <section>
        <button class="section-row" type="button" @click="sections.paths = !sections.paths"><ChevronDown :size="10" :class="{ closed: !sections.paths }" /><Spline :size="11" /><span>Paths</span><small>{{ scenePaths.length }}</small></button>
        <template v-if="sections.paths">
          <div v-for="path in scenePaths" :key="path.id" class="entity-row" :class="{ active: selectedSceneEntityId === path.id, muted: !path.visible }" :title="path.name" role="button" tabindex="0" @click="select(path.id)" @keydown.enter="select(path.id)" @contextmenu="openContextMenu($event, 'entity', path.id)"><button class="visibility" type="button" :title="path.visible ? 'Hide path in viewport' : 'Show path in viewport'" @click.stop="toggleVisible(path.id)"><Eye v-if="path.visible" :size="10" /><EyeOff v-else :size="10" /></button><Spline :size="11" :style="{ color: path.color }" /><span>{{ path.name }}</span><Lock v-if="path.locked" :size="9" /><small>{{ path.points.length }} pts</small></div>
        </template>
      </section>
    </div>

    <div v-if="addMenu" class="add-menu" :class="addMenu">
      <strong>Add to scene</strong>
      <button type="button" @click="store.add3DPrimitive('box'); addMenu = null"><Box :size="12" /> Cube</button>
      <button type="button" @click="store.add3DPrimitive('sphere'); addMenu = null"><Circle :size="12" /> Sphere</button>
      <button type="button" @click="store.add3DCamera(); addMenu = null"><Camera :size="12" /> Camera</button>
      <button type="button" @click="store.add3DPath(); addMenu = null"><Spline :size="12" /> Bézier path</button>
      <button type="button" @click="store.add3DLight('directional'); addMenu = null"><Sun :size="12" /> Directional light</button>
      <button type="button" @click="store.add3DLight('point'); addMenu = null"><Lightbulb :size="12" /> Point light</button>
    </div>
    <footer><button class="add-menu-trigger" type="button" @click="toggleAddMenu('footer')"><Plus :size="11" /> Add entity</button></footer>
    <Teleport to="body">
      <div v-if="contextMenu" class="scene-context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" role="menu" @contextmenu.prevent>
        <button type="button" role="menuitem" @click="renameContextTarget"><Pencil :size="11" /> Rename</button>
        <button type="button" role="menuitem" @click="toggleContextTarget"><EyeOff v-if="contextTarget()?.visible" :size="11" /><Eye v-else :size="11" /> {{ contextTarget()?.visible ? 'Hide' : 'Show' }}</button>
        <span />
        <button type="button" class="danger" role="menuitem" :disabled="contextMenu.kind === 'entity' && selectedScene?.cameras.length === 1 && selectedScene.cameras[0]?.id === contextMenu.id" @click="deleteContextTarget"><Trash2 :size="11" /> Delete</button>
      </div>
    </Teleport>
    <MDialog
      :open="Boolean(dialog)"
      :title="dialog?.mode === 'rename' ? `Rename ${dialog.kind === 'layer' ? '3D layer' : 'entity'}` : `Delete ${dialog?.kind === 'layer' ? '3D layer' : 'entity'}`"
      :description="dialog?.mode === 'delete' ? `“${dialog.name}” will be removed from this project.` : 'Choose a clear name for the selected item.'"
      :confirm-label="dialog?.mode === 'delete' ? 'Delete' : 'Rename'"
      :danger="dialog?.mode === 'delete'"
      :confirm-disabled="dialog?.mode === 'rename' && !renameValue.trim()"
      @close="dialog = null"
      @confirm="confirmDialog"
    >
      <input v-if="dialog?.mode === 'rename'" v-model="renameValue" autofocus aria-label="New name" @focus="($event.target as HTMLInputElement).select()" />
      <p v-else class="dialog-warning">This action cannot be undone.</p>
    </MDialog>
  </aside>
</template>

<style scoped>
.hierarchy-panel { position: relative; display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); }.header-action { display: grid; width: 22px; height: 22px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }.header-action:hover { color: var(--text-primary); background: var(--bg-hover); }.scene-root { display: flex; height: 31px; flex: 0 0 auto; align-items: center; gap: 5px; padding: 0 7px; color: #cdd5ff; background: #171a24; border-bottom: 1px solid var(--border-subtle); }.scene-root.muted { opacity: .5; }.scene-root strong { min-width: 0; flex: 1; overflow: hidden; font-size: 9.5px; font-weight: 570; text-overflow: ellipsis; white-space: nowrap; }.scene-root small { color: var(--text-muted); font-size: 6.5px; white-space: nowrap; }.hierarchy-scroll { min-height: 0; flex: 1; padding: 4px; overflow: auto; }.hierarchy-scroll section { margin-bottom: 2px; }.section-row, .entity-row { display: flex; width: 100%; height: 25px; min-width: 0; align-items: center; gap: 5px; padding: 0 5px; color: var(--text-secondary); text-align: left; background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; cursor: pointer; }.section-row { color: #9298a6; font-size: 8px; font-weight: 650; letter-spacing: .045em; text-transform: uppercase; }.section-row:hover, .entity-row:hover { background: var(--bg-hover); }.section-row svg.closed { transform: rotate(-90deg); }.section-row span, .entity-row span:nth-last-of-type(1) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.section-row small, .entity-row small { margin-left: auto; color: var(--text-muted); font-size: 7px; font-weight: 500; letter-spacing: 0; text-transform: none; }.entity-row { height: 26px; padding-left: 6px; font-size: 9px; }.entity-row.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.entity-row.muted { opacity: .48; }.visibility { display: grid; width: 14px; height: 18px; flex: 0 0 14px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.visibility:hover { color: var(--text-primary); background: var(--bg-hover); }.add-menu { position: absolute; z-index: 8; display: grid; padding: 5px; background: #1a1d24; border: 1px solid #444a58; border-radius: 4px; box-shadow: 0 10px 24px rgb(0 0 0 / .48); }.add-menu.header { top: 33px; right: 6px; min-width: 168px; }.add-menu.footer { right: 6px; bottom: 35px; left: 6px; }.add-menu strong { padding: 4px 5px 6px; color: var(--text-muted); font-size: 7.5px; letter-spacing: .07em; text-transform: uppercase; }.add-menu button { display: flex; height: 26px; align-items: center; gap: 6px; padding: 0 6px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: 9px; cursor: pointer; }.add-menu button:hover { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.hierarchy-panel > footer { display: flex; height: 34px; flex: 0 0 auto; align-items: center; padding: 4px 6px; border-top: 1px solid var(--border-subtle); }.hierarchy-panel > footer button { display: flex; width: 100%; height: 25px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: #181a20; border: 1px dashed #3a3e49; border-radius: 3px; font: inherit; font-size: 9px; cursor: pointer; }.hierarchy-panel > footer button:hover { color: var(--text-primary); border-color: var(--accent-border); }
.scene-layer-picker { display: grid; height: 34px; flex: 0 0 auto; grid-template-columns: 15px minmax(0, 1fr) 18px; align-items: center; gap: 4px; padding: 4px 6px; background: #12151c; border-bottom: 1px solid var(--border-subtle); }.scene-layer-picker > svg { color: #8c9bff; }.scene-layer-picker > button { display: grid; width: 18px; height: 22px; place-items: center; padding: 0; color: var(--text-secondary); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }.scene-layer-picker > button:hover { color: var(--text-primary); background: var(--bg-hover); }.scene-layer-picker > button.off { color: var(--text-muted); opacity: .6; }
:global(.scene-context-menu) { position: fixed; z-index: 600; display: grid; width: 164px; padding: 4px; background: #171920; border: 1px solid #3b3f4b; border-radius: 4px; box-shadow: 0 10px 26px rgb(0 0 0 / .5); }
:global(.scene-context-menu > button) { display: flex; height: 26px; align-items: center; gap: 7px; padding: 0 7px; color: #aeb3bf; background: transparent; border: 0; border-radius: 3px; font: inherit; font-size: 9px; text-align: left; cursor: pointer; }
:global(.scene-context-menu > button:hover:not(:disabled)) { color: #eef0ff; background: var(--bg-selected); }
:global(.scene-context-menu > button.danger) { color: #d88991; }
:global(.scene-context-menu > button:disabled) { opacity: .35; cursor: default; }
:global(.scene-context-menu > span) { height: 1px; margin: 3px 2px; background: var(--border-subtle); }
.dialog-warning { margin: 0; color: var(--text-secondary); font-size: 9px; }
</style>
