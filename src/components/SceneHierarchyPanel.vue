<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Camera, ChevronDown, Circle, Eye, EyeOff, Image as ImageIcon, Layers3, Lightbulb, Lock, Pencil, Plus, Spline, Square, Sun, Trash2, Ungroup } from '@lucide/vue'
import type { Aurora3DObject } from '@/models/editor'
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
const pickedObjectIds = ref<Set<string>>(new Set())
const collapsedGroupIds = ref<Set<string>>(new Set())
const scenePaths = computed(() => selectedScene.value?.paths ?? [])
const entityCount = computed(() => (selectedScene.value?.objects.length ?? 0) + (selectedScene.value?.cameras.length ?? 0) + (selectedScene.value?.lights.length ?? 0) + scenePaths.value.length)
const programCameraId = computed(() => selectedScene.value ? cameraIdAtTime(selectedScene.value, currentTime.value) : null)
interface ObjectTreeRow { object: Aurora3DObject; depth: number; hasChildren: boolean; effectiveVisible: boolean }
const objectRows = computed<ObjectTreeRow[]>(() => {
  const objects = selectedScene.value?.objects ?? []
  const byId = new Map(objects.map((object) => [object.id, object]))
  const children = new Map<string, Aurora3DObject[]>()
  objects.forEach((object) => {
    const parent = object.parentId ? byId.get(object.parentId) : undefined
    if (!parent || parent.type !== 'group') return
    const list = children.get(parent.id) ?? []
    list.push(object)
    children.set(parent.id, list)
  })
  const rows: ObjectTreeRow[] = []
  const visited = new Set<string>()
  const walk = (object: Aurora3DObject, depth: number, parentVisible = true) => {
    if (visited.has(object.id)) return
    visited.add(object.id)
    const nested = children.get(object.id) ?? []
    const effectiveVisible = parentVisible && object.visible
    rows.push({ object, depth, hasChildren: nested.length > 0, effectiveVisible })
    if (!collapsedGroupIds.value.has(object.id)) nested.forEach((child) => walk(child, depth + 1, effectiveVisible))
  }
  const roots = objects.filter((object) => !object.parentId || !byId.has(object.parentId) || byId.get(object.parentId)?.type !== 'group')
  // Collapsing a group must hide its subtree, so the orphan sweep below only covers objects that
  // no root can reach at all: parent cycles surviving an out-of-band edit.
  const reachable = new Set<string>()
  const markReachable = (object: Aurora3DObject) => {
    if (reachable.has(object.id)) return
    reachable.add(object.id)
    ;(children.get(object.id) ?? []).forEach(markReachable)
  }
  roots.forEach(markReachable)
  roots.forEach((object) => walk(object, 0))
  objects.filter((object) => !reachable.has(object.id)).forEach((object) => walk(object, 0))
  return rows
})
const pickedObjects = computed(() => (selectedScene.value?.objects ?? []).filter((object) => pickedObjectIds.value.has(object.id)))
const groupableCount = computed(() => pickedObjects.value.length)
/** Grouping keeps coordinates by sharing one parent space, so mixed parents need an explicit reparent first. */
const groupableRoots = computed(() => {
  const byId = new Map((selectedScene.value?.objects ?? []).map((object) => [object.id, object]))
  return pickedObjects.value.filter((object) => {
    const visited = new Set<string>()
    for (let parent = object.parentId ? byId.get(object.parentId) : undefined; parent; parent = parent.parentId ? byId.get(parent.parentId) : undefined) {
      if (visited.has(parent.id)) break
      visited.add(parent.id)
      if (pickedObjectIds.value.has(parent.id)) return false
    }
    return true
  })
})
const groupBlockedReason = computed(() => {
  if (groupableCount.value < 2) return 'Ctrl/Cmd-click at least two object rows first'
  if (new Set(groupableRoots.value.map((object) => object.parentId ?? '')).size > 1) return 'Selected objects sit under different parents · move them into one parent first'
  return ''
})
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

watch(selectedSceneEntityId, (id) => {
  if (pickedObjectIds.value.has(id)) return
  const object = selectedScene.value?.objects.find((item) => item.id === id)
  pickedObjectIds.value = object ? new Set([object.id]) : new Set()
})

function select(id: string) {
  if (!selectedScene.value) return
  if (!selectedScene.value.objects.some((object) => object.id === id)) pickedObjectIds.value = new Set()
  store.selectSceneEntity(selectedScene.value.id, id)
}

function selectObject(event: MouseEvent | KeyboardEvent, id: string) {
  const additive = event.ctrlKey || event.metaKey || event.shiftKey
  const next = additive ? new Set(pickedObjectIds.value) : new Set<string>()
  if (additive && next.has(id)) next.delete(id)
  else next.add(id)
  pickedObjectIds.value = next
  const active = next.has(id) ? id : [...next].at(-1)
  if (active && selectedScene.value) store.selectSceneEntity(selectedScene.value.id, active)
}

function toggleGroup(groupId: string) {
  const next = new Set(collapsedGroupIds.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  collapsedGroupIds.value = next
}

function addEmptyGroup() {
  const group = store.add3DGroup()
  if (group) pickedObjectIds.value = new Set([group.id])
  addMenu.value = null
}

function groupPickedObjects() {
  if (groupBlockedReason.value) return
  const group = store.add3DGroup([...pickedObjectIds.value])
  if (group) pickedObjectIds.value = new Set([group.id])
  addMenu.value = null
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
  const object = selectedScene.value?.objects.find((item) => item.id === id)
  if (kind === 'entity' && object) {
    if (!pickedObjectIds.value.has(id)) pickedObjectIds.value = new Set([id])
    select(id)
  } else select(kind === 'entity' ? id : selectedSceneEntityId.value)
  contextMenu.value = {
    kind,
    id,
    x: Math.min(event.clientX, window.innerWidth - 174),
    y: Math.min(event.clientY, window.innerHeight - 96),
  }
}

function ungroupContextTarget() {
  const target = contextTarget()
  if (!target || !('type' in target) || target.type !== 'group') return
  store.ungroup3DObject(target.id)
  pickedObjectIds.value = new Set()
  contextMenu.value = null
}

function contextTarget() {
  const menu = contextMenu.value
  if (!menu) return null
  return menu.kind === 'layer' ? selected3DLayer.value : entityById(menu.id)
}

function contextTargetIsGroup() {
  const target = contextTarget()
  return Boolean(target && 'type' in target && target.type === 'group')
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
      <template #actions><button class="header-action add-menu-trigger" type="button" title="Add 3D entity" :disabled="!selectedScene" @click="toggleAddMenu('header')"><Plus :size="13" /></button></template>
    </PanelHeader>
    <div v-if="selectedScene" class="scene-layer-picker"><Layers3 :size="11" /><MSelect v-model="selected3DLayerId" :options="sceneLayerOptions" label="3D layer to edit" /><button type="button" :class="{ off: !selected3DLayer?.visible }" :title="selected3DLayer?.visible ? 'Hide 3D layer' : 'Show 3D layer'" @click="toggleLayerVisible"><Eye v-if="selected3DLayer?.visible" :size="10" /><EyeOff v-else :size="10" /></button></div>
    <div v-if="selectedScene" class="scene-root" :class="{ muted: !selected3DLayer?.visible }" @contextmenu="openContextMenu($event, 'layer', selected3DLayerId)"><ChevronDown :size="11" /><Box :size="12" /><strong :title="selectedScene?.name">{{ selectedScene?.name }}</strong><small>Right-click for actions</small></div>

    <div v-if="selectedScene" class="hierarchy-scroll">
      <section>
        <button class="section-row" type="button" @click="sections.cameras = !sections.cameras"><ChevronDown :size="10" :class="{ closed: !sections.cameras }" /><Camera :size="11" /><span>Cameras</span><small>{{ selectedScene?.cameras.length ?? 0 }}</small></button>
        <template v-if="sections.cameras">
          <div v-for="camera in selectedScene?.cameras" :key="camera.id" class="entity-row" :class="{ active: selectedSceneEntityId === camera.id, muted: !camera.visible }" :title="camera.name" role="button" tabindex="0" @click="select(camera.id)" @keydown.enter="select(camera.id)" @contextmenu="openContextMenu($event, 'entity', camera.id)"><button class="visibility" type="button" :title="camera.visible ? 'Hide camera in viewport' : 'Show camera in viewport'" @click.stop="toggleVisible(camera.id)"><Eye v-if="camera.visible" :size="10" /><EyeOff v-else :size="10" /></button><Camera :size="11" /><span>{{ camera.name }}</span><small v-if="programCameraId === camera.id">LIVE</small></div>
        </template>
      </section>
      <section>
        <button class="section-row" type="button" @click="sections.objects = !sections.objects"><ChevronDown :size="10" :class="{ closed: !sections.objects }" /><Square :size="11" /><span>Objects</span><small>{{ selectedScene?.objects.length ?? 0 }}</small></button>
        <template v-if="sections.objects">
          <div v-for="row in objectRows" :key="row.object.id" class="entity-row object-tree-row" :class="{ active: selectedSceneEntityId === row.object.id, picked: pickedObjectIds.has(row.object.id), muted: !row.effectiveVisible }" :style="{ paddingLeft: `${6 + row.depth * 13}px` }" :title="row.object.type === 'group' ? `${row.object.name} · transform parent` : row.object.name" role="button" tabindex="0" @click="selectObject($event, row.object.id)" @keydown.enter="selectObject($event, row.object.id)" @contextmenu="openContextMenu($event, 'entity', row.object.id)">
            <button v-if="row.object.type === 'group' && row.hasChildren" class="tree-toggle" type="button" :title="collapsedGroupIds.has(row.object.id) ? 'Expand group' : 'Collapse group'" @click.stop="toggleGroup(row.object.id)"><ChevronDown :size="9" :class="{ closed: collapsedGroupIds.has(row.object.id) }" /></button><span v-else class="tree-spacer" />
            <button class="visibility" type="button" :title="row.object.visible ? `Hide ${row.object.type === 'group' ? 'group' : 'object'}` : `Show ${row.object.type === 'group' ? 'group' : 'object'}`" @click.stop="toggleVisible(row.object.id)"><Eye v-if="row.object.visible" :size="10" /><EyeOff v-else :size="10" /></button>
            <Layers3 v-if="row.object.type === 'group'" :size="11" />
            <component :is="row.object.primitive === 'sphere' ? Circle : row.object.primitive === 'plane' && row.object.assetId ? ImageIcon : row.object.primitive === 'plane' ? Square : Box" v-else :size="11" />
            <span>{{ row.object.name }}</span><Lock v-if="row.object.locked" :size="9" /><small v-if="row.object.type === 'group'">GROUP</small>
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
    <div v-else class="hierarchy-empty"><Box :size="20" /><strong>No scene</strong><small>Create one from the 3D viewport to begin.</small><button type="button" @click="store.create3DSceneFromWorkspace()"><Plus :size="11" /> Create scene</button></div>

    <div v-if="selectedScene && addMenu" class="add-menu" :class="addMenu">
      <strong>Add to scene</strong>
      <button type="button" @click="store.add3DPrimitive('box'); addMenu = null"><Box :size="12" /> Cube</button>
      <button type="button" @click="store.add3DPrimitive('sphere'); addMenu = null"><Circle :size="12" /> Sphere</button>
      <button type="button" @click="store.add3DImagePlane(); addMenu = null"><ImageIcon :size="12" /> Image plane</button>
      <button type="button" @click="addEmptyGroup"><Layers3 :size="12" /> Empty group</button>
      <button type="button" :disabled="Boolean(groupBlockedReason)" :title="groupBlockedReason || `Parent ${groupableCount} selected objects to a new group`" @click="groupPickedObjects"><Layers3 :size="12" /> Group selected <small v-if="groupableCount">{{ groupableCount }}</small></button>
      <button type="button" @click="store.add3DCamera(); addMenu = null"><Camera :size="12" /> Camera</button>
      <button type="button" @click="store.add3DPath(); addMenu = null"><Spline :size="12" /> Bézier path</button>
      <button type="button" @click="store.add3DLight('directional'); addMenu = null"><Sun :size="12" /> Directional light</button>
      <button type="button" @click="store.add3DLight('point'); addMenu = null"><Lightbulb :size="12" /> Point light</button>
      <button type="button" @click="store.add3DLight('spot'); addMenu = null"><Lightbulb :size="12" /> Spot light</button>
    </div>
    <footer v-if="selectedScene"><button class="add-menu-trigger" type="button" @click="toggleAddMenu('footer')"><Plus :size="11" /> Add entity</button></footer>
    <Teleport to="body">
      <div v-if="contextMenu" class="scene-context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" role="menu" @contextmenu.prevent>
        <button type="button" role="menuitem" @click="renameContextTarget"><Pencil :size="11" /> Rename</button>
        <button type="button" role="menuitem" @click="toggleContextTarget"><EyeOff v-if="contextTarget()?.visible" :size="11" /><Eye v-else :size="11" /> {{ contextTarget()?.visible ? 'Hide' : 'Show' }}</button>
        <button v-if="contextTargetIsGroup()" type="button" role="menuitem" @click="ungroupContextTarget"><Ungroup :size="11" /> Ungroup children</button>
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
      <p v-else class="dialog-warning">You can undo this action.</p>
    </MDialog>
  </aside>
</template>

<style scoped>
.hierarchy-panel { position: relative; display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); }.header-action { display: grid; width: 22px; height: 22px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }.header-action:hover { color: var(--text-primary); background: var(--bg-hover); }.header-action:disabled { opacity: .35; cursor: default; }.scene-root { display: flex; height: 31px; flex: 0 0 auto; align-items: center; gap: 5px; padding: 0 7px; color: #cdd5ff; background: #171a24; border-bottom: 1px solid var(--border-subtle); }.scene-root.muted { opacity: .5; }.scene-root strong { min-width: 0; flex: 1; overflow: hidden; font-size: 9.5px; font-weight: 570; text-overflow: ellipsis; white-space: nowrap; }.scene-root small { color: var(--text-muted); font-size: 6.5px; white-space: nowrap; }.hierarchy-scroll { min-height: 0; flex: 1; padding: 4px; overflow: auto; }.hierarchy-scroll section { margin-bottom: 2px; }.hierarchy-empty { display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 6px; padding: 16px; color: var(--text-muted); text-align: center; }.hierarchy-empty svg { color: var(--accent); }.hierarchy-empty strong { color: var(--text-primary); font-size: 10px; }.hierarchy-empty small { font-size: 8px; line-height: 1.4; }.hierarchy-empty button { display: inline-flex; height: 25px; align-items: center; gap: 4px; padding: 0 8px; color: #dce2ff; background: var(--bg-selected); border: 1px solid var(--accent-border); border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; }.section-row, .entity-row { display: flex; width: 100%; height: 25px; min-width: 0; align-items: center; gap: 5px; padding: 0 5px; color: var(--text-secondary); text-align: left; background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; cursor: pointer; }.section-row { color: #9298a6; font-size: 8px; font-weight: 650; letter-spacing: .045em; text-transform: uppercase; }.section-row:hover, .entity-row:hover { background: var(--bg-hover); }.section-row svg.closed { transform: rotate(-90deg); }.section-row span, .entity-row span:nth-last-of-type(1) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.section-row small, .entity-row small { margin-left: auto; color: var(--text-muted); font-size: 7px; font-weight: 500; letter-spacing: 0; text-transform: none; }.entity-row { height: 26px; padding-left: 6px; font-size: 9px; }.entity-row.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.entity-row.muted { opacity: .48; }.visibility { display: grid; width: 14px; height: 18px; flex: 0 0 14px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 2px; cursor: pointer; }.visibility:hover { color: var(--text-primary); background: var(--bg-hover); }.add-menu { position: absolute; z-index: 8; display: grid; padding: 5px; background: #1a1d24; border: 1px solid #444a58; border-radius: 4px; box-shadow: 0 10px 24px rgb(0 0 0 / .48); }.add-menu.header { top: 33px; right: 6px; min-width: 168px; }.add-menu.footer { right: 6px; bottom: 35px; left: 6px; }.add-menu strong { padding: 4px 5px 6px; color: var(--text-muted); font-size: 7.5px; letter-spacing: .07em; text-transform: uppercase; }.add-menu button { display: flex; height: 26px; align-items: center; gap: 6px; padding: 0 6px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: 9px; cursor: pointer; }.add-menu button:hover { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.hierarchy-panel > footer { display: flex; height: 34px; flex: 0 0 auto; align-items: center; padding: 4px 6px; border-top: 1px solid var(--border-subtle); }.hierarchy-panel > footer button { display: flex; width: 100%; height: 25px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: #181a20; border: 1px dashed #3a3e49; border-radius: 3px; font: inherit; font-size: 9px; cursor: pointer; }.hierarchy-panel > footer button:hover { color: var(--text-primary); border-color: var(--accent-border); }
.scene-layer-picker { display: grid; height: 34px; flex: 0 0 auto; grid-template-columns: 15px minmax(0, 1fr) 18px; align-items: center; gap: 4px; padding: 4px 6px; background: #12151c; border-bottom: 1px solid var(--border-subtle); }.scene-layer-picker > svg { color: #8c9bff; }.scene-layer-picker > button { display: grid; width: 18px; height: 22px; place-items: center; padding: 0; color: var(--text-secondary); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }.scene-layer-picker > button:hover { color: var(--text-primary); background: var(--bg-hover); }.scene-layer-picker > button.off { color: var(--text-muted); opacity: .6; }
:global(.scene-context-menu) { position: fixed; z-index: 600; display: grid; width: 164px; padding: 4px; background: #171920; border: 1px solid #3b3f4b; border-radius: 4px; box-shadow: 0 10px 26px rgb(0 0 0 / .5); }
:global(.scene-context-menu > button) { display: flex; height: 26px; align-items: center; gap: 7px; padding: 0 7px; color: #aeb3bf; background: transparent; border: 0; border-radius: 3px; font: inherit; font-size: 9px; text-align: left; cursor: pointer; }
:global(.scene-context-menu > button:hover:not(:disabled)) { color: #eef0ff; background: var(--bg-selected); }
:global(.scene-context-menu > button.danger) { color: #d88991; }
:global(.scene-context-menu > button:disabled) { opacity: .35; cursor: default; }
:global(.scene-context-menu > span) { height: 1px; margin: 3px 2px; background: var(--border-subtle); }
.dialog-warning { margin: 0; color: var(--text-secondary); font-size: 9px; }
.entity-row.picked { color: #dce2ff; background: rgb(91 108 191 / .12); border-color: rgb(122 140 230 / .28); }
.entity-row.active { background: var(--bg-selected); border-color: var(--accent-border); }
.tree-toggle, .tree-spacer { display: grid; width: 11px; height: 18px; flex: 0 0 11px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; }
.tree-toggle { cursor: pointer; }.tree-toggle:hover { color: var(--text-primary); }.tree-toggle svg.closed { transform: rotate(-90deg); }
.add-menu button small { margin-left: auto; color: var(--accent); }.add-menu button:disabled { opacity: .35; cursor: default; }.add-menu button:hover:disabled { color: var(--text-secondary); background: transparent; border-color: transparent; }
</style>
