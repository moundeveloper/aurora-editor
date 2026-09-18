<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { configureViewportNavigation } from '@/engine/scene3d/viewportNavigation'
import { selectEdgeLoop, selectFaceLoop, edgeSlideVertices } from '../../../shared/edgeLoops'
import { insertQuadLoop, topologyEdgeKey } from '../../../shared/loopCut'
import type { KnifeSegment } from '../../../shared/knife'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { Box, Plus, Save, ArrowUpRight, Undo2, Redo2 } from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import { constrainedMove, constrainedScale, toggleConstraint, constraintLabel } from '@/engine/modeling/transformConstraint'
import { attachSelectionGizmo } from '@/engine/modeling/selectionGizmo'
import { modelGeometry } from '@/engine/modeling/modelGeometry'
import { convertSelection, meshEdges, pickMeshElement, pickMeshElements, selectionCenter, selectionVertices, transformedVertices, type SelectionMode } from '@/engine/modeling/modelSelection'
import { applyModelOperation, validateMesh, type ModelDraft, type ModelOperation, type Vec3 } from '../../../shared/modeling'

const store=useEditorStore()
const models=computed(()=>store.assets.filter(a=>a.nativeModel))
const asset=computed(()=>models.value.find(a=>a.id===store.selectedModelAssetId))
const draft=computed(()=>asset.value?.nativeModel?.draft)
const preview=shallowRef<ModelDraft|null>(null)
const displayed=computed(()=>preview.value ?? draft.value)
const mode=ref<'object'|'edit'>('edit'), selectMode=ref<SelectionMode>('face'), selected=ref<string[]>([])
const distance=ref(.5), thickness=ref(.2), offset=ref<Vec3>([0,.5,0]), scale=ref<Vec3>([1,1,1])
const error=ref(''), status=ref(''), wire=ref(false), xray=ref(false), activeGesture=ref(false), gestureText=ref('')
const debugOpen=ref(false), debugHeight=ref(170), debugLines=ref<string[]>([]), debugResizing=ref(false)
const loopActive=ref(false)
const loopCuts=ref(1),loopPosition=ref(.5),loopStage=ref<'hover'|'slide'>('hover')
// Blender creates the extrusion topology before the modal movement begins. A tiny
// valid offset gives us that same zero-distance starting state while preserving the
// mesh validator's no-zero-length-edge invariant.
const extrusionStartDistance=1e-5
const extrusionOriginDirection:Vec3=[0,1,0]
const tool=ref<'select'|'translate'|'rotate'|'scale'>('translate')
const view=ref<'Perspective'|'Front'|'Right'|'Left'|'Top'>('Perspective')
const host=ref<HTMLElement>(), canvas=ref<HTMLCanvasElement>()
interface ScreenPoint { x:number; y:number }
const selectedIds=computed(()=>displayed.value ? mode.value==='object' ? displayed.value.mesh.vertices.map(v=>v.id) : selectionVertices(displayed.value.mesh,selectMode.value,selected.value) : [])
const faceId=computed({get:()=>selectMode.value==='face' && selected.value.length===1 ? selected.value[0]! : '',set:(id:string)=>{selectMode.value='face';mode.value='edit';selected.value=id?[id]:[]}})
const selectedFaces=computed(()=>selectMode.value==='face' && mode.value==='edit' ? displayed.value?.mesh.faces.filter(f=>selected.value.includes(f.id))??[] : [])
const statistics=computed(()=>{try{return displayed.value ? validateMesh(displayed.value.mesh):null}catch{return null}})
let renderer:THREE.WebGLRenderer|undefined, camera:THREE.Camera, perspectiveCamera:THREE.PerspectiveCamera, orthographicCamera:THREE.OrthographicCamera, controls:OrbitControls, observer:ResizeObserver, gizmo:TransformControls
let orthographicHalfHeight=5.5
const scene=new THREE.Scene(), content=new THREE.Group(), pivot=new THREE.Object3D()
let body:THREE.Mesh|undefined
let down={x:0,y:0},lastPointer:{x:number;y:number}|null=null,skipPick=false,orbitMoved=false,orbitAlt=false,orbitButton=0,navigationGuard=false
interface Gesture {
  kind:'translate'|'rotate'|'scale'|'extrude'|'inset'|'gizmo'|'loop-cut'|'edge-slide'|'knife'
  base:ModelDraft; assetId:string; ids:string[]; faceId:string; faceIds:string[]; pivot:THREE.Vector3
  start:{x:number;y:number}|null; axis:'x'|'y'|'z'|null; exclude:boolean; typed:string
  edge?:[string,string]; slideEdges?:string[];
  knifeStart?:ScreenPoint; knifeEnd?:ScreenPoint; knifeSegments?:KnifeSegment[];
  operation:ModelOperation|null; valid:boolean; startMatrix:THREE.Matrix4
}
let gesture:Gesture|null=null
let loopPickBody:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>|null=null
let loopEdges:Array<[string,string]>=[]
let loopSlideStart=.5
const knifeStroke=ref<[ScreenPoint,ScreenPoint]|null>(null)
const cloneDraft=(value:ModelDraft)=>JSON.parse(JSON.stringify(value)) as ModelDraft
const axes={x:new THREE.Vector3(1,0,0),y:new THREE.Vector3(0,1,0),z:new THREE.Vector3(0,0,1)}

function debugLog(message:string){debugLines.value=[...debugLines.value.slice(-199),`${new Date().toLocaleTimeString()}  ${message}`]}
function act(callback:()=>void){error.value='';status.value='';try{callback()}catch(e){error.value=e instanceof Error?e.message:String(e);debugLog(`ERROR  ${error.value}`)}}
function beginDebugResize(event:PointerEvent){
  event.preventDefault();debugResizing.value=true
  const startY=event.clientY,startHeight=debugHeight.value
  const move=(next:PointerEvent)=>{const max=Math.max(120,(host.value?.clientHeight??500)*.72);debugHeight.value=THREE.MathUtils.clamp(startHeight-(next.clientY-startY),90,max)}
  const end=()=>{debugResizing.value=false;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end)}
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true})
}
function create(primitive:'cube'|'plane'){cancelGesture();act(()=>{store.createNativeModel(primitive==='cube'?'Cube Model':'Plane Model',primitive)})}
function operation(op:ModelOperation){act(()=>{if(asset.value && draft.value)store.editNativeModel(asset.value.id,draft.value.revision,op)})}
function extrude(){if(selectedFaces.value.length)operation({type:'extrude-region',faceIds:selectedFaces.value.map(f=>f.id),distance:distance.value})}
function inset(){if(selectedFaces.value.length)operation({type:'inset-region',faceIds:selectedFaces.value.map(f=>f.id),thickness:thickness.value})}
function translate(){if(selectedIds.value.length)operation({type:'translate',vertexIds:selectedIds.value,offset:offset.value})}
function publish(){cancelGesture();act(()=>{
  if(!asset.value)return
  render()
  const image=document.createElement('canvas');image.width=320;image.height=200
  image.getContext('2d')?.drawImage(canvas.value!,0,0,320,200)
  store.publishNativeModel(asset.value.id,image.toDataURL('image/webp',.8))
  status.value='Published to Project Assets. Existing scene instances keep their revision.'
})}
function place(){cancelGesture();act(()=>{
  if(!asset.value)return
  if(!asset.value.nativeModel?.revisions.length)throw new Error('Save as Asset before placing this model')
  if(!store.selectedScene)store.create3DSceneFromWorkspace()
  store.add3DModel(asset.value.id);store.setWorkspace('3D')
})}
function rename(event:Event){const name=(event.target as HTMLInputElement).value.trim();if(asset.value && name){asset.value.name=name.slice(0,128);store.markChanged()}}
function render(){if(renderer && camera)renderer.render(scene,camera)}
function clearContent(){
  for(const child of [...content.children]){
    const drawable=child as THREE.Mesh;drawable.geometry?.dispose()
    ;(Array.isArray(drawable.material)?drawable.material:[drawable.material]).forEach(m=>m?.dispose())
    content.remove(child)
  }
  body=undefined
}
function lines(positions:number[],color:string,depthTest=true){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,depthTest,transparent:true,opacity:1}))
  line.renderOrder=2;content.add(line)
}
function dots(positions:number[],color:string,size:number){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  const points=new THREE.Points(geometry,new THREE.PointsMaterial({color,size,sizeAttenuation:false,depthTest:!xray.value && !wire.value,depthWrite:false}))
  points.renderOrder=3;content.add(points)
}
function syncGizmo(){
  if(!gizmo || gesture || gizmo.dragging)return
  attachSelectionGizmo(gizmo,pivot,displayed.value?.mesh,selectedIds.value,tool.value)
}
function rebuild(){
  clearContent()
  const source=displayed.value
  if(source){
    body=new THREE.Mesh(modelGeometry(source.mesh),new THREE.MeshStandardMaterial({color:source.color,roughness:.65,side:THREE.DoubleSide,
      colorWrite:!wire.value,depthWrite:!xray.value,transparent:xray.value,opacity:xray.value ? .2 : 1,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}))
    content.add(body)
    // Authoring edges, never BufferGeometry.wireframe: GPU triangulation is not editable topology.
    const positions=new Map(source.mesh.vertices.map(v=>[v.id,v.position])), edgeList=meshEdges(source.mesh)
    const selectedVertices=new Set(selectedIds.value), selectedElements=new Set(selected.value)
    const allEdges:number[]=[],selectedEdges:number[]=[]
    for(const edge of edgeList){
      const points=[...positions.get(edge.vertices[0])!,...positions.get(edge.vertices[1])!]
      allEdges.push(...points)
      const highlighted=mode.value==='object' || (selectMode.value==='edge' ? selectedElements.has(edge.id) : edge.vertices.every(id=>selectedVertices.has(id)))
      if(highlighted)selectedEdges.push(...points)
    }
    lines(allEdges,'#27303d',!xray.value && !wire.value)
    lines(selectedEdges,'#ffae53',!xray.value && !wire.value)
    if(loopEdges.length)lines(loopEdges.flatMap(([a,b])=>[...(positions.get(a)??[]),...(positions.get(b)??[])]),'#ff67df',false)
    if(mode.value==='edit' && selectMode.value==='vertex'){
      dots(source.mesh.vertices.filter(v=>!selectedVertices.has(v.id)).flatMap(v=>v.position),'#131921',7)
      dots(source.mesh.vertices.filter(v=>selectedVertices.has(v.id)).flatMap(v=>v.position),'#ffb35c',9)
    }
    if(mode.value==='edit' && selectMode.value==='face'){
      const faces=source.mesh.faces.filter(f=>selectedElements.has(f.id))
      if(faces.length){
        const highlight=new THREE.Mesh(modelGeometry({...source.mesh,faces}),new THREE.MeshBasicMaterial({color:'#f9a54b',transparent:true,opacity:.35,side:THREE.DoubleSide,depthWrite:false,depthTest:!xray.value && !wire.value,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}))
        highlight.renderOrder=1;content.add(highlight)
      }
      const centers=source.mesh.faces.map(f=>({id:f.id,position:selectionCenter(source.mesh,f.vertices).toArray()}))
      dots(centers.filter(f=>!selectedElements.has(f.id)).flatMap(f=>f.position),'#28303c',4)
      dots(centers.filter(f=>selectedElements.has(f.id)).flatMap(f=>f.position),'#ffe7c5',6)
    }
  }
  syncGizmo();render()
}
function frame(nextView?:'Perspective'|'Front'|'Right'|'Left'|'Top'){
  if(!camera || !controls)return
  const box=new THREE.Box3().setFromObject(content),center=new THREE.Vector3(),size=new THREE.Vector3()
  if(box.isEmpty()){center.set(0,0,0);size.set(2,2,2)}else{box.getCenter(center);box.getSize(size)}
  if(nextView)view.value=nextView
  const radius=Math.max(size.length(),2), aspect=(host.value?.clientWidth??1)/Math.max(host.value?.clientHeight??1,1)
  const direction=view.value==='Front'?new THREE.Vector3(0,0,1):view.value==='Right'?new THREE.Vector3(1,0,0):view.value==='Left'?new THREE.Vector3(-1,0,0):view.value==='Top'?new THREE.Vector3(0,1,.01):new THREE.Vector3(1,.75,1)
  camera=view.value==='Perspective'?perspectiveCamera:orthographicCamera
  controls.object=camera
  gizmo.camera=camera
  camera.up.set(0,1,0)
  camera.position.copy(center).add(direction.normalize().multiplyScalar(radius*1.6))
  if(view.value==='Perspective'){
    const perspective=camera as THREE.PerspectiveCamera
    perspective.near=Math.max(.001,radius/1000);perspective.far=Math.max(1000,radius*20);perspective.aspect=aspect;perspective.lookAt(center);perspective.updateProjectionMatrix()
  }else{
    const orthographic=camera as THREE.OrthographicCamera
    orthographicHalfHeight=Math.max(radius*.72,.5);orthographic.near=Math.max(.001,radius/1000);orthographic.far=Math.max(1000,radius*20);orthographic.left=-orthographicHalfHeight*aspect;orthographic.right=orthographicHalfHeight*aspect;orthographic.top=orthographicHalfHeight;orthographic.bottom=-orthographicHalfHeight;orthographic.zoom=1;orthographic.lookAt(center);orthographic.updateProjectionMatrix()
  }
  controls.target.copy(center);controls.update();render()
}
function perspectiveFromCurrentAngle(){
  if(view.value==='Perspective'||!camera||!controls||!perspectiveCamera)return
  const target=controls.target.clone(),direction=camera.position.clone().sub(target)
  if(direction.lengthSq()<1e-8)return
  const distance=Math.max(direction.length(),(orthographicHalfHeight/Math.max((camera as THREE.OrthographicCamera).zoom,1e-6))/Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov/2)))
  navigationGuard=true
  perspectiveCamera.position.copy(target).add(direction.normalize().multiplyScalar(distance))
  perspectiveCamera.up.copy(camera.up)
  perspectiveCamera.aspect=(host.value?.clientWidth??1)/Math.max(host.value?.clientHeight??1,1)
  perspectiveCamera.near=Math.max(.001,distance/1000);perspectiveCamera.far=Math.max(1000,distance*20);perspectiveCamera.lookAt(target);perspectiveCamera.updateProjectionMatrix()
  camera=perspectiveCamera;view.value='Perspective';controls.object=perspectiveCamera;gizmo.camera=perspectiveCamera;controls.target.copy(target);controls.update();navigationGuard=false;render()
}
function snapPerspectiveAxis(){
  if(view.value!=='Perspective'||!camera||!controls)return
  const target=controls.target.clone(),direction=camera.position.clone().sub(target),distance=direction.length()
  if(distance<1e-8)return
  const candidates:[string,THREE.Vector3][]=[
    ['Front',new THREE.Vector3(0,0,1)],['Back',new THREE.Vector3(0,0,-1)],['Right',new THREE.Vector3(1,0,0)],['Left',new THREE.Vector3(-1,0,0)],['Top',new THREE.Vector3(0,1,0)],['Bottom',new THREE.Vector3(0,-1,0)],
  ]
  const chosen=candidates.reduce((best,current)=>current[1].dot(direction.clone().normalize())>best[1].dot(direction.clone().normalize())?current:best,candidates[0]!)
  camera.position.copy(target).add(chosen[1].clone().multiplyScalar(distance))
  camera.up.copy(chosen[0]==='Top'||chosen[0]==='Bottom'?new THREE.Vector3(0,0,chosen[0]==='Top'?-1:1):new THREE.Vector3(0,1,0))
  camera.lookAt(target);(camera as THREE.PerspectiveCamera).updateProjectionMatrix();controls.target.copy(target);controls.update();render()
}
function switchMode(next:'object'|'edit'){cancelGesture();mode.value=next;canvas.value?.focus()}
function switchSelection(next:SelectionMode){
  cancelGesture()
  if(draft.value)selected.value=convertSelection(draft.value.mesh,selectMode.value,next,selected.value)
  selectMode.value=next;mode.value='edit';canvas.value?.focus()
}
function selectAll(clear=false){
  if(!draft.value)return
  selected.value=clear?[]:(selectMode.value==='vertex'?draft.value.mesh.vertices:selectMode.value==='edge'?meshEdges(draft.value.mesh):draft.value.mesh.faces).map(e=>e.id)
}
function deleteSelection(){
  if(mode.value!=='edit'||!selected.value.length||!asset.value||!draft.value){error.value='Select vertices, edges, or faces to delete.';return}
  act(()=>{store.editNativeModel(asset.value!.id,draft.value!.revision,{type:'delete',mode:selectMode.value,ids:[...selected.value]});selected.value=[]})
}
function pick(event:PointerEvent){
  if(event.button===0 && gesture?.kind==='knife' && gesture.operation){skipPick=false;acceptGesture();return}
  if(event.button!==0 || skipPick || gizmo?.dragging || gesture){skipPick=false;return}
  if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>4 || mode.value!=='edit' || !body || !canvas.value || !draft.value)return
  const rect=canvas.value.getBoundingClientRect()
  const ids=pickMeshElements(draft.value.mesh,body,camera,event.altKey?'edge':selectMode.value,{x:event.clientX-rect.left,y:event.clientY-rect.top},rect,xray.value||wire.value)
  const id=ids[0]
  const multi=event.ctrlKey||event.metaKey
  const picked=(xray.value||wire.value)?ids:(id?[id]:[])
  if(event.altKey && id){
    const edges=selectEdgeLoop(draft.value.mesh,id)
    const elements=selectMode.value==='face'?selectFaceLoop(draft.value.mesh,id):selectMode.value==='vertex'?selectionVertices(draft.value.mesh,'edge',edges):edges
    selected.value=multi||event.shiftKey ? (elements.every(e=>selected.value.includes(e))?selected.value.filter(e=>!elements.includes(e)):[...new Set([...selected.value,...elements])]) : elements
    return
  }
  if((multi||event.shiftKey) && picked.length)selected.value=picked.reduce((selection,item)=>selection.includes(item)?selection.filter(value=>value!==item):[...selection,item],[...selected.value])
  else selected.value=picked
}
function startGesture(kind:Gesture['kind']){
  if(!draft.value || !asset.value || gesture)return
  if(kind!=='loop-cut' && kind!=='knife' && !selectedIds.value.length){error.value='Select mesh elements first.';return}
  if(kind==='extrude' && !selectedFaces.value.length){error.value='Select faces in Face mode to extrude a region.';return}
  if(kind==='inset' && !selectedFaces.value.length){error.value='Select faces in Face mode to inset a region.';return}
  error.value='';status.value='';activeGesture.value=true
  pivot.updateMatrixWorld(true)
  gesture={kind,base:cloneDraft(draft.value),assetId:asset.value.id,ids:[...selectedIds.value],faceId:faceId.value,faceIds:selectedFaces.value.map(f=>f.id),pivot:selectionCenter(draft.value.mesh,selectedIds.value),
    start:lastPointer?{...lastPointer}:null,axis:null,exclude:false,typed:'',operation:null,valid:true,startMatrix:pivot.matrixWorld.clone()}
  controls.enabled=false
  if(kind!=='gizmo')gizmo?.detach()
  gestureText.value=kind==='inset'?'INSET REGION · move pointer or type thickness in meters · Enter/click confirm · Esc/right-click cancel':`${kind.toUpperCase()} · move pointer · X/Y/Z: axis · Shift+X/Y/Z: exclude axis (Move/Scale) · type value · Enter/click confirm · Esc/right-click cancel`
  canvas.value?.focus()
  if(kind==='extrude'){
    previewOperation({type:'extrude-region',faceIds:gesture.faceIds,distance:extrusionStartDistance,direction:extrusionOriginDirection})
    gestureText.value='EXTRUDE REGION · move pointer · X/Y/Z: axis · Shift+X/Y/Z: exclude axis · Esc keeps the new cap at its start'
  }
  if(kind==='knife'){
    gesture.valid=false
    gestureText.value='KNIFE · draw across the mesh · X-Ray: cut through · release or Enter commits · Esc cancels'
  }
}
function startEdgeSlide(){
  if(mode.value!=='edit' || selectMode.value==='face'){error.value='Select an edge loop in Edge or Vertex mode to slide.';return}
  const base=gesture?.base??draft.value
  if(!base)return
  const vertices=new Set(selected.value)
  const edges=selectMode.value==='edge'?[...selected.value]:meshEdges(base.mesh).filter(e=>e.vertices.every(v=>vertices.has(v))).map(e=>e.id)
  try{edgeSlideVertices(base.mesh,edges,0)}catch(e){cancelGesture();error.value=e instanceof Error?e.message:String(e);return}
  // The second G switches the existing preview back to its original source; it does not commit a move.
  if(gesture){gesture.kind='edge-slide';gesture.axis=null;gesture.exclude=false;gesture.typed='';gesture.start=lastPointer?{...lastPointer}:null;gesture.operation=null;gesture.valid=true;preview.value=null}
  else startGesture('edge-slide')
  const g=gesture as Gesture|null
  if(!g)return
  g.slideEdges=edges
  gestureText.value='EDGE SLIDE · move pointer · type factor (-0.99 to 0.99) · Enter/click: confirm · Esc: cancel'
}
function clearLoop(){
  loopPickBody?.geometry.dispose();loopPickBody?.material.dispose();loopPickBody=null;loopEdges=[];loopActive.value=false;knifeStroke.value=null
}
function startLoopCut(){
  if(mode.value!=='edit'||!draft.value||gesture)return
  startGesture('loop-cut')
  const g=gesture as Gesture|null
  if(!g)return
  loopActive.value=true;loopStage.value='hover';loopPosition.value=.5
  loopPickBody=new THREE.Mesh(modelGeometry(g.base.mesh),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
  g.valid=false
  gestureText.value='LOOP CUT · hover an edge · wheel: cut count · click: place · Esc: cancel'
}
function previewLoop(){
  const g=gesture
  if(!g || g.kind!=='loop-cut' || !g.edge)return
  const op:ModelOperation={type:'loop-cut',edge:g.edge,cuts:loopCuts.value,position:loopPosition.value}
  try{
    const mesh=cloneDraft(g.base).mesh
    loopEdges=insertQuadLoop(mesh,op).cutEdges
    previewOperation(op)
  }catch(e){loopEdges=[];preview.value=null;g.operation=null;g.valid=false;error.value=e instanceof Error?e.message:String(e)}
  rebuild()
}
function moveLoop(pointer:{x:number;y:number}){
  const g=gesture
  if(!g || !loopPickBody || !canvas.value)return
  if(loopStage.value==='hover'){
    const rect=canvas.value.getBoundingClientRect()
    const id=pickMeshElement(g.base.mesh,loopPickBody,camera,'edge',{x:pointer.x-rect.left,y:pointer.y-rect.top},rect,xray.value||wire.value)
    if(!id){g.edge=undefined;g.operation=null;g.valid=false;loopEdges=[];preview.value=null;error.value='';rebuild();return}
    g.edge=JSON.parse(id) as [string,string];previewLoop()
  }else{
    loopPosition.value=THREE.MathUtils.clamp(loopSlideStart+(pointer.x-(g.start?.x??pointer.x))/300,.01,.99);previewLoop()
  }
}
function acceptGesture(){
  if(gesture?.kind==='loop-cut' && loopStage.value==='hover'){
    if(!gesture.valid || !gesture.operation){error.value='Hover an edge in a connected quad strip first.';return}
    if(loopCuts.value===1){loopSlideStart=loopPosition.value;loopStage.value='slide';gesture.start=lastPointer?{...lastPointer}:null;gestureText.value='LOOP SLIDE · move pointer or set Position · click/Enter: confirm · Esc/right-click: cancel';return}
  }
  if(gesture?.kind==='knife' && !gesture.operation){error.value='Draw a line across the mesh before confirming the knife cut.';return}
  finishGesture()
}
function loopWheel(event:WheelEvent){
  if(!loopActive.value)return
  event.preventDefault();event.stopImmediatePropagation()
  if(loopStage.value==='hover'){loopCuts.value=THREE.MathUtils.clamp(loopCuts.value+(event.deltaY<0?1:-1),1,16);previewLoop()}
}
function knifeProject(position:Vec3,rect:DOMRect):ScreenPoint{
  const projected=new THREE.Vector3(...position).project(camera)
  return {x:(projected.x+1)*rect.width/2,y:(1-projected.y)*rect.height/2}
}
function knifePlaneForStroke(start:ScreenPoint,end:ScreenPoint,rect:DOMRect){
  const first=new THREE.Vector3(start.x/rect.width*2-1,1-start.y/rect.height*2,0),second=new THREE.Vector3(end.x/rect.width*2-1,1-end.y/rect.height*2,0)
  if(camera instanceof THREE.PerspectiveCamera){
    const origin=camera.position.clone(),rayA=first.clone().setZ(-1).unproject(camera).sub(origin).normalize(),rayB=second.clone().setZ(-1).unproject(camera).sub(origin).normalize(),normal=rayA.cross(rayB)
    if(normal.lengthSq()<1e-10)return null
    normal.normalize();return {normal,constant:normal.dot(origin)}
  }
  const pointA=first.unproject(camera),pointB=second.unproject(camera),direction=camera.getWorldDirection(new THREE.Vector3()),normal=pointB.sub(pointA).cross(direction)
  if(normal.lengthSq()<1e-10)return null
  normal.normalize();return {normal,constant:normal.dot(pointA)}
}
function knifePlaneIntersection(start:ScreenPoint,end:ScreenPoint,plane:{normal:THREE.Vector3;constant:number},a:Vec3,b:Vec3,rect:DOMRect){
  const first=new THREE.Vector3(...a),second=new THREE.Vector3(...b),distanceA=plane.normal.dot(first)-plane.constant,distanceB=plane.normal.dot(second)-plane.constant
  if(Math.abs(distanceA)<1e-6&&Math.abs(distanceB)<1e-6)return null
  if(distanceA*distanceB>1e-10)return null
  const edgeT=THREE.MathUtils.clamp(distanceA/(distanceA-distanceB),.002,.998),point=first.lerp(second,edgeT),screen=knifeProject(point.toArray() as Vec3,rect),line={x:end.x-start.x,y:end.y-start.y},length=line.x*line.x+line.y*line.y||1,strokeT=((screen.x-start.x)*line.x+(screen.y-start.y)*line.y)/length,closest={x:start.x+line.x*strokeT,y:start.y+line.y*strokeT}
  if(strokeT<-.0001||strokeT>1.0001||Math.hypot(screen.x-closest.x,screen.y-closest.y)>1.5)return null
  return {strokeT:THREE.MathUtils.clamp(strokeT,0,1),edgeT,point:screen}
}
function knifeVisibleFace(faceId:string,point:ScreenPoint,rect:DOMRect){
  if(xray.value||!body)return true
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(point.x/rect.width*2-1,1-point.y/rect.height*2)
  ray.setFromCamera(ndc,camera)
  const hit=ray.intersectObject(body,false)[0]
  return hit?.faceIndex!=null && body.geometry.userData.faceIds[hit.faceIndex]===faceId
}
function knifeSegmentsAt(start:ScreenPoint,end:ScreenPoint):KnifeSegment[]{
  const g=gesture,rect=canvas.value?.getBoundingClientRect()
  if(!g||g.kind!=='knife'||!rect)return []
  const plane=knifePlaneForStroke(start,end,rect)
  if(!plane)return []
  const positions=new Map(g.base.mesh.vertices.map(vertex=>[vertex.id,vertex.position]))
  const segments:KnifeSegment[]=[]
  for(const face of g.base.mesh.faces){
    const intersections:Array<{strokeT:number;edgeT:number;point:ScreenPoint;edge:[string,string]}>=[]
    for(let index=0;index<face.vertices.length;index++){
      const aId=face.vertices[index]!,bId=face.vertices[(index+1)%face.vertices.length]!,hit=knifePlaneIntersection(start,end,plane,positions.get(aId)!,positions.get(bId)!,rect)
      if(hit && !intersections.some(existing=>Math.hypot(existing.point.x-hit.point.x,existing.point.y-hit.point.y)<.5)) intersections.push({...hit,edge:[aId,bId]})
    }
    intersections.sort((left,right)=>left.strokeT-right.strokeT)
    if(intersections.length<2)continue
    const first=intersections[0]!,last=intersections.at(-1)!,mid={x:(first.point.x+last.point.x)/2,y:(first.point.y+last.point.y)/2}
    if(!knifeVisibleFace(face.id,mid,rect))continue
    segments.push({faceId:face.id,start:{edge:first.edge,t:first.edgeT},end:{edge:last.edge,t:last.edgeT}})
  }
  return segments
}
function previewKnife(){
  const g=gesture
  if(!g||g.kind!=='knife'||!g.knifeStart||!g.knifeEnd)return
  const segments=knifeSegmentsAt(g.knifeStart,g.knifeEnd)
  g.knifeSegments=segments
  if(!segments.length){g.operation=null;g.valid=false;preview.value=null;error.value='Draw a line across the model to create a cut.';return}
  previewOperation({type:'knife',segments,through:xray.value})
}
function updateKnifeHover(pointer:ScreenPoint){
  const g=gesture
  if(!g||g.kind!=='knife'||!g.knifeStart)return
  g.knifeEnd=pointer;knifeStroke.value=[g.knifeStart,pointer];previewKnife();rebuild()
}
function knifeClick(event:PointerEvent){
  const g=gesture
  if(!g||g.kind!=='knife')return
  if(event.button===2){cancelGesture();return}
  if(event.button!==0)return
  if(g.operation){acceptGesture();return}
  const rect=canvas.value?.getBoundingClientRect()
  if(!rect)return
  const point={x:event.clientX-rect.left,y:event.clientY-rect.top}
  if(!g.knifeStart){g.knifeStart=point;g.knifeEnd=point;knifeStroke.value=[point,point];gestureText.value='KNIFE · draw across the mesh · X-Ray: cut through · release or Enter commits · Esc cancels';rebuild();return}
  updateKnifeHover(point)
}
function previewOperation(op:ModelOperation){
  if(!gesture)return
  try{preview.value=applyModelOperation(gesture.base,gesture.base.revision,op);gesture.operation=op;gesture.valid=true;error.value=''}
  catch(e){gesture.valid=false;error.value=e instanceof Error?e.message:String(e)}
}
function screenMove(g:Gesture,dx:number,dy:number){
  const height=Math.max(host.value?.clientHeight??1,1)
  const perPixel=camera instanceof THREE.OrthographicCamera
    ? (camera.top-camera.bottom)/(height*Math.max(camera.zoom,1e-6))
    : 2*camera.position.distanceTo(g.pivot)*Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov/2))/height
  const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1)
  return {delta:right.multiplyScalar(dx*perPixel).add(up.multiplyScalar(-dy*perPixel)),perPixel}
}
function updateGesture(pointer=lastPointer,precise=false){
  const g=gesture
  if(!g || g.kind==='gizmo')return
  if(g.kind==='loop-cut'){if(pointer)moveLoop(pointer);return}
  if(g.kind==='knife'){
    if(pointer&&canvas.value){const rect=canvas.value.getBoundingClientRect();updateKnifeHover({x:pointer.x-rect.left,y:pointer.y-rect.top})}
    return
  }
  if(!g.start && pointer)g.start={...pointer}
  const dx=((pointer?.x??0)-(g.start?.x??0))*(precise ? .1 : 1),dy=((pointer?.y??0)-(g.start?.y??0))*(precise ? .1 : 1)
  if(g.typed!=='' && !Number.isFinite(Number(g.typed))){g.valid=false;error.value='Enter a valid numeric value, or Backspace to clear it.';return}
  const numeric=g.typed!==''?Number(g.typed):null
  if(g.kind==='edge-slide'){
    const factor=numeric??THREE.MathUtils.clamp(dx/300,-.99,.99)
    previewOperation({type:'edge-slide',edgeIds:g.slideEdges??[],factor})
    gestureText.value=`EDGE SLIDE ${factor.toFixed(3)} · type factor · Enter/click confirm · Esc/right-click cancel`
    return
  }
  const {delta,perPixel}=screenMove(g,dx,dy)
  const axis=g.axis?axes[g.axis]:null
  if(g.kind==='extrude'){
    const requested=numeric??(dx-dy)*perPixel
    const value=Math.abs(requested)<extrusionStartDistance ? (requested<0 ? -extrusionStartDistance : extrusionStartDistance) : requested
    previewOperation({type:'extrude-region',faceIds:g.faceIds,distance:value,direction:axis?axis.toArray() as Vec3:undefined})
  }else if(g.kind==='inset'){
    const value=numeric??Math.max(0,dx*perPixel)
    if(Math.abs(value)<.000001){preview.value=null;g.operation=null;g.valid=true;error.value='';return}
    previewOperation({type:'inset-region',faceIds:g.faceIds,thickness:value})
  }else{
    const matrix=new THREE.Matrix4()
    if(g.kind==='translate'){
      if(axis && !g.exclude){const screenAxis=axis.clone().projectOnPlane(camera.getWorldDirection(new THREE.Vector3()));const amount=numeric??(screenAxis.lengthSq()<.02?-dy*perPixel:delta.dot(axis));delta.copy(axis).multiplyScalar(amount)}
      else delta.copy(constrainedMove(delta,g,numeric))
      matrix.makeTranslation(delta)
    }else{
      const transform=new THREE.Matrix4()
      if(g.kind==='rotate')transform.makeRotationAxis(axis??camera.getWorldDirection(new THREE.Vector3()),THREE.MathUtils.degToRad(numeric??dx*.6))
      else{const value=numeric??Math.exp(dx/150);const factors=constrainedScale(value,g);transform.makeScale(factors.x,factors.y,factors.z)}
      matrix.makeTranslation(g.pivot).multiply(transform).multiply(new THREE.Matrix4().makeTranslation(g.pivot.clone().negate()))
    }
    previewOperation({type:'set-positions',vertices:transformedVertices(g.base.mesh,g.ids,matrix)})
  }
  gestureText.value=`${g.kind.toUpperCase()} ${g.kind==='inset'?'Thickness (m)':constraintLabel(g)} ${g.typed} · Enter/click confirm · Esc/right-click cancel`
}
function finishGesture(){
  if(!gesture)return
  if(!gesture.valid){error.value='Cannot apply this transform: adjust it or press Escape.';return}
  const g=gesture
  const cutSelection=loopEdges.map(([a,b])=>topologyEdgeKey(a,b))
  const knifeNewFaces=g.kind==='knife'&&preview.value ? preview.value.mesh.faces.filter(face=>!g.base.mesh.faces.some(previous=>previous.id===face.id)).map(face=>face.id) : []
  clearLoop()
  gesture=null;activeGesture.value=false;preview.value=null;controls.enabled=true
  if(g.operation)act(()=>{
    store.editNativeModel(g.assetId,g.base.revision,g.operation!)
    if(g.kind==='loop-cut'){selectMode.value='edge';selected.value=cutSelection}
    if(g.kind==='knife'){selectMode.value='face';selected.value=[...new Set([...(g.knifeSegments??[]).map(segment=>segment.faceId),...knifeNewFaces])]}
  })
  rebuild()
}
function cancelGesture(keepExtrusion=false){
  if(!gesture)return
  const g=gesture
  if(keepExtrusion && g.kind==='extrude'){
    const origin:ModelOperation={type:'extrude-region',faceIds:g.faceIds,distance:extrusionStartDistance,direction:extrusionOriginDirection}
    clearLoop();gesture=null;activeGesture.value=false;preview.value=null
    if(controls)controls.enabled=true
    if(gizmo?.dragging){gizmo.reset();gizmo.dragging=false}
    act(()=>store.editNativeModel(g.assetId,g.base.revision,origin))
    selected.value=[...g.faceIds]
    rebuild()
    return
  }
  clearLoop()
  gesture=null;activeGesture.value=false;preview.value=null
  if(controls)controls.enabled=true
  if(gizmo?.dragging){gizmo.reset();gizmo.dragging=false}
  error.value='';rebuild()
}
function cancelPointer(){cancelGesture()}
function cancelButton(){cancelGesture()}
function pointerDown(event:PointerEvent){
  canvas.value?.focus()
  if(gesture && gesture.kind!=='gizmo'){
    if(gesture.kind==='knife' && event.button===0)knifeClick(event)
    else if(event.button===0)acceptGesture();else if(event.button===2)cancelGesture()
    event.preventDefault();event.stopImmediatePropagation();skipPick=true;return
  }
  down={x:event.clientX,y:event.clientY};lastPointer={...down}
  orbitMoved=false;orbitAlt=event.altKey;orbitButton=event.button
  // Both viewports use the same unmodified orbit/pan mapping.
}
function pointerMove(event:PointerEvent){
  lastPointer={x:event.clientX,y:event.clientY}
  if(!gesture && Math.hypot(event.clientX-down.x,event.clientY-down.y)>4){orbitMoved=true;orbitAlt=orbitAlt||event.altKey}
  if(gesture && gesture.kind!=='gizmo')updateGesture(lastPointer,event.shiftKey)
}
function key(event:KeyboardEvent){
  if((event.target as HTMLElement).tagName!=='CANVAS')return
  if(gesture){
    if(event.key==='Escape'){event.preventDefault();cancelGesture(true);return}
    if(event.key.toLowerCase()==='g' && gesture.kind==='translate'){event.preventDefault();event.stopPropagation();if(!event.repeat)startEdgeSlide();return}
    if(gesture.kind==='gizmo')return
    event.preventDefault();event.stopPropagation()
    if(event.key==='Enter'){acceptGesture();return}
    if(gesture.kind==='loop-cut'||gesture.kind==='knife')return
    const axis=event.key.toLowerCase()
    if(['translate','scale','rotate','extrude'].includes(gesture.kind) && (axis==='x'||axis==='y'||axis==='z')){
      if(!event.repeat)Object.assign(gesture,toggleConstraint(gesture,axis,event.shiftKey && (gesture.kind==='translate'||gesture.kind==='scale')))
    }
    else if(/^[0-9.\-]$/.test(event.key))gesture.typed+=event.key
    else if(event.key==='Backspace')gesture.typed=gesture.typed.slice(0,-1)
    updateGesture();return
  }
  if((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='r'){event.preventDefault();event.stopPropagation();startLoopCut();return}
  if(event.ctrlKey||event.metaKey)return
  const k=event.key.toLowerCase()
  if(k==='tab'){event.preventDefault();switchMode(mode.value==='edit'?'object':'edit')}
  else if(['1','2','3'].includes(k)){event.preventDefault();switchSelection(k==='1'?'vertex':k==='2'?'edge':'face')}
  else if(k==='a'){event.preventDefault();selectAll(event.altKey)}
  else if(k==='g'||k==='r'||k==='s'){event.preventDefault();startGesture(k==='g'?'translate':k==='r'?'rotate':'scale')}
  else if(k==='e'||k==='i'){event.preventDefault();startGesture(k==='e'?'extrude':'inset')}
  else if(k==='k'){event.preventDefault();startGesture('knife')}
  else if(k==='x'||event.key==='Delete'){event.preventDefault();deleteSelection()}
  else if(k==='z' && event.altKey){event.preventDefault();xray.value=!xray.value}
  else if(k==='z'){event.preventDefault();wire.value=!wire.value}
  else if(k==='.')frame()
  else if(k==='escape')selected.value=[]
}
watch(()=>asset.value?.id,()=>{cancelGesture();selected.value=[];error.value='';status.value='';rebuild();frame()})
watch(draft,()=>{if(gesture)cancelGesture();if(draft.value){const valid=new Set((selectMode.value==='vertex'?draft.value.mesh.vertices:selectMode.value==='edge'?meshEdges(draft.value.mesh):draft.value.mesh.faces).map(e=>e.id));selected.value=selected.value.filter(id=>valid.has(id))}},{deep:true})
watch([displayed,selected,mode,selectMode,wire,xray,tool],rebuild,{deep:true})
watch(xray,()=>{if(gesture?.kind==='knife'&&gesture.knifeStart&&gesture.knifeEnd){previewKnife();rebuild()}})
watch(models,()=>{if(!asset.value)store.selectedModelAssetId=models.value[0]?.id??''})
onMounted(()=>{
  try{
    renderer=new THREE.WebGLRenderer({canvas:canvas.value,antialias:true,preserveDrawingBuffer:true})
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setClearColor('#10141c');renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping
    perspectiveCamera=new THREE.PerspectiveCamera(40,1,.01,1000)
    orthographicCamera=new THREE.OrthographicCamera(-5.5,5.5,5.5,-5.5,.01,1000)
    camera=perspectiveCamera
    controls=new OrbitControls(camera,canvas.value)
    configureViewportNavigation(controls)
    controls.addEventListener('change',()=>{if(!navigationGuard&&view.value!=='Perspective'&&orbitMoved&&orbitButton===0)perspectiveFromCurrentAngle();render()})
    controls.addEventListener('end',()=>{if(orbitMoved&&orbitAlt&&orbitButton===0)snapPerspectiveAxis();orbitMoved=false;orbitAlt=false;orbitButton=0})
    scene.add(content,pivot,new THREE.HemisphereLight('#e4ebff','#343943',2.5))
    const light=new THREE.DirectionalLight('#ffffff',3);light.position.set(4,7,5);scene.add(light)
    scene.add(new THREE.GridHelper(20,20,'#46516b','#252d3b'))
    gizmo=new TransformControls(camera,canvas.value);gizmo.setSize(.85);scene.add(gizmo.getHelper())
    gizmo.addEventListener('change',render)
    gizmo.addEventListener('mouseDown',()=>{skipPick=true;startGesture('gizmo')})
    gizmo.addEventListener('objectChange',()=>{
      if(!gesture || gesture.kind!=='gizmo')return
      pivot.updateMatrixWorld(true)
      const delta=pivot.matrixWorld.clone().multiply(gesture.startMatrix.clone().invert())
      previewOperation({type:'set-positions',vertices:transformedVertices(gesture.base.mesh,gesture.ids,delta)})
    })
    gizmo.addEventListener('mouseUp',()=>{if(gesture?.kind==='gizmo'){if(gesture.valid)finishGesture();else cancelGesture()}})
    gizmo.addEventListener('dragging-changed',()=>{if(!gizmo.dragging){syncGizmo();render()}})
    observer=new ResizeObserver(()=>{if(!host.value||!renderer)return;const {width,height}=host.value.getBoundingClientRect(),aspect=width/Math.max(height,1);renderer.setSize(width,height,false);if(view.value==='Perspective'){const perspective=camera as THREE.PerspectiveCamera;perspective.aspect=aspect;perspective.updateProjectionMatrix()}else{const orthographic=camera as THREE.OrthographicCamera;orthographic.left=-orthographicHalfHeight*aspect;orthographic.right=orthographicHalfHeight*aspect;orthographic.top=orthographicHalfHeight;orthographic.bottom=-orthographicHalfHeight;orthographic.updateProjectionMatrix()}render()})
    observer.observe(host.value!)
    if(!asset.value)store.selectedModelAssetId=models.value[0]?.id??''
    rebuild();frame()
  }catch(e){error.value=`Viewport unavailable: ${e instanceof Error?e.message:e}`}
})
onBeforeUnmount(()=>{clearLoop();gesture=null;observer?.disconnect();controls?.dispose();gizmo?.dispose();clearContent();scene.traverse(o=>{if(o instanceof THREE.GridHelper){o.geometry.dispose();(o.material as THREE.Material).dispose()}});renderer?.dispose()})
</script>

<template>
  <section class="modeling-workspace">
    <aside class="model-library">
      <header><Box :size="16" /><strong>Modeling</strong><span>Project assets</span></header>
      <div class="new-buttons"><button @click="create('cube')"><Plus :size="13" /> Cube</button><button @click="create('plane')"><Plus :size="13" /> Plane</button></div>
      <p class="muted">Select vertices, edges, or faces. Shape them directly in the viewport, then save your model.</p>
      <button v-for="model in models" :key="model.id" class="model-item" :class="{active:model.id===asset?.id}" @click="store.selectedModelAssetId=model.id">
        <img v-if="model.thumbnail" :src="model.thumbnail" alt="" /><Box v-else :size="22" />
        <span><strong>{{ model.name }}</strong><small>{{ model.nativeModel!.revisions.length ? `Published r${model.nativeModel!.revisions.at(-1)!.revision}` : 'Unpublished draft' }}</small></span>
      </button>
      <div class="library-footer">Native editable models · Y up · meters</div>
    </aside>
    <div class="model-main">
      <div class="model-toolbar">
        <button :class="{active:mode==='object'}" @click="switchMode('object')">Object</button><button :class="{active:mode==='edit'}" @click="switchMode('edit')">Edit Mode <kbd>Tab</kbd></button>
        <template v-if="mode==='edit'"><span class="divider" /><button v-for="(item,i) in (['vertex','edge','face'] as const)" :key="item" :class="{active:selectMode===item}" @click="switchSelection(item)">{{ item==='vertex'?'Vertices':item==='edge'?'Edges':'Faces' }} <kbd>{{ i+1 }}</kbd></button></template>
        <span class="divider" /><button v-for="item in (['translate','rotate','scale'] as const)" :key="item" :class="{active:tool===item}" :disabled="activeGesture" :title="`${item} gizmo for selected ${mode==='object'?'object':selectMode+' elements'}`" @click="tool=item;canvas?.focus()">{{ item==='translate'?'Move':item==='rotate'?'Rotate':'Scale' }}</button>
        <span class="divider" /><button title="Undo" :disabled="!store.canUndo" @click="store.undo()"><Undo2 :size="14" /></button><button title="Redo" :disabled="!store.canRedo" @click="store.redo()"><Redo2 :size="14" /></button>
        <button @click="frame()">Frame</button><button :class="{active:view==='Perspective'}" @click="frame('Perspective')">Perspective</button><button :class="{active:view==='Front'}" @click="frame('Front')">Front</button><button :class="{active:view==='Top'}" @click="frame('Top')">Top</button><button :class="{active:view==='Right'}" @click="frame('Right')">Right</button><button :class="{active:view==='Left'}" @click="frame('Left')">Left</button>
        <button :class="{active:wire}" @click="wire=!wire">Quad Wire</button><button :class="{active:xray}" @click="xray=!xray">X-Ray</button><button :class="{active:debugOpen}" @click="debugOpen=!debugOpen">Debug</button>
      </div>
      <div ref="host" class="model-viewport">
        <canvas ref="canvas" tabindex="0" aria-label="Modeling viewport. Left click selects; left drag orbits; middle/right drag pans. 1 vertices, 2 edges, 3 faces. G move, R rotate, S scale, E extrude, I inset, K knife stroke. Alt click selects loops; G then G slides selected edges." @wheel.capture="loopWheel" @pointerdown.capture="pointerDown" @pointermove="pointerMove" @pointerup="pick" @pointercancel="cancelPointer" @contextmenu.prevent @keydown="key" />
        <svg v-if="knifeStroke" class="knife-stroke" :viewBox="`0 0 ${host?.clientWidth ?? 1} ${host?.clientHeight ?? 1}`" preserveAspectRatio="none" aria-hidden="true"><line :x1="knifeStroke[0].x" :y1="knifeStroke[0].y" :x2="knifeStroke[1].x" :y2="knifeStroke[1].y" /></svg>
        <section v-if="debugOpen" class="debug-panel" :class="{resizing:debugResizing}" :style="{height:`${debugHeight}px`}" aria-label="Modeling debug panel">
          <div class="debug-resize" @pointerdown.stop="beginDebugResize" title="Drag to resize debug panel" />
          <header><strong>Debug Console</strong><span>Modeling workspace</span><button @click="debugLines=[]">Clear</button><button aria-label="Hide debug panel" @click="debugOpen=false">Hide</button></header>
          <div class="debug-body"><div v-if="error" class="debug-line error">ERROR  {{ error }}</div><div v-if="status" class="debug-line status">STATUS  {{ status }}</div><div v-for="line in debugLines" :key="line" class="debug-line">{{ line }}</div><div v-if="!error&&!status&&!debugLines.length" class="debug-empty">No diagnostics. Modeling commands and validation messages appear here.</div><div v-if="statistics" class="debug-meta">{{ statistics.vertices }} vertices · {{ statistics.edges }} edges · {{ statistics.faces }} faces · {{ statistics.boundaryEdges }} boundary edges</div></div>
        </section>
        <div class="viewport-tools" aria-label="Mesh tools">
          <button v-for="item in (['select','translate','rotate','scale'] as const)" :key="item" :disabled="activeGesture" :class="{active:tool===item}" @click="tool=item; canvas?.focus()">{{ item==='translate'?'Move':item.charAt(0).toUpperCase()+item.slice(1) }}</button>
          <button :disabled="!selectedFaces.length || activeGesture" @click="startGesture('extrude')">Extrude <kbd>E</kbd></button>
          <button :disabled="!selectedFaces.length || activeGesture" @click="startGesture('inset')">Inset <kbd>I</kbd></button>
          <button :disabled="mode!=='edit' || activeGesture" @click="startGesture('knife')">Knife <kbd>K</kbd></button>
          <button :disabled="!selected.length || mode!=='edit' || activeGesture" @click="deleteSelection">Delete <kbd>X</kbd></button>
          <button :disabled="!selectedIds.length || mode!=='edit' || selectMode==='face' || activeGesture" @click="startEdgeSlide">Slide <kbd>G G</kbd></button>
          <button :disabled="!draft || mode!=='edit' || activeGesture" @click="startLoopCut">Loop Cut <kbd>Ctrl R</kbd></button>
        </div>
        <div class="viewport-label">{{ asset?.name ?? 'New model' }} <span v-if="draft">/ Draft r{{ draft.revision }}</span></div>
        <div v-if="!asset" class="empty-state"><Box :size="40" /><h2>Build something of your own</h2><p>Start with a primitive. Shape it. Save it to your project.</p><button @click="create('cube')">Create Cube Model</button></div>
        <div class="viewport-help">{{ activeGesture ? gestureText : 'Select: click · Ctrl-click: multi-select · Alt-click: loop · K: knife · X/Delete: remove · X-Ray: select through · Orbit: left-drag · Pan: middle/right-drag · Wheel: zoom' }}</div>
      </div>
      <div class="model-status"><span v-if="statistics">{{ statistics.vertices }} vertices · {{ statistics.edges }} edges · {{ statistics.faces }} faces · {{ statistics.boundaryEdges }} boundary edges</span><span v-else>Ready to model</span><span>{{ mode==='object' ? 'Object mode' : `${selected.length} ${selectMode} selected` }}</span></div>
    </div>
    <aside class="model-properties">
      <header><strong>Model properties</strong></header>
      <div v-if="activeGesture" class="gesture-actions"><strong>{{ gestureText }}</strong><button @click="acceptGesture">Confirm</button><button @click="cancelButton">Cancel</button></div>
      <section v-if="loopActive"><h3>Loop Cut</h3><label>Cuts<input v-model.number="loopCuts" type="number" min="1" max="16" :disabled="loopStage==='slide'" @input="previewLoop" /></label><label v-if="loopCuts===1">Position (0–1)<input v-model.number="loopPosition" type="number" min="0.01" max="0.99" step="0.01" @input="previewLoop" /></label><p class="muted">Hover an edge to preview the connected quad strip. Multiple cuts are evenly spaced.</p></section>
      <p class="muted">Drag the colored gizmo handles to transform your selection. Choose Move, Rotate or Scale above the viewport. Ctrl-click selects additional elements. Alt-click an edge selects its loop; Ctrl+Alt-click adds or removes a loop. K draws a Knife stroke anywhere in the viewport; X-Ray includes hidden and backside faces in that cut. G, G slides selected edges along the mesh. G / R / S starts a transform; X / Y / Z restricts an axis; Shift+X / Y / Z excludes it during Move or Scale. X/Delete removes the current vertices, edges, or faces. Type a value and press Enter. Escape cancels movement; during extrusion it keeps the new cap at its start.</p>
      <template v-if="asset && draft">
        <label>Name<input :value="asset.name" maxlength="128" @change="rename" /></label>
        <label>Surface color<input type="color" :value="draft.color" @change="operation({type:'color',color:($event.target as HTMLInputElement).value})" /></label>
        <section v-if="mode==='edit' && selectMode==='face'"><h3>Selected faces ({{ selectedFaces.length }})</h3><select v-model="faceId" aria-label="Select polygon"><option value="">Select a face in the viewport</option><option v-for="face in draft.mesh.faces" :key="face.id" :value="face.id">Face {{ face.id }}</option></select>
          <label>Extrude distance (m)<input v-model.number="distance" type="number" step="0.1" /></label><button :disabled="!selectedFaces.length || activeGesture" @click="extrude">Extrude region <kbd>E</kbd></button>
          <label>Inset thickness (m)<input v-model.number="thickness" type="number" min="0.000001" step="0.05" /></label><button :disabled="!selectedFaces.length || activeGesture" @click="inset">Inset region <kbd>I</kbd></button>
        </section>
        <section><h3>{{ mode==='edit' ? 'Move selection' : 'Move all vertices' }}</h3><div class="vector"><label v-for="(axis,i) in ['X','Y','Z']" :key="axis">{{ axis }}<input v-model.number="offset[i]" type="number" step="0.1" /></label></div><button :disabled="!selectedIds.length || activeGesture" @click="translate">Move (meters)</button></section>
        <section><h3>Scale model</h3><div class="vector"><label v-for="(axis,i) in ['X','Y','Z']" :key="axis">{{ axis }}<input v-model.number="scale[i]" type="number" min="0.001" step="0.1" /></label></div><button @click="operation({type:'scale',factors:scale})">Apply scale</button></section>
        <section class="publish"><h3>Project asset</h3><p class="muted">Draft edits autosave with your project. Publishing creates a revision for scene instances.</p><button class="primary" @click="publish"><Save :size="13" /> Save as Asset</button><button :disabled="!asset.nativeModel?.revisions.length" @click="place"><ArrowUpRight :size="14" /> Place in 3D Scene</button><small v-if="asset.nativeModel?.revisions.length">Latest published: r{{ asset.nativeModel.revisions.at(-1)!.revision }}</small></section>
      </template>
      <p v-else class="muted">Create or select a model to edit its geometry.</p>
    </aside>
  </section>
</template>

<style scoped>
.modeling-workspace { display:grid; grid-template-columns:210px minmax(360px,1fr) 250px; height:100%; min-height:0; background:var(--bg-panel); }
header { display:flex; align-items:center; gap:8px; min-height:43px; padding:12px; border-bottom:1px solid var(--border-subtle); } header span { margin-left:auto; color:var(--text-muted); font-size:10px; }
.model-library,.model-properties { min-height:0; overflow:auto; } .model-library { border-right:1px solid var(--border-subtle); display:flex; flex-direction:column; }.model-properties { border-left:1px solid var(--border-subtle); padding-bottom:14px; }
button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:28px; border:1px solid var(--border-strong); border-radius:4px; padding:5px 9px; background:var(--bg-panel-alt); color:var(--text-secondary); font-size:11px; cursor:pointer; }button:hover:not(:disabled) { background:var(--bg-hover); color:var(--text-primary); }button.active { background:var(--bg-selected); border-color:var(--accent-border); color:var(--accent); }button:disabled { opacity:.4; cursor:default; }
.new-buttons { display:flex; gap:7px; padding:12px 12px 0; }.new-buttons button { flex:1; }.muted { color:var(--text-muted); font-size:11px; line-height:1.6; margin:12px; }
.model-item { margin:3px 8px; justify-content:flex-start; text-align:left; padding:9px; gap:10px; min-height:54px; }.model-item img { width:45px; height:32px; object-fit:cover; border-radius:3px; }.model-item span { min-width:0; display:grid; gap:5px; }.model-item strong { overflow:hidden; text-overflow:ellipsis; }.model-item small { color:var(--text-muted); font-size:10px; }.library-footer { margin-top:auto; padding:15px 12px; color:var(--text-muted); font-size:10px; border-top:1px solid var(--border-subtle); }
.model-main { display:flex; flex-direction:column; min-width:0; min-height:0; }.model-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding:7px; border-bottom:1px solid var(--border-subtle); }.divider { width:1px; height:20px; background:var(--border-subtle); margin:0 3px; }.model-viewport { position:relative; flex:1; min-height:0; overflow:hidden; }canvas { display:block; width:100%; height:100%; touch-action:none; outline:none; }.knife-stroke { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; }.knife-stroke line { stroke:#ffd34e; stroke-width:2; stroke-dasharray:6 4; vector-effect:non-scaling-stroke; }.viewport-label,.viewport-help { position:absolute; pointer-events:none; color:#adb5c6; font-size:10px; background:#10141ccc; padding:6px 8px; border-radius:3px; }.viewport-label { top:12px; left:112px; }.viewport-label span { color:#6e7c95; }.viewport-help { bottom:12px; left:12px; right:12px; text-align:center; font-size:9px; }
.debug-panel { position:absolute; z-index:20; right:0; bottom:0; left:0; display:flex; min-height:90px; flex-direction:column; overflow:hidden; color:#c5cbe0; background:#0d1016f5; border-top:1px solid #4b5270; box-shadow:0 -8px 24px #0008; }.debug-panel > header { display:flex; height:29px; min-height:29px; align-items:center; gap:7px; padding:0 8px; background:#171b26; border-bottom:1px solid #2d3345; font-size:10px; }.debug-panel > header span { margin-left:auto; color:#77819b; font-size:9px; }.debug-panel > header button { min-height:20px; padding:2px 7px; color:#aeb6d0; background:#202638; border:1px solid #3a435b; font-size:9px; }.debug-panel > header button:hover { color:#f0f2ff; background:#2a3350; }.debug-resize { position:absolute; z-index:1; top:-4px; right:0; left:0; height:8px; cursor:ns-resize; }.debug-resize::after { display:block; width:42px; height:2px; margin:2px auto 0; background:#64709a; border-radius:2px; content:''; }.debug-body { min-height:0; flex:1; overflow:auto; padding:7px 10px 10px; font:10px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }.debug-line { white-space:pre-wrap; }.debug-line.error { color:#ef9b9b; }.debug-line.status { color:#9dd7b0; }.debug-empty { color:#69738c; }.debug-meta { margin-top:7px; padding-top:5px; color:#69738c; border-top:1px solid #242b3a; font-size:9px; }
.model-status { display:flex; justify-content:space-between; gap:8px; padding:8px 12px; color:var(--text-muted); font-size:10px; border-top:1px solid var(--border-subtle); }.message { margin:0; padding:12px; color:var(--success); background:var(--bg-input); }.message.error { color:var(--danger); }.empty-state { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#10141cd9; color:var(--text-secondary); }.empty-state h2 { color:var(--text-primary); font-size:19px; margin-bottom:0; }.empty-state p { color:var(--text-muted); }
.model-properties>label { margin:14px 12px; }label { display:flex; flex-direction:column; gap:7px; color:var(--text-secondary); font-size:11px; }input,select { width:100%; min-width:0; height:28px; border:1px solid var(--border-strong); border-radius:3px; padding:4px 6px; background:var(--bg-input); color:var(--text-primary); font-size:11px; }input[type=color] { padding:2px; }section section { border-top:1px solid var(--border-subtle); padding:12px; display:grid; gap:9px; }h3 { margin:0 0 3px; font-size:11px; font-weight:600; }.vector { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }.publish .muted { margin:0; }.publish small { color:var(--text-muted); }.primary { background:var(--bg-selected); color:var(--accent); border-color:var(--accent-border); }kbd { margin-left:auto; color:var(--text-muted); font:inherit; }
.viewport-tools { position:absolute; top:12px; left:10px; display:grid; gap:5px; width:90px; }.viewport-tools button { background:var(--bg-panel); box-shadow:0 2px 5px #0003; justify-content:space-between; }.viewport-tools button.active { background:var(--bg-selected); }.gesture-actions { display:grid; gap:8px; padding:12px; color:var(--accent); font-size:11px; line-height:1.5; }.model-properties :disabled { opacity:.4; }
</style>
