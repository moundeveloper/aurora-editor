import { randomUUID } from 'node:crypto'
import { Euler, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three'
import type { Aurora3DObject, Aurora3DScene, MediaAsset, SerializedEditorState } from '../../src/models/editor.ts'
import { createModel, validateMesh, type ModelMesh, type Vec3 } from '../../shared/modeling.ts'
import { createNeonSingularityProject } from './showcase.ts'

const prop = (id: string, value: number) => ({ id, value, animated: false, keyframes: [] })
function transform(id: string, p: Vec3 = [0, 0, 0], s: Vec3 = [1, 1, 1], r: Vec3 = [0, 0, 0]) {
  const vector = (name: string, values: Vec3) => ({ x: prop(`${id}-${name}-x`, values[0]), y: prop(`${id}-${name}-y`, values[1]), z: prop(`${id}-${name}-z`, values[2]) })
  return { position: vector('p', p), rotation: vector('r', r), scale: vector('s', s) }
}

/** Native polygon assets keep the architecture and botanical prototypes editable in Modeling. */
export function createCrimsonCitadelProject(name = 'Crimson Citadel | The White Gardens'): SerializedEditorState {
  const snapshot = createNeonSingularityProject(name, randomUUID())
  const objects: Aurora3DObject[] = [], assets: MediaAsset[] = []
  let seed = 73129
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296 }
  const mesh = (): ModelMesh => ({ vertices: [], faces: [], nextId: 0 })
  function polygon(m: ModelMesh, points: Vec3[]) {
    const ids = points.map(position => { const id = `v${m.nextId++}`; m.vertices.push({ id, position }); return id })
    m.faces.push({ id: `f${m.nextId++}`, vertices: ids })
  }
  function box(m: ModelMesh, p: Vec3, size: Vec3, rot: Vec3 = [0, 0, 0]) {
    const cube = createModel().draft.mesh
    const matrix = new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...size).multiplyScalar(.5))
    const map = new Map<string, string>()
    for (const v of cube.vertices) { const id = `v${m.nextId++}`; map.set(v.id, id); m.vertices.push({ id, position: new Vector3(...v.position).applyMatrix4(matrix).toArray() as Vec3 }) }
    for (const f of cube.faces) m.faces.push({ id: `f${m.nextId++}`, vertices: f.vertices.map(id => map.get(id)!) })
  }
  function octa(m: ModelMesh, p: Vec3, s: Vec3) {
    const pts: Vec3[] = [[0,1,0],[1,0,0],[0,0,1],[-1,0,0],[0,0,-1],[0,-1,0]]
    const ids=pts.map(pt=>{const id=`v${m.nextId++}`;m.vertices.push({id,position:pt.map((v,a)=>p[a]!+v*s[a]!) as Vec3});return id})
    for (const f of [[0,2,1],[0,3,2],[0,4,3],[0,1,4],[5,1,2],[5,2,3],[5,3,4],[5,4,1]])m.faces.push({id:`f${m.nextId++}`,vertices:f.map(i=>ids[i]!)})
  }
  function add(id: string, label: string, m: ModelMesh, color: string, p: Vec3 = [0,0,0], s: Vec3 = [1,1,1]): Aurora3DObject {
    if(m.vertices.length>11000 || m.faces.length>11000) {
      const positions=new Map(m.vertices.map(v=>[v.id,v.position]));let part=mesh(),partIndex=0,first: Aurora3DObject|undefined
      const flush=()=>{const result=add(`${id}-${partIndex}`,`${label} / section ${++partIndex}`,part,color,p,s);first??=result;part=mesh()}
      for(const face of m.faces){if(part.vertices.length+face.vertices.length>10500)flush();polygon(part,face.vertices.map(v=>positions.get(v)!))}
      if(part.faces.length)flush()
      return first!
    }
    validateMesh(m)
    const draft = { schemaVersion: 1 as const, revision: 1, mesh: m, color }
    assets.push({ id: `asset-${id}`, name: label, kind: 'model3d', nativeModel: { draft, revisions: [structuredClone(draft)] } })
    const o: Aurora3DObject = { id, name: label, type: 'mesh', primitive: 'native', assetId: `asset-${id}`, modelRevision: 1, visible: true, locked: false, castShadow: true, receiveShadow: true, transform: transform(id,p,s), influences: [], material: { baseColor: color, emissive: '#000000', emissiveIntensity: prop(`${id}-e`,0), metalness: prop(`${id}-m`,0), roughness: prop(`${id}-rough`,.83), opacity: prop(`${id}-opacity`,1) } }
    objects.push(o); return o
  }
  const stone = ['#e9e5de','#d6d9d8','#c6d3d6','#b9ccd1']
  const leafColors = ['#760d25','#a51a32','#c52c40']
  const leafMeshes = leafColors.map(() => mesh())
  function ivy(x: number, z: number, base: number, height: number, width: number, amount = 100) {
    for (let i=0;i<amount*.65;i++) {
      const y = base + Math.pow(rand(),1.9)*height, xx = x+(rand()-.5)*width
      octa(leafMeshes[i%3]!,[xx,y,z+(rand()-.5)*.28],[.16+rand()*.28,.2+rand()*.3,.1+rand()*.12])
    }
  }
  function tower(id: string,x: number,z: number,h: number,w: number,depth: number) {
    const body=mesh(), ribs=mesh(), windows=mesh()
    box(body,[x,h/2,z],[w,h,w])
    box(body,[x,1,z],[w+2,2,w+2])
    box(body,[x,h-6,z],[w+1.1,.7,w+1.1])
    for (const sx of [-1,1]) for (const sz of [-1,1]) {
      box(ribs,[x+sx*w*.46,h*.51,z+sz*w*.46],[.55,h*1.04,.55])
      box(ribs,[x+sx*w*.46,h+2,z+sz*w*.46],[.26,7,.26])
    }
    for(const off of [-.22,0,.22]) {
      box(ribs,[x+w*off,h*.51,z+w*.5+.12],[.25,h*.96,.38])
      box(ribs,[x+w*.5+.12,h*.51,z+w*off],[.38,h*.96,.25])
    }
    for(let y=13;y<h-7;y+=2.05) for(const off of [-.34,-.13,.13,.34]) {
      box(windows,[x+w*off,y,z+w*.5+.014],[.22,.69,.04])
      box(windows,[x+w*.5+.014,y,z+w*off],[.04,.69,.22])
    }
    // Tall recessed lancet and its projecting jambs.
    box(windows,[x,10,z+w*.5+.035],[1.18,13,.04])
    for(const side of [-1,1])box(ribs,[x+side*.78,9.5,z+w*.5+.26],[.32,14,.55])
    for(let i=0;i<18;i++){const a=Math.PI*i/18,b=Math.PI*(i+1)/18;box(ribs,[x+.78*Math.cos((a+b)/2),16.5+.78*Math.sin((a+b)/2),z+w*.5+.26],[.18,.3,.55],[0,0,(a+b)/2-Math.PI/2])}
    add(`${id}-body`,`${id} / limestone mass`,body,stone[depth]!)
    add(`${id}-ribs`,`${id} / vertical ribs and crown`,ribs,depth>1?'#d0dcdd':'#f4efe4')
    add(`${id}-windows`,`${id} / recessed lancet windows`,windows,depth>1?'#92aeb9':'#52616c')
    if(depth<2){
      const mantle=mesh()
      for(let k=0;k<28;k++){
        const xx=-w/2+(k+.5)*w/28,hh=5+8*(.5+.5*Math.sin(k*.67))+rand()*4
        box(mantle,[x+xx,hh/2,z+w/2+.055],[w/28+.015,hh,.08])
        box(mantle,[x+w/2+.055,hh*.39,z+xx],[.08,hh*.78,w/28+.015])
      }
      add(`${id}-mantle`,`${id} / crimson ivy mantle`,mantle,'#8e1730')
      for(let k=0;k<7;k++)ivy(x+(rand()-.5)*w,z+w/2+.25,0,9+rand()*21,.7,90)
    }
  }
  tower('01 • Cathedral of the bloom',-13,-15,65,7,0)
  tower('02 • Near sentinel',-31,2,75,7,0)
  tower('03 • Eastern needle',24,-44,91,4.7,1)
  tower('04 • Ivory horizon',3,-66,106,4.4,2)
  tower('05 • Far spire',47,-80,115,4,3)
  tower('06 • Western echo',-41,-69,95,4,2)
  function arcade(id: string, x: number,z: number,y: number,span: number,n: number,base: number,angle=0,depth=0) {
    const m=mesh(), trim=mesh(), red=mesh(), radius=(span-1.05)/2, spring=y-radius-.8
    for(let i=0;i<=n;i++) {
      const xx=x+i*span
      box(m,[xx,(spring+base)/2,z],[1.05,spring-base,1.65])
      box(trim,[xx,(spring+base)/2,z+.9],[.22,spring-base,.2])
      box(trim,[xx,y+.15,z],[1.65,.38,2.15])
      if(depth===0)ivy(xx,z+.95,base,Math.min(12,spring-base),.8,65)
    }
    for(let i=0;i<n;i++) {
      const center=x+(i+.5)*span
      for(let j=0;j<24;j++) {
        const a=Math.PI*j/24,b=Math.PI*(j+1)/24,mid=(a+b)/2
        box(m,[center+(radius+.26)*Math.cos(mid),spring+(radius+.26)*Math.sin(mid),z],[(radius+.26)*Math.PI/24*1.025,.55,1.65],[0,0,mid+Math.PI/2])
      }
    }
    box(m,[x+n*span/2,y,z],[n*span+1.3,1.1,1.9])
    for(let k=0;k<n*4+1;k++)box(trim,[x+k*span/4,y+1.05,z],[.2,1.1,.25])
    for(const side of [-1,1])box(trim,[x+n*span/2,y+.6,z+side*.86],[n*span+1.3,.16,.16])
    if(depth<2)for(let i=0;i<n*50;i++)octa(red,[x+rand()*n*span,y+.6+rand()*.15,z+.9],[.14,.16,.16])
    for(const [suffix,mm,color] of [['stone',m,stone[depth]!],['coping',trim,'#eeeae2'],['ivy',red,'#9f2034']] as const)if(mm.faces.length){const o=add(`${id}-${suffix}`,`${id} / ${suffix}`,mm,color);o.transform.rotation.y.value=angle}
  }
  arcade('07 • Garden aqueduct',-15,-24,21,8,10,-9)
  arcade('08 • Sky passage',-49,-18,46,9,8,44,0,1)
  arcade('09 • High crossing',-16,-33,57,8,9,55,-46,1)
  arcade('10 • Distant gallery',-45,-77,26,10,11,-12,0,3)
  // A sloping meadow extends beyond every camera edge.
  const ground=mesh(), y=(x:number,z:number)=>-.16*x+.028*z-1.2
  polygon(ground,[[-70,y(-70,42),42],[75,y(75,42),42],[75,y(75,-40),-40],[-70,y(-70,-40),-40]])
  add('11-meadow','11 • Sloping carmine meadow',ground,'#630c23')
  const flowerbed=mesh()
  polygon(flowerbed,[[-43,y(-43,32)+.02,32],[48,y(48,32)+.02,32],[48,y(48,-25)+.02,-25],[-43,y(-43,-25)+.02,-25]])
  add('11-flowerbed','11 • Dense foreground flower bed',flowerbed,'#710f29')
  const petals=mesh()
  for(let i=0;i<5;i++) {const a=i*Math.PI*2/5, b=a+.52, c=a-.52;polygon(petals,[[0,.11,0],[Math.cos(c)*.085,.13,Math.sin(c)*.085],[Math.cos(a)*.14,.19,Math.sin(a)*.14],[Math.cos(b)*.085,.13,Math.sin(b)*.085]].reverse() as Vec3[])}
  // Five independently seeded patches avoid a regular repeated carpet.
  for(let i=0;i<5;i++) {
    const o=add(`12-flowers-${i}`,`12 • White anemones / scatter ${i+1}`,petals,i%2?'#fff6e4':'#eaf0ef',[0,-90,0])
    o.castShadow=false; o.scatter={enabled:true,targetId:'11-flowerbed',mode:'surface',count:5000,seed:80+i*173,jitter:.05,scaleVariation:.55,align:false}
  }
  const leaves=mesh();octa(leaves,[0,.08,0],[.17,.07,.09]);octa(leaves,[.1,.11,.06],[.08,.15,.1])
  for(let i=0;i<3;i++) {const o=add(`13-ground-leaves-${i}`,`13 • Scarlet foliage / scatter ${i+1}`,leaves,leafColors[i]!,[0,-95,0]);o.castShadow=false;o.scatter={enabled:true,targetId:'11-meadow',mode:'surface',count:5000,seed:901+i*133,jitter:.08,scaleVariation:.65,align:false}}
  leafMeshes.forEach((m,i)=>add(`14-climbing-ivy-${i}`,`14 • Climbing crimson ivy / ${i+1}`,m,leafColors[i]!))
  // Birds are actual folded-wing silhouettes suspended among the bridges.
  const birds=mesh()
  for(let i=0;i<24;i++) {const x=-22+rand()*63, yy=16+rand()*27,z=-13-rand()*48, s=.18+rand()*.3;polygon(birds,[[x,yy,z],[x-s*2,yy+s,z-.12],[x-s*.7,yy+.04,z+.18]]);polygon(birds,[[x,yy,z],[x+s*.7,yy+.04,z+.18],[x+s*2,yy+s,z-.12]])}
  add('15-doves','15 • Doves in the nave of the sky',birds,'#f7f4ec').castShadow=false
  // Sculpted cloud banks form a real three-dimensional sky backdrop.
  const cloudGeometry=new SphereGeometry(1,10,7).toNonIndexed(), cloudPositions=cloudGeometry.getAttribute('position')
  for(let bank=0;bank<7;bank++) {
    const cloud=mesh(),cx=-180+bank*62,cy=150+rand()*65,cz=-205-rand()*25
    for(let puff=0;puff<6;puff++) {
      const px=cx+(rand()-.5)*62,py=cy+(rand()-.5)*20,pz=cz+(rand()-.5)*12,sx=12+rand()*18,sy=7+rand()*12,sz=9+rand()*7
      for(let i=0;i<cloudPositions.count;i+=3) {
        const points=[0,1,2].map(j=>[px+cloudPositions.getX(i+j)*sx,py+cloudPositions.getY(i+j)*sy,pz+cloudPositions.getZ(i+j)*sz] as Vec3)
        const area=new Vector3(...points[1]!).sub(new Vector3(...points[0]!)).cross(new Vector3(...points[2]!).sub(new Vector3(...points[0]!))).length()
        if(area>1e-6)polygon(cloud,points)
      }
    }
    const o=add(`16-cloud-bank-${bank}`,`16 • Sculpted cloud bank ${bank+1}`,cloud,'#e2ebeb');o.castShadow=false;o.receiveShadow=false;o.material.emissive='#c5d5dc';o.material.emissiveIntensity.value=.3
  }
  cloudGeometry.dispose()
  const cameraPosition=new Vector3(12,4,30), target=new Vector3(-1,25,-25)
  const rotation=new Euler().setFromRotationMatrix(new Matrix4().lookAt(cameraPosition,target,new Vector3(0,1,0)))
  const camera={id:'camera-gardens',name:'Hero • Low angle / 24 mm',visible:true,projection:'perspective' as const,transform:transform('camera-gardens',cameraPosition.toArray() as Vec3,[1,1,1],[rotation.x*180/Math.PI,rotation.y*180/Math.PI,9]),fov:prop('camera-fov',62),near:.1,far:550}
  const light=(id:string,type:'ambient'|'directional',color:string,intensity:number,r:Vec3=[0,0,0])=>({id,name:id,type,color,visible:true,intensity:prop(`${id}-power`,intensity),transform:transform(id,[40,90,15],[1,1,1],r),castShadow:type==='directional'})
  const scene: Aurora3DScene={id:'scene-crimson-citadel',name:'Crimson Citadel / The White Gardens',objects,cameras:[camera],cameraCuts:[{id:'hero-cut',cameraId:camera.id,time:0}],activeCameraId:camera.id,paths:[],lights:[light('Warm afternoon sun','directional','#fff0d7',3.1,[-38,-32,0]),light('Open blue sky','ambient','#b4d4e3',1.6)],environmentIntensity:1,settings:{shadows:true,shadowMapSize:2048,ambientOcclusion:true,ambientOcclusionIntensity:.65,ambientOcclusionRadius:.65,motionBlur:false,motionBlurShutter:180,motionBlurSamples:4,quality:'full',backgroundColor:'#729aac',viewTransform:'aces',exposureStops:.15},revision:1}
  snapshot.project.backgroundColor='#729aac';snapshot.project.duration=12
  const layer=snapshot.layers.find(l=>l.type==='3d-scene')!;layer.id='layer-citadel';layer.name='Crimson Citadel • 3D';layer.sceneId=scene.id;layer.effects=[]
  for(const [key,value] of Object.entries({x:960,y:540,scaleX:100,scaleY:100,rotation:0,opacity:100}))layer.transform[key as keyof typeof layer.transform]=prop(`layer-${key}`,value)
  snapshot.layers=[layer];snapshot.assets=assets;snapshot.scenes3D=[scene];snapshot.rigs=[]
  snapshot.nodes=[{id:'citadel-source',kind:'scene3d',title:'White Gardens',sourceId:layer.id,x:50,y:80,muted:false,properties:{},inputs:[],outputs:[{id:'source-out',label:'Image',type:'image'}]},{id:'citadel-output',kind:'output',title:'Final image',x:400,y:80,muted:false,properties:{},inputs:[{id:'output-in',label:'Image',type:'image'}],outputs:[]}]
  snapshot.nodeConnections=[{id:'citadel-link',fromNodeId:'citadel-source',fromPortId:'source-out',toNodeId:'citadel-output',toPortId:'output-in'}]
  return snapshot
}
