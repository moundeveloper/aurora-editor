<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { renderPreviewOptionsSchema, type RenderPreviewResult } from '../../shared/renderPreview'
const store=useEditorStore(),open=ref(false),busy=ref(false),error=ref('')
const sceneId=ref(''),cameraId=ref(''),time=ref(0),duration=ref(0),width=ref(960),height=ref(540),frames=ref(60),quality=ref('')
const scene=computed(()=>store.scenes3D.find(s=>s.id===sceneId.value)??store.scenes3D[0])
const result=ref<(Omit<RenderPreviewResult,'png'> & {image:string;path:string})|null>(null)
const metricLabels:Record<string,string>={firstSyncMs:'Initial scene setup (ms)',syncMedianMs:'Scene update median (ms)',syncP95Ms:'Scene update P95 (ms)',frameMedianMs:'Completed frame median (ms)',frameP95Ms:'Completed frame P95 (ms)',drawCalls:'Draw calls',triangles:'Triangles',instances:'Instances',instanceUploadsDuringBenchmark:'Instance buffer updates',renderer:'Graphics renderer'}
async function render(){
  error.value='';busy.value=true
  try {
    const options=renderPreviewOptionsSchema.parse({projectId:store.project.id,sceneId:scene.value?.id,cameraId:cameraId.value||undefined,time:time.value,duration:duration.value,width:width.value,height:height.value,benchmarkFrames:frames.value,quality:quality.value||undefined})
    const response=await fetch(`/api/projects/${encodeURIComponent(store.project.id)}/render-preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(options)})
    const data=await response.json();if(!response.ok)throw new Error(data.error??'Render failed');result.value=data
  }catch(e){error.value=e instanceof Error?e.message:String(e)}finally{busy.value=false}
}
</script>
<template>
  <button type="button" class="profile-trigger" title="Render and profile saved scene" aria-label="Render and profile saved scene" @click="open=true">Profile</button>
  <Teleport to="body"><div v-if="open" class="profile-backdrop"><section role="dialog" aria-modal="true" aria-label="Scene render profiler" class="scene-profiler">
    <header><strong>Render and profile saved scene</strong><button type="button" @click="open=false">Close</button></header>
    <p>Uses the saved project, not unsaved edits. Sampling duration advances the animation; zero repeats one frame. Timings include scene synchronization and GPU completion.</p>
    <form @submit.prevent="render">
      <label>Scene<select v-model="sceneId" @change="cameraId='' "><option value="">First scene</option><option v-for="s in store.scenes3D" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
      <label>Camera<select v-model="cameraId"><option value="">Follow camera cuts</option><option v-for="c in scene?.cameras" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
      <label>Start time<input v-model.number="time" type="number" min="0" step="0.1" /></label><label>Sampling duration<input v-model.number="duration" type="number" min="0" max="30" step="0.1" /></label>
      <label>Width<input v-model.number="width" type="number" min="64" max="1920" /></label><label>Height<input v-model.number="height" type="number" min="64" max="1080" /></label>
      <label>Frames<input v-model.number="frames" type="number" min="1" max="600" /></label><label>Quality<select v-model="quality"><option value="">Saved quality</option><option>draft</option><option>preview</option><option>full</option></select></label>
      <button type="submit" :disabled="busy">{{ busy?'Rendering…':'Render and measure' }}</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="result"><img :src="result.image" alt="Saved camera render" /><p>{{ result.sampleCount }} frames sampled from {{ result.sampleStart }} to {{ result.sampleEnd }} seconds · {{ result.width }} × {{ result.height }} · {{ result.quality }}</p><dl><template v-for="(value,key) in result.metrics" :key="key"><dt>{{ metricLabels[key]??key }}</dt><dd>{{ value }}</dd></template></dl><p>PNG: {{ result.path }}</p><a :href="result.image" download="aurora-preview.png">Download PNG</a></div>
  </section></div></Teleport>
</template>
<style scoped>
.profile-trigger{color:var(--text-secondary);background:var(--bg-panel-alt);border:1px solid var(--border-strong);border-radius:3px;font-size:9px;cursor:pointer}
.profile-backdrop{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;background:#0009}.scene-profiler{width:min(680px,90vw);max-height:90vh;overflow:auto;padding:20px;color:var(--text-primary);background:var(--bg-panel);border:1px solid var(--border-strong);border-radius:8px;font-size:12px}.scene-profiler header{display:flex;justify-content:space-between;align-items:center}.scene-profiler form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.scene-profiler label{display:flex;flex-direction:column;gap:4px}.scene-profiler input,.scene-profiler select,.scene-profiler button{padding:7px;color:var(--text-primary);background:var(--bg-input);border:1px solid var(--border-strong);border-radius:4px}.scene-profiler p{line-height:1.5;overflow-wrap:anywhere;color:var(--text-secondary)}.scene-profiler img{display:block;max-width:100%;max-height:320px;margin:16px auto}.scene-profiler dl{display:grid;grid-template-columns:1fr 1fr;gap:5px}.scene-profiler dd{margin:0;overflow-wrap:anywhere}.scene-profiler a{color:var(--accent)}
</style>
