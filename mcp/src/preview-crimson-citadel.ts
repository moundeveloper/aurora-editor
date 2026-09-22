// Software geometry preview; intentionally does not claim to reproduce Aurora's WebGL shading.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { deflateSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { SerializedEditorState, Transform3D } from '../../src/models/editor.ts'

const client=new Client({name:'citadel-preview',version:'1.0'})
let doc:SerializedEditorState
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:['mcp/src/index.ts'],cwd:process.cwd(),stderr:'inherit'}))
  const result=await client.callTool({name:'aurora_project_list',arguments:{}})
  if(result.isError)throw new Error(JSON.stringify(result.content))
  const list=JSON.parse((result.content as Array<{text?:string}>).find(c=>c.text)!.text!) as {projects:Array<{id:string}>}
  const project=list.projects.find(p=>p.id===process.argv[2]);if(!project)throw new Error('Project was not found through MCP')
  doc=JSON.parse(await readFile(join(process.env.AURORA_VAULT??join(homedir(),'Aurora'),'projects',`${project.id}.aurora.json`),'utf8'))
} finally {await client.close()}
await mkdir('artifacts/crimson-citadel',{recursive:true})
await writeFile('artifacts/crimson-citadel/Crimson-Citadel.aurora.json',JSON.stringify(doc))
const W=1200,H=675,buffer=new Uint8Array(W*H*4),depth=new Float32Array(W*H).fill(Infinity)
for(let i=0;i<W*H;i++)buffer.set([114,154,172,255],i*4)
const scene=doc.scenes3D[0]!,cam=scene.cameras[0]!,rad=Math.PI/180
const matrix=(t:Transform3D)=>new Matrix4().compose(new Vector3(t.position.x.value,t.position.y.value,t.position.z.value),new Quaternion().setFromEuler(new Euler(t.rotation.x.value*rad,t.rotation.y.value*rad,t.rotation.z.value*rad)),new Vector3(t.scale.x.value,t.scale.y.value,t.scale.z.value))
const view=matrix(cam.transform).invert(),f=H/2/Math.tan(cam.fov.value*rad/2),sun=new Vector3(.45,.7,.6).normalize()
function draw(points:Vector3[],color:Color,emission:number){
  const normal=points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize()
  const illumination=.54+Math.max(0,normal.dot(sun))*.7+emission
  const rgb=[color.r,color.g,color.b].map(c=>Math.round(Math.min(1,Math.pow(c*illumination,1/2.2))*255))
  let ps=points.map(p=>p.clone().applyMatrix4(view)),clipped:Vector3[]=[]
  for(let i=0;i<ps.length;i++){const a=ps[i]!,b=ps[(i+1)%ps.length]!,ia=a.z<-.1,ib=b.z<-.1;if(ia)clipped.push(a);if(ia!==ib)clipped.push(a.clone().lerp(b,(-.1-a.z)/(b.z-a.z)))}
  ps=clipped;if(ps.length<3)return
  for(let t=1;t<ps.length-1;t++){
    const vs=[ps[0]!,ps[t]!,ps[t+1]!].map(p=>[W/2+f*p.x/-p.z,H/2-f*p.y/-p.z,1/-p.z])
    const [a,b,c]=vs as [number[],number[],number[]]
    const det=(b[1]!-c[1]!)*(a[0]!-c[0]!)+(c[0]!-b[0]!)*(a[1]!-c[1]!)
    if(Math.abs(det)<1e-8)continue
    const x0=Math.max(0,Math.floor(Math.min(a[0]!,b[0]!,c[0]!))),x1=Math.min(W-1,Math.ceil(Math.max(a[0]!,b[0]!,c[0]!)))
    const y0=Math.max(0,Math.floor(Math.min(a[1]!,b[1]!,c[1]!))),y1=Math.min(H-1,Math.ceil(Math.max(a[1]!,b[1]!,c[1]!)))
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const u=((b[1]!-c[1]!)*(x-c[0]!)+(c[0]!-b[0]!)*(y-c[1]!))/det,v=((c[1]!-a[1]!)*(x-c[0]!)+(a[0]!-c[0]!)*(y-c[1]!))/det,w=1-u-v
      if(u<0||v<0||w<0)continue
      const z=1/(u*a[2]!+v*b[2]!+w*c[2]!),idx=y*W+x
      if(z>=depth[idx]!)continue;depth[idx]=z;buffer[idx*4]=rgb[0]!;buffer[idx*4+1]=rgb[1]!;buffer[idx*4+2]=rgb[2]!
    }
  }
}
for(const o of scene.objects){
  const mesh=doc.assets.find(a=>a.id===o.assetId)?.nativeModel?.draft.mesh;if(!mesh)continue
  const local=new Map(mesh.vertices.map(v=>[v.id,new Vector3(...v.position)])),color=new Color(o.material.baseColor),model=matrix(o.transform)
  const render=(m:Matrix4)=>{for(const face of mesh.faces){const points=face.vertices.map(id=>local.get(id)!.clone().applyMatrix4(m));for(let i=1;i<points.length-1;i++)draw([points[0]!,points[i]!,points[i+1]!],color,o.material.emissiveIntensity.value)}}
  if(!o.scatter){render(model);continue}
  const target=doc.assets.find(a=>a.id===scene.objects.find(t=>t.id===o.scatter!.targetId)?.assetId)?.nativeModel?.draft.mesh
  if(!target)continue
  const pts=target.vertices.map(v=>new Vector3(...v.position));let seed=o.scatter.seed
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296}
  for(let i=0;i<o.scatter.count;i++){
    const tri=rand()<.5?[pts[0]!,pts[1]!,pts[2]!]:[pts[0]!,pts[2]!,pts[3]!],u=Math.sqrt(rand()),v=rand()
    const p=tri[0]!.clone().multiplyScalar(1-u).addScaledVector(tri[1]!,u*(1-v)).addScaledVector(tri[2]!,u*v)
    p.add(new Vector3(rand()-.5,rand()-.5,rand()-.5).multiplyScalar(o.scatter.jitter))
    const s=1+(rand()*2-1)*o.scatter.scaleVariation
    render(new Matrix4().compose(p,new Quaternion(),new Vector3(s,s,s)))
  }
}
function crc(data:Uint8Array){let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(type:string,data:Uint8Array){const body=Buffer.concat([Buffer.from(type),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(body));return Buffer.concat([head,body,tail])}
const header=Buffer.alloc(13);header.writeUInt32BE(W);header.writeUInt32BE(H,4);header[8]=8;header[9]=6
const rows=Buffer.alloc((W*4+1)*H);for(let y=0;y<H;y++)rows.set(buffer.subarray(y*W*4,(y+1)*W*4),y*(W*4+1)+1)
await writeFile('artifacts/crimson-citadel/composition-preview.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]))
console.log(JSON.stringify({projectId:doc.project.id,objects:scene.objects.length,assets:doc.assets.length,preview:'artifacts/crimson-citadel/composition-preview.png'}))
