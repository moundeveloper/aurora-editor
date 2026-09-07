<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import type {EditorLayer,Keyframe} from '@/models/editor'
import {useEditorStore} from '@/stores/editor'
import {openTrackingVideo,trackPoint,type TrackingFrame} from '@/engine/animation/pointTracking'
import {sourceTime,layerSampleTime} from '@/engine/animation/timeRemap'
import {evaluateNumericProperty} from '@/engine/animation/evaluateProperty'
import {mediaUrl} from '@/services/mediaLibrary'
import MSelect from './MSelect.vue'
import NumberField from './NumberField.vue'
const props=defineProps<{layer:EditorLayer}>(),store=useEditorStore()
const sourceId=ref(''),start=ref(store.currentTime),end=ref(Math.min(store.project.duration,store.currentTime+2)),busy=ref(false),message=ref(''),progress=ref(0),canvas=ref<HTMLCanvasElement>()
const point=ref({x:.5,y:.5}),preview=ref<TrackingFrame|null>(null)
const videos=computed(()=>store.layers.filter(layer=>layer.type==='video' && store.assets.some(asset=>asset.id===layer.assetId && asset.hash)))
let abort:AbortController|undefined,previewRun=0
function draw() {
  if(!canvas.value || !preview.value)return
  canvas.value.width=preview.value.width;canvas.value.height=preview.value.height
  const context=canvas.value.getContext('2d')!
  context.putImageData(new ImageData(new Uint8ClampedArray(preview.value.data),preview.value.width,preview.value.height),0,0)
  context.strokeStyle='#ffbc55';context.lineWidth=2
  context.strokeRect(point.value.x*canvas.value.width-7,point.value.y*canvas.value.height-7,14,14)
}
function choose(event:MouseEvent) {
  if(busy.value || !canvas.value)return
  const rect=canvas.value.getBoundingClientRect()
  point.value={x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};draw()
}
async function loadPreview() {
  const run=++previewRun,source=videos.value.find(layer=>layer.id===sourceId.value),asset=store.assets.find(asset=>asset.id===source?.assetId)
  if(!source || !asset?.hash)return
  let video:Awaited<ReturnType<typeof openTrackingVideo>>|undefined
  try{video=await openTrackingVideo(mediaUrl(asset.hash));const frame=await video.sample(sourceTime(source,start.value));if(run===previewRun){preview.value=frame;draw()}}
  catch(error){if(run===previewRun)message.value=String(error)}finally{video?.dispose()}
}
watch([sourceId,start],()=>{if(!busy.value)void loadPreview()})
function worldPoint(source:EditorLayer,x:number,y:number,width:number,height:number,time:number) {
  const at=layerSampleTime(source,time),ratio=width/height,projectRatio=store.project.width/store.project.height
  const displayWidth=ratio>projectRatio?store.project.height*ratio:store.project.width,displayHeight=ratio>projectRatio?store.project.height:store.project.width/ratio
  const localX=(x/width-.5)*displayWidth*evaluateNumericProperty(source.transform.scaleX,at)/100,localY=(y/height-.5)*displayHeight*evaluateNumericProperty(source.transform.scaleY,at)/100
  const rotation=evaluateNumericProperty(source.transform.rotation,at)*Math.PI/180
  return {x:evaluateNumericProperty(source.transform.x,at)+localX*Math.cos(rotation)-localY*Math.sin(rotation),y:evaluateNumericProperty(source.transform.y,at)+localX*Math.sin(rotation)+localY*Math.cos(rotation)}
}
async function track() {
  const source=videos.value.find(layer=>layer.id===sourceId.value),asset=store.assets.find(asset=>asset.id===source?.assetId)
  if(!source || !asset?.hash)return
  const from=start.value,to=end.value,frames=Math.ceil((to-from)*store.project.frameRate)
  if(frames<1 || frames>600){message.value='Choose a range of 1–600 frames.';return}
  if(from<source.start || to>source.start+source.duration){message.value='Keep the tracking range inside the source clip.';return}
  if(props.layer.timeRemap){message.value='Disable time remapping on the target before applying tracking.';return}
  const target=props.layer,revision=store.renderRevision,projectId=store.project.id
  busy.value=true;message.value='';progress.value=0;abort=new AbortController();store.playing=false
  let video:Awaited<ReturnType<typeof openTrackingVideo>>|undefined
  try{
    video=await openTrackingVideo(mediaUrl(asset.hash),abort.signal)
    let previous=await video.sample(sourceTime(source,from)),x=point.value.x*video.width,y=point.value.y*video.height
    const origin=worldPoint(source,x,y,video.width,video.height,from),initial={x:evaluateNumericProperty(target.transform.x,from),y:evaluateNumericProperty(target.transform.y,from)}
    const keys:{x:Keyframe<number>[];y:Keyframe<number>[]}={x:[],y:[]}
    for(let frame=0;frame<=frames;frame++) {
      const time=Math.min(to,from+frame/store.project.frameRate)
      if(frame){const current=await video.sample(sourceTime(source,time)),match=trackPoint(previous,current,x,y);if(!match)throw new Error(`Tracking lost at ${time.toFixed(2)}s. Choose a more distinct feature or a shorter range.`);x=match.x;y=match.y;previous=current}
      const position=worldPoint(source,x,y,video.width,video.height,time)
      for(const axis of ['x','y'] as const)keys[axis].push({id:crypto.randomUUID(),time,value:initial[axis]+position[axis]-origin[axis],interpolation:'linear'})
      progress.value=frame/frames
      if(frame%5===0)await new Promise(resolve=>setTimeout(resolve,0))
      if(abort.signal.aborted)throw new DOMException('Tracking cancelled','AbortError')
    }
    if(projectId!==store.project.id || revision!==store.renderRevision || props.layer!==target)throw new Error('Project changed while tracking. Run the tracker again.')
    for(const axis of ['x','y'] as const){const channel=target.transform[axis];channel.keyframes=[...channel.keyframes.filter(key=>key.time<from || key.time>to),...keys[axis]].sort((a,b)=>a.time-b.time);channel.animated=true;if(channel.driver)channel.driver.enabled=false;channel.modifiers?.forEach(modifier=>{modifier.enabled=false})}
    store.markChanged();message.value='Tracking applied to position. Undo restores the previous animation.'
  }catch(error){message.value=error instanceof Error?error.message:String(error)}finally{video?.dispose();busy.value=false}
}
onBeforeUnmount(()=>{previewRun++;abort?.abort()})
</script>
<template>
  <details class="point-tracker"><summary>Point tracker</summary>
    <MSelect v-model="sourceId" :options="[{value:'',label:'Choose video'},...videos.map(layer=>({value:layer.id,label:layer.name}))]" label="Tracking source video" />
    <label>Start (s)<NumberField v-model="start" :min="0" label="Tracking start" /></label><label>End (s)<NumberField v-model="end" :min="0" label="Tracking end" /></label>
    <canvas v-show="preview" ref="canvas" aria-label="Click a distinctive feature to track" @click="choose" />
    <small>Click a high-contrast feature. Translation follows this video; scale and rotation of the tracked feature are not estimated. Applying replaces X/Y keys in the range and bypasses their drivers and modifiers.</small>
    <button v-if="!busy" type="button" :disabled="!preview || !sourceId || layer.locked" @click="track">Track and apply position</button><button v-else type="button" @click="abort?.abort()">Cancel · {{Math.round(progress*100)}}%</button>
    <p v-if="message" role="status">{{message}}</p>
  </details>
</template>
<style scoped>
.point-tracker{padding:9px;font-size:10px;color:var(--text-secondary);border-bottom:1px solid var(--border-subtle)}summary{cursor:pointer;margin-bottom:7px}label{display:flex;justify-content:space-between;margin:6px 0}canvas{width:100%;height:auto;cursor:crosshair}small{display:block;color:var(--text-muted);line-height:1.4;margin:7px 0}button{color:inherit;background:var(--bg-input);border:1px solid var(--border-strong);padding:5px}
</style>
