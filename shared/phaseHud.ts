import type { AnimatableProperty, Aurora3DObject, Aurora3DScene, MediaAsset, SerializedEditorState, Transform3D } from '../src/models/editor.ts'

const p=(id:string,value:number,keys:number[][]=[]):AnimatableProperty<number>=>({id,value,animated:keys.length>0,keyframes:keys.map(([time,value],i)=>({id:`${id}-${i}`,time:time!,value:value!,interpolation:'bezier'}))})
function transform(id:string,x=0,y=0,z=0,s=1):Transform3D {
  const vec=(name:string,v:number[])=>({x:p(`${id}-${name}x`,v[0]!),y:p(`${id}-${name}y`,v[1]!),z:p(`${id}-${name}z`,v[2]!)})
  return {position:vec('p',[x,y,z]),rotation:vec('r',[0,0,0]),scale:vec('s',[s,s,s])}
}

/** Shared browser/MCP preset: individual texture cards, live meters and a keyframed lens. */
export function createPhaseHudProject(name='PHASE / Tactical telemetry',id=crypto.randomUUID()):SerializedEditorState {
  const objects:Aurora3DObject[]=[],assets:MediaAsset[]=[]
  const cyan='#09dfcf',orange='#ff592b',white='#c3d2d2'
  const text=(x:number,y:number,t:string,size=16,color=white)=>`<text x="${x}" y="${y}" fill="${color}" font-family="monospace" font-size="${size}" letter-spacing="1.5">${t}</text>`
  const line=(x:number,y:number,xx:number,yy:number,c='#164240',w=1)=>`<path d="M${x} ${y}L${xx} ${yy}" stroke="${c}" stroke-width="${w}" fill="none"/>`
  const rect=(x:number,y:number,w:number,h:number,c:string,fill='none')=>`${fill===cyan||fill===orange?`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" filter="url(#bloom)" opacity=".55"/>`:''}<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${c}" fill="${fill}"/>`
  function card(id:string,label:string,w:number,h:number,body:string,x:number,y:number,z=0,worldWidth=w/100){
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><filter id="bloom" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter></defs>${body}</svg>`
    const assetId=`asset-${id}`
    assets.push({id:assetId,name:label,kind:'image',mimeType:'image/svg+xml',dimensions:`${w} × ${h}`,thumbnail:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`})
    const o:Aurora3DObject={id,name:label,type:'mesh',primitive:'plane',assetId,visible:true,locked:false,castShadow:false,receiveShadow:false,transform:transform(id,x,y,z,worldWidth/(w>=h?2:2*w/h)),influences:[],material:{baseColor:'#ffffff',emissive:'#ffffff',emissiveIntensity:p(`${id}-glow`,1),metalness:p(`${id}-metal`,0),roughness:p(`${id}-rough`,1),opacity:p(`${id}-alpha`,1),maps:{emissiveMap:assetId}}}
    objects.push(o);return o
  }
  let grid=''
  for(let x=0;x<1800;x+=100)grid+=line(x,0,x,2200,x%300===0?'#133333':'#0b1e20')
  for(let y=0;y<2200;y+=100)grid+=line(0,y,1800,y,y%300===0?'#123434':'#0b1e20')
  for(let i=0;i<26;i++){const x=30+(i*137)%1650,y=30+(i*211)%1950;grid+=`<path d="M${x} ${y}h110v70h-30v110h180" fill="none" stroke="${i%3?'#173737':'#3c211d'}" stroke-width="2"/>`+text(x+5,y-8,`BUS.${String(i).padStart(2,'0')} // ${(i*791)%9999}`,8,'#24514f')}
  // Sparse stable phosphor noise, kept in one texture rather than thousands of scene objects.
  for(let i=0;i<3200;i++)grid+=rect((i*439)%1800,(i*733)%2200,1,1,i%2?'#1a2527':'#0e3835')
  card('circuit-substrate','01 / Circuit substrate',1800,2200,grid,0,0,-2)
  let schematic=`<circle cx="580" cy="680" r="410" fill="none" stroke="#183235" stroke-width="2"/><circle cx="580" cy="680" r="310" fill="none" stroke="#173135" stroke-dasharray="8 16"/>`
  schematic+=`<path d="M110 100L1030 1260M-50 1030L1130 220M580 0V1360M0 680H1160" fill="none" stroke="#193638"/>`
  for(let i=0;i<24;i++){const a=i*Math.PI/12,x=580+410*Math.cos(a),y=680+410*Math.sin(a);schematic+=line(x-5,y,x+5,y,'#446562')+line(x,y-5,x,y+5,'#446562')}
  card('radar','02 / Orbital routing diagram',1160,1360,schematic,-2,-1,-1)
  function module(index:number,x:number,y:number,title:string){
    let b=rect(0,0,630,310,'#21504b')+rect(1,1,628,308,'none','#050d10')
    b+=rect(0,0,630,2,cyan,cyan)+text(20,32,`0${index} / ${title}`,18)+text(20,59,'TACTICAL INTERFACE     [ ONLINE ]',9,'#47736c')
    b+=rect(20,80,365,39,cyan,cyan)+text(30,106,'PHASE SELECT 0'+index,18,'#032524')
    b+=text(34,151,'SYNC',12)+text(130,151,'98.42',14)+text(34,180,'FEED',12)+text(130,180,'ACTIVE',14)
    b+=`<circle cx="22" cy="147" r="4" fill="${white}"/><circle cx="22" cy="176" r="4" fill="${cyan}"/>`
    b+=rect(428,80,173,192,'#315054')+text(444,103,'SIGNAL / dB',10)
    for(let j=0;j<12;j++)b+=line(445,125+j*11,455,125+j*11,'#657774')+line(578,125+j*11,585,125+j*11,'#365651')
    for(let j=0;j<8;j++)b+=rect(24+j*46,230,28,16,j<6?'#23574e':'#2c2923',j<6?'#133d36':'none')
    b+=text(22,283,'RX  008.731 / TX  021.660',10,'#69817e')
    card(`module-${index}`,`03 / ${title}`,630,310,b,x,y,.08)
    const nearY=(v:number)=>(v-1.65)*.92+1.65
    const scan=card(`scan-${index}`,`Scan cursor ${index}`,160,5,rect(0,0,160,5,orange,orange),(x+1.995+.625)*.92-.625,nearY(y+.26),1.3,1.48)
    scan.transform.position.y=p(`scan-${index}-y`,nearY(y+.26),[[0,nearY(y+.26)],[3,nearY(y-.91)],[6,nearY(y+.26)],[9,nearY(y-.91)],[12,nearY(y+.26)]])
    const pulse=card(`pulse-${index}`,`Signal activity ${index}`,17,17,`<circle cx="8" cy="8" r="6" fill="${cyan}"/>`,(x-2.93+.625)*.92-.625,nearY(y-.21),1.4,.15)
    pulse.material.opacity=p(`pulse-${index}-alpha`,1,[[0,1],[1,.2],[2,1],[4,.3],[6,1],[8,.2],[10,1],[12,1]])
  }
  module(1,1.7,5,'UPLINK ARRAY')
  module(2,2,-2.4,'PHASE SELECTOR')
  for(const [i,x,y] of [[1,-3.5,2.3],[2,-4,-3.4],[3,4,-7.1]]){
    const c=i===2?orange:cyan
    let b=`<circle cx="48" cy="48" r="33" fill="${c}"/>`+text(26,55,`U${i}`,20,'#042624')+text(20,112,i===2?'EE-P':'SYS',17)
    b+=text(20,151,'WIDE SPECTRUM',9)+text(20,168,'DATA INTEGRITY',9)+text(20,185,'LINK ESTABLISHED',9)
    b+=line(48,5,48,-40,'#45635f')+line(36,0,60,0,white)
    card(`node-${i}`,`04 / Network node U${i}`,230,210,b,x!,y!,.13)
  }
  card('heading','05 / Header',700,100,text(0,35,'PHASE / FIELD SYSTEMS',26)+text(0,68,'REMOTE TELEMETRY     /     REV. 02.71',10,'#587771'),.7,8,.04)
  card('phase-title','06 / Phase heading',620,60,text(0,36,'PHASE SELECT 02',25),2.2,.25,.1)
  let ticks=''
  for(let i=0;i<30;i++)ticks+=rect(i*10,0,4,i%5===0?30:15,'#456864','#456864')
  card('ruler','07 / Calibration ruler',300,40,ticks,-3.1,-6.1,.06)
  const sweep=card('sweep','08 / Moving acquisition sweep',1200,100,`<defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#00b4aa" stop-opacity="0"/><stop offset="1" stop-color="#00b4aa" stop-opacity=".15"/></linearGradient></defs><rect width="1200" height="100" fill="url(#g)"/>`+line(0,99,1200,99,'#167b70'),0,5,.16)
  sweep.transform.position.y=p('sweep-y',5,[[0,7],[6,-7],[12,7]])
  const camera={id:'camera-hud',name:'Macro / drifting telemetry',visible:true,projection:'perspective' as const,transform:transform('cam',-.4,1.4,16),fov:p('cam-fov',58),near:.1,far:100,depthOfField:true,focusDistance:p('cam-focus',16,[[0,16],[6,16.6],[12,16]]),fStop:p('cam-fstop',1.8)}
  camera.transform.rotation.z=p('cam-roll',-19,[[0,-19],[6,-16],[12,-19]])
  camera.transform.rotation.x=p('cam-pitch',-5)
  camera.transform.position.x=p('cam-x',-.4,[[0,-.4],[6,-.85],[12,-.4]])
  camera.transform.position.y=p('cam-y',1.4,[[0,1.4],[6,1.9],[12,1.4]])
  const scene:Aurora3DScene={id:'scene-phase-hud',name:'PHASE / Animated telemetry',objects,cameras:[camera],activeCameraId:camera.id,cameraCuts:[{id:'hud-cut',cameraId:camera.id,time:0}],lights:[],paths:[],environmentIntensity:0,revision:1,settings:{shadows:false,shadowMapSize:1024,ambientOcclusion:false,ambientOcclusionIntensity:0,ambientOcclusionRadius:1,motionBlur:false,motionBlurShutter:180,motionBlurSamples:4,quality:'full',backgroundColor:'#030708',viewTransform:'standard',exposureStops:0}}
  return {project:{id,name,width:1080,height:1500,frameRate:30,duration:12,backgroundColor:'#030708',updatedAt:Date.now(),version:12},assets,scenes3D:[scene],rigs:[],layers:[{id:'layer-hud',name:'PHASE / Animated HUD',type:'3d-scene',sceneId:scene.id,start:0,duration:12,color:cyan,visible:true,locked:false,muted:false,expanded:false,transform:{x:p('lx',540),y:p('ly',750),scaleX:p('lsx',100),scaleY:p('lsy',100),rotation:p('lr',0),opacity:p('lo',100)},effects:[]}],nodes:[{id:'hud-source',kind:'scene3d',title:'PHASE HUD',sourceId:'layer-hud',x:0,y:0,muted:false,properties:{},inputs:[],outputs:[{id:'out',label:'Image',type:'image'}]},{id:'hud-output',kind:'output',title:'Output',x:300,y:0,muted:false,properties:{},inputs:[{id:'in',label:'Image',type:'image'}],outputs:[]}],nodeConnections:[{id:'hud-link',fromNodeId:'hud-source',fromPortId:'out',toNodeId:'hud-output',toPortId:'in'}]}
}
