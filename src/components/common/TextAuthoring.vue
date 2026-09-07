<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EditorLayer, TextAnimator } from '@/models/editor'
import { useEditorStore } from '@/stores/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
import { setNumericPropertyAtTime } from '@/engine/animation/editNumericProperty'
import MSelect from './MSelect.vue'
import NumberField from './NumberField.vue'
import KeyframeControl from './KeyframeControl.vue'
import {prepareTextFont} from '@/engine/animation/textFonts'
const props = defineProps<{ layer: EditorLayer }>()
const store = useEditorStore()
const fontError=ref('')
async function importFont(event:Event) {
  const input=event.target as HTMLInputElement,file=input.files?.[0]
  if(!file)return
  fontError.value=''
  try {
    if(file.size>10*1024*1024)throw new Error('Choose a font smaller than 10 MB.')
    const source=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Unable to read font.'));reader.readAsDataURL(file)})
    const candidate={...props.layer,textFontSource:source,textFont:file.name.replace(/\.[^.]+$/,'')}
    await prepareTextFont(candidate)
    props.layer.textFontSource=source;props.layer.textFont=candidate.textFont;store.markChanged()
  }catch(error){fontError.value=error instanceof Error?error.message:String(error)}finally{input.value=''}
}
const paths = computed(() => [{ value: '', label: 'No path' }, ...store.layers.filter(layer => layer.type === 'shape').map(layer => ({ value: layer.id, label: layer.name }))])
const parameters = [
  { key: 'start', label: 'Range start %' }, { key: 'end', label: 'Range end %' }, { key: 'progress', label: 'Reveal progress' },
  { key: 'stagger', label: 'Stagger' }, { key: 'x', label: 'Offset X' }, { key: 'y', label: 'Offset Y' },
  { key: 'rotation', label: 'Rotation' }, { key: 'opacity', label: 'Starting opacity %' },
] as const
function addAnimator() {
  const id = crypto.randomUUID(), defaults = { start: 0, end: 100, progress: 0, stagger: .12, x: 0, y: 35, rotation: 0, opacity: 0 }
  const channel = (key: keyof typeof defaults) => ({ id: `${id}-${key}`, value: defaults[key], animated: false, keyframes: [] })
  const animator: TextAnimator = { id, enabled: true, unit: 'character', color: props.layer.textColor ?? '#f3eee6', parameters: {
    start: channel('start'), end: channel('end'), progress: channel('progress'), stagger: channel('stagger'),
    x: channel('x'), y: channel('y'), rotation: channel('rotation'), opacity: channel('opacity'),
  } }
  animator.parameters.progress.animated = true
  animator.parameters.progress.keyframes = [{ id: crypto.randomUUID(), time: props.layer.start, value: 0, interpolation: 'linear' }, { id: crypto.randomUUID(), time: props.layer.start + .8, value: 1, interpolation: 'linear' }]
  ;(props.layer.textAnimators ??= []).push(animator)
  store.markChanged()
}
function setPath(value: string) {
  props.layer.textPathId = value || undefined
  props.layer.textPathOffset ??= { id: `${props.layer.id}-path-offset`, value: 0, animated: false, keyframes: [] }
  store.markChanged()
}
</script>
<template>
  <section class="text-authoring">
    <strong>Text</strong>
    <label>Content<textarea v-model="layer.textContent" aria-label="Text content" @change="store.markChanged" /></label>
    <label>Font<input v-model="layer.textFont" placeholder="Inter" aria-label="Text font family" @change="layer.textFontSource = undefined; store.markChanged()" /></label>
    <label>Embed font<input type="file" accept=".woff,.woff2,.ttf,.otf" aria-label="Import text font" @change="importFont" /></label><small v-if="layer.textFontSource">Font embedded in the project.</small><small v-if="fontError" role="alert">{{fontError}}</small>
    <label>Size<NumberField :model-value="layer.textSize ?? 42" :min="1" label="Text font size" @update:model-value="layer.textSize = $event; store.markChanged()" /></label>
    <label>Color<input type="color" :value="layer.textColor ?? '#f3eee6'" aria-label="Text color" @input="layer.textColor = ($event.target as HTMLInputElement).value; store.markChanged()" /></label>
    <label>Flow on shape<MSelect :model-value="layer.textPathId ?? ''" :options="paths" label="Text path" @update:model-value="setPath" /></label>
    <label v-if="layer.textPathId && layer.textPathOffset">Path offset<NumberField :model-value="evaluateNumericProperty(layer.textPathOffset, store.currentTime)" label="Text path offset" @update:model-value="setNumericPropertyAtTime(layer.textPathOffset!, $event, store.currentTime, store.project.frameRate, { autoKey: store.autoKey }); store.markChanged()" /><KeyframeControl :property="layer.textPathOffset" label="Text path offset" /></label>
    <small v-if="layer.textPathId">Follows the shape’s animated outline and transform. The text transform adds an offset from the composition center.</small>
    <button type="button" @click="addAnimator">Add text animator</button>
    <details v-for="(animator, index) in layer.textAnimators" :key="animator.id" open>
      <summary>Animator {{ index + 1 }}</summary>
      <button type="button" :aria-pressed="animator.enabled" @click="animator.enabled = !animator.enabled; store.markChanged()">{{ animator.enabled ? 'Bypass' : 'Enable' }}</button>
      <button type="button" @click="layer.textAnimators!.splice(index, 1); store.markChanged()">Remove</button>
      <MSelect v-model="animator.unit" :options="[{ value: 'character', label: 'Characters' }, { value: 'word', label: 'Words' }]" label="Text animator units" @update:model-value="store.markChanged" />
      <label v-for="parameter in parameters" :key="parameter.key">{{ parameter.label }}<NumberField :model-value="evaluateNumericProperty(animator.parameters[parameter.key], store.currentTime)" :step="parameter.key === 'progress' || parameter.key === 'stagger' ? .05 : 1" :label="parameter.label" @update:model-value="setNumericPropertyAtTime(animator.parameters[parameter.key], $event, store.currentTime, store.project.frameRate, { autoKey: store.autoKey }); store.markChanged()" /><KeyframeControl :property="animator.parameters[parameter.key]" :label="parameter.label" /></label>
      <label>Starting color<input v-model="animator.color" type="color" aria-label="Text animator starting color" @input="store.markChanged" /></label>
    </details>
  </section>
</template>
<style scoped>
.text-authoring{display:flex;flex-direction:column;gap:8px;padding:10px;color:#b9c1d3;font-size:11px;border-bottom:1px solid #343947}label{display:flex;align-items:center;gap:5px;justify-content:space-between}textarea,input{min-width:0;max-width:160px;color:inherit;background:#191e29;border:1px solid #394052;padding:5px}button{color:inherit;background:#292f3c;border:1px solid #454e61;border-radius:3px;padding:4px}details label{margin:6px 0}small{color:#8893a7}
</style>
