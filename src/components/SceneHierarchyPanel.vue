<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Box, Camera, ChevronDown, Circle, Eye, EyeOff, Lightbulb, Lock, Plus, Spline, Square, Sun } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import PanelHeader from './common/PanelHeader.vue'

const store = useEditorStore()
const { selectedScene, selectedSceneEntityId } = storeToRefs(store)
const addMenu = ref(false)
const sections = ref({ cameras: true, objects: true, lights: true, paths: true })
const scenePaths = computed(() => selectedScene.value?.paths ?? [])
const entityCount = computed(() => (selectedScene.value?.objects.length ?? 0) + (selectedScene.value?.cameras.length ?? 0) + (selectedScene.value?.lights.length ?? 0) + scenePaths.value.length)

function select(id: string) {
  if (selectedScene.value) store.selectSceneEntity(selectedScene.value.id, id)
}

function toggleVisible(id: string) {
  const object = selectedScene.value?.objects.find((item) => item.id === id)
  if (!object) return
  object.visible = !object.visible
  store.markSceneChanged()
}
</script>

<template>
  <aside class="hierarchy-panel">
    <PanelHeader title="Scene" :subtitle="`${entityCount} entities`">
      <template #icon><Box :size="13" /></template>
      <template #actions><button class="header-action" type="button" title="Add 3D entity" @click="addMenu = !addMenu"><Plus :size="13" /></button></template>
    </PanelHeader>
    <div class="scene-root"><ChevronDown :size="11" /><Box :size="12" /><strong :title="selectedScene?.name">{{ selectedScene?.name }}</strong></div>

    <div class="hierarchy-scroll">
      <section>
        <button class="section-row" type="button" @click="sections.cameras = !sections.cameras"><ChevronDown :size="10" :class="{ closed: !sections.cameras }" /><Camera :size="11" /><span>Cameras</span><small>{{ selectedScene?.cameras.length ?? 0 }}</small></button>
        <template v-if="sections.cameras">
          <button v-for="camera in selectedScene?.cameras" :key="camera.id" class="entity-row" type="button" :class="{ active: selectedSceneEntityId === camera.id }" :title="camera.name" @click="select(camera.id)"><span class="indent" /><Camera :size="11" /><span>{{ camera.name }}</span><small v-if="selectedScene?.activeCameraId === camera.id">LIVE</small></button>
        </template>
      </section>
      <section>
        <button class="section-row" type="button" @click="sections.objects = !sections.objects"><ChevronDown :size="10" :class="{ closed: !sections.objects }" /><Square :size="11" /><span>Objects</span><small>{{ selectedScene?.objects.length ?? 0 }}</small></button>
        <template v-if="sections.objects">
          <div v-for="object in selectedScene?.objects" :key="object.id" class="entity-row" :class="{ active: selectedSceneEntityId === object.id, muted: !object.visible }" :title="object.name" role="button" tabindex="0" @click="select(object.id)" @keydown.enter="select(object.id)">
            <button class="visibility" type="button" :title="object.visible ? 'Hide object' : 'Show object'" @click.stop="toggleVisible(object.id)"><Eye v-if="object.visible" :size="10" /><EyeOff v-else :size="10" /></button>
            <component :is="object.primitive === 'sphere' ? Circle : object.primitive === 'plane' ? Square : Box" :size="11" />
            <span>{{ object.name }}</span><Lock v-if="object.locked" :size="9" />
          </div>
        </template>
      </section>
      <section>
        <button class="section-row" type="button" @click="sections.lights = !sections.lights"><ChevronDown :size="10" :class="{ closed: !sections.lights }" /><Sun :size="11" /><span>Lights</span><small>{{ selectedScene?.lights.length ?? 0 }}</small></button>
        <template v-if="sections.lights">
          <button v-for="light in selectedScene?.lights" :key="light.id" class="entity-row" type="button" :class="{ active: selectedSceneEntityId === light.id }" :title="light.name" @click="select(light.id)"><span class="indent" /><Lightbulb :size="11" :style="{ color: light.color }" /><span>{{ light.name }}</span><small>{{ light.type }}</small></button>
        </template>
      </section>
      <section>
        <button class="section-row" type="button" @click="sections.paths = !sections.paths"><ChevronDown :size="10" :class="{ closed: !sections.paths }" /><Spline :size="11" /><span>Paths</span><small>{{ scenePaths.length }}</small></button>
        <template v-if="sections.paths">
          <button v-for="path in scenePaths" :key="path.id" class="entity-row" type="button" :class="{ active: selectedSceneEntityId === path.id }" :title="path.name" @click="select(path.id)"><span class="indent" /><Spline :size="11" :style="{ color: path.color }" /><span>{{ path.name }}</span><Lock v-if="path.locked" :size="9" /><small>{{ path.points.length }} pts</small></button>
        </template>
      </section>
    </div>

    <div v-if="addMenu" class="add-menu">
      <strong>Add to scene</strong>
      <button type="button" @click="store.add3DPrimitive('box'); addMenu = false"><Box :size="12" /> Cube</button>
      <button type="button" @click="store.add3DPrimitive('sphere'); addMenu = false"><Circle :size="12" /> Sphere</button>
      <button type="button" @click="store.add3DCamera(); addMenu = false"><Camera :size="12" /> Camera</button>
      <button type="button" @click="store.add3DPath(); addMenu = false"><Spline :size="12" /> Bézier path</button>
      <button type="button" @click="store.add3DLight('directional'); addMenu = false"><Sun :size="12" /> Directional light</button>
      <button type="button" @click="store.add3DLight('point'); addMenu = false"><Lightbulb :size="12" /> Point light</button>
    </div>
    <footer><button type="button" @click="addMenu = !addMenu"><Plus :size="11" /> Add entity</button></footer>
  </aside>
</template>

<style scoped>
.hierarchy-panel { position: relative; display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--bg-panel); }.header-action { display: grid; width: 22px; height: 22px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 3px; cursor: pointer; }.header-action:hover { color: var(--text-primary); background: var(--bg-hover); }.scene-root { display: flex; height: 31px; flex: 0 0 auto; align-items: center; gap: 5px; padding: 0 7px; color: #cdd5ff; background: #171a24; border-bottom: 1px solid var(--border-subtle); }.scene-root strong { min-width: 0; overflow: hidden; font-size: 9.5px; font-weight: 570; text-overflow: ellipsis; white-space: nowrap; }.hierarchy-scroll { min-height: 0; flex: 1; padding: 4px; overflow: auto; }.hierarchy-scroll section { margin-bottom: 2px; }.section-row, .entity-row { display: flex; width: 100%; height: 25px; min-width: 0; align-items: center; gap: 5px; padding: 0 5px; color: var(--text-secondary); text-align: left; background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; cursor: pointer; }.section-row { color: #9298a6; font-size: 8px; font-weight: 650; letter-spacing: .045em; text-transform: uppercase; }.section-row:hover, .entity-row:hover { background: var(--bg-hover); }.section-row svg.closed { transform: rotate(-90deg); }.section-row span, .entity-row span:nth-last-of-type(1) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.section-row small, .entity-row small { margin-left: auto; color: var(--text-muted); font-size: 7px; font-weight: 500; letter-spacing: 0; text-transform: none; }.entity-row { height: 26px; padding-left: 6px; font-size: 9px; }.entity-row.active { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.entity-row.muted { opacity: .48; }.indent { width: 14px; flex: 0 0 14px !important; }.visibility { display: grid; width: 14px; height: 18px; flex: 0 0 14px; place-items: center; padding: 0; color: var(--text-muted); background: transparent; border: 0; cursor: pointer; }.add-menu { position: absolute; z-index: 8; right: 6px; bottom: 35px; left: 6px; display: grid; padding: 5px; background: #1a1d24; border: 1px solid #444a58; border-radius: 4px; box-shadow: 0 10px 24px rgb(0 0 0 / .48); }.add-menu strong { padding: 4px 5px 6px; color: var(--text-muted); font-size: 7.5px; letter-spacing: .07em; text-transform: uppercase; }.add-menu button { display: flex; height: 26px; align-items: center; gap: 6px; padding: 0 6px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: 9px; cursor: pointer; }.add-menu button:hover { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }.hierarchy-panel > footer { display: flex; height: 34px; flex: 0 0 auto; align-items: center; padding: 4px 6px; border-top: 1px solid var(--border-subtle); }.hierarchy-panel > footer button { display: flex; width: 100%; height: 25px; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); background: #181a20; border: 1px dashed #3a3e49; border-radius: 3px; font: inherit; font-size: 9px; cursor: pointer; }.hierarchy-panel > footer button:hover { color: var(--text-primary); border-color: var(--accent-border); }
</style>
