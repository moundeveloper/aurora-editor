import type {ModelMesh,Vec3} from './modeling.ts'
import {topologyEdgeKey} from './loopCut.ts'
const dot=(a:Vec3,b:Vec3)=>a.reduce((s,n,i)=>s+n*b[i]!,0)
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
const normalize=(v:Vec3):Vec3=>{const n=Math.hypot(...v);if(n<1e-9)throw new Error('Inset has a degenerate edge or face');return v.map(x=>x/n) as Vec3}
/** Solve boundary offset and face-plane constraints without duplicating internal seams. */
export function insetRegion(mesh:ModelMesh,faceIds:string[],thickness:number){
 if(!Number.isFinite(thickness)||thickness<=0)throw new Error('Inset thickness must be positive')
 const selected=new Set(faceIds),faces=mesh.faces.filter(f=>selected.has(f.id))
 if(!selected.size||faces.length!==selected.size)throw new Error('Unknown face; refresh the selection')
 const positions=new Map(mesh.vertices.map(v=>[v.id,v.position])),normals=new Map<string,Vec3>()
 const incident=new Map<string,string[]>(),edges=new Map<string,Array<{a:string;b:string;face:string}>>()
 for(const f of faces){
  const normal:Vec3=[0,0,0]
  f.vertices.forEach((a,i)=>{
   const b=f.vertices[(i+1)%f.vertices.length]!,p=positions.get(a)!,q=positions.get(b)!
   normal[0]+=(p[1]-q[1])*(p[2]+q[2]);normal[1]+=(p[2]-q[2])*(p[0]+q[0]);normal[2]+=(p[0]-q[0])*(p[1]+q[1])
   const list=incident.get(a)??[];list.push(f.id);incident.set(a,list)
   const key=topologyEdgeKey(a,b),uses=edges.get(key)??[];uses.push({a,b,face:f.id});edges.set(key,uses)
  })
  const n=normalize(normal),origin=positions.get(f.vertices[0]!)!
  if(f.vertices.some(id=>Math.abs(dot(n,positions.get(id)!.map((p,i)=>p-origin[i]!) as Vec3))>1e-5))throw new Error('Inset requires planar faces; flatten bent quads first')
  normals.set(f.id,n)
 }
 const boundary=[...edges.values()].filter(e=>e.length===1).map(e=>e[0]!)
 if(!boundary.length)throw new Error('Select a face region with a boundary to inset')
 const incoming=new Set<string>(),outgoing=new Set<string>(),constraints=new Map<string,Array<{n:Vec3;d:number}>>()
 for(const {a,b,face} of boundary){
  if(outgoing.has(a)||incoming.has(b))throw new Error('Region boundary touches itself; select an unbranched region')
  outgoing.add(a);incoming.add(b)
  const pa=positions.get(a)!,pb=positions.get(b)!,t=normalize(pb.map((v,i)=>v-pa[i]!) as Vec3)
  const n=normalize(cross(normals.get(face)!,t))
  for(const id of [a,b]){const list=constraints.get(id)??[];list.push({n,d:thickness});constraints.set(id,list)}
 }
 const moved=new Map<string,Vec3>()
 for(const [id,border] of constraints){
  const basis:Array<{n:Vec3;d:number}>=[]
  const equations=[...incident.get(id)!.map(face=>({n:normals.get(face)!,d:0})),...border]
  for(const equation of equations){
   let n:Vec3=[...equation.n],d=equation.d
   for(const b of basis){const coefficient=dot(n,b.n);n=n.map((v,i)=>v-coefficient*b.n[i]!) as Vec3;d-=coefficient*b.d}
   const length=Math.hypot(...n)
   if(length<1e-8){if(Math.abs(d)>1e-6)throw new Error('Inset cannot maintain even thickness at this corner');continue}
   basis.push({n:n.map(v=>v/length) as Vec3,d:d/length})
  }
  const p=positions.get(id)!
  moved.set(id,p.map((v,i)=>v+basis.reduce((s,b)=>s+b.n[i]!*b.d,0)) as Vec3)
 }
 if(mesh.vertices.length+moved.size>12000||mesh.faces.length+boundary.length>12000)throw new Error('Inset would exceed the model geometry limit')
 const copies=new Map<string,string>()
 for(const [id,position] of moved){const next=`v${mesh.nextId++}`;copies.set(id,next);mesh.vertices.push({id:next,position})}
 for(const f of faces)f.vertices=f.vertices.map(id=>copies.get(id)??id)
 for(const {a,b} of boundary)mesh.faces.push({id:`f${mesh.nextId++}`,vertices:[a,b,copies.get(b)!,copies.get(a)!]})
}
