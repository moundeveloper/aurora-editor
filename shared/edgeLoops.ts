import type { ModelMesh, ModelVertex, Vec3 } from './modeling.ts'
import { topologyEdgeKey as key } from './loopCut.ts'
type Edge={id:string;vertices:[string,string];faces:number[]}
function topology(mesh:ModelMesh){
  const edges=new Map<string,Edge>(),incident=new Map<string,Edge[]>()
  mesh.faces.forEach((f,index)=>f.vertices.forEach((a,i)=>{
    const b=f.vertices[(i+1)%f.vertices.length]!,id=key(a,b)
    if(!edges.has(id))edges.set(id,{id,vertices:[a,b],faces:[]})
    edges.get(id)!.faces.push(index)
  }))
  for(const edge of edges.values())for(const v of edge.vertices){const list=incident.get(v)??[];list.push(edge);incident.set(v,list)}
  return {edges,incident}
}
/** Continue across regular quad vertices; stop at poles instead of guessing by angle. */
export function selectEdgeLoop(mesh:ModelMesh,seed:string):string[]{
  const {edges,incident}=topology(mesh),first=edges.get(seed)
  if(!first)return []
  const found=new Set<string>([seed]),queue=[first]
  for(let i=0;i<queue.length;i++)for(const vertex of queue[i]!.vertices){
    const current=queue[i]!,neighbors=incident.get(vertex)!
    let candidates:Edge[]=[]
    if(current.faces.length===1)candidates=neighbors.filter(e=>e!==current && e.faces.length===1)
    else if(neighbors.length===4 && neighbors.every(e=>e.faces.length===2 && e.faces.every(f=>mesh.faces[f]!.vertices.length===4)))
      candidates=neighbors.filter(e=>e!==current && !e.faces.some(f=>current.faces.includes(f)))
    if(candidates.length===1 && !found.has(candidates[0]!.id)){found.add(candidates[0]!.id);queue.push(candidates[0]!)}
  }
  return [...found]
}
/** In face mode Alt-click follows faces across the seed and each opposite quad edge. */
export function selectFaceLoop(mesh:ModelMesh,seed:string):string[]{
  const {edges}=topology(mesh),pending=[seed],seen=new Set<string>(),faces=new Set<string>()
  for(let i=0;i<pending.length;i++){
    const id=pending[i]!
    if(seen.has(id))continue
    seen.add(id)
    const edge=edges.get(id)
    if(!edge || edge.faces.length>2)continue
    for(const fi of edge.faces){
      const face=mesh.faces[fi]!,v=face.vertices
      if(v.length!==4)continue
      faces.add(face.id)
      const index=v.findIndex((a,j)=>key(a,v[(j+1)%4]!)===id)
      pending.push(key(v[(index+2)%4]!,v[(index+3)%4]!))
    }
  }
  return [...faces]
}
/** Build consistently oriented pairs of neighboring rails for an unbranched edge selection. */
export function edgeSlideVertices(mesh:ModelMesh,selection:string[],factor:number):ModelVertex[]{
  if(!Number.isFinite(factor)||Math.abs(factor)>.99)throw new Error('Slide factor must be between -0.99 and 0.99')
  const {edges}=topology(mesh),chosen=[...new Set(selection)].map(id=>edges.get(id))
  if(!chosen.length || chosen.some(e=>!e))throw new Error('Select existing edges to slide')
  const selected=new Set(selection),degree=new Map<string,number>()
  for(const e of chosen)for(const v of e!.vertices)degree.set(v,(degree.get(v)??0)+1)
  if([...degree.values()].some(n=>n>2))throw new Error('Edge slide requires unbranched loops or edge chains')
  const constraints=chosen.map(edge=>{
    const e=edge!,[a,b]=e.vertices
    if(e.faces.length!==2)throw new Error('Edge slide requires two adjacent quad faces per edge')
    const pairs=e.faces.map(fi=>{
      const f=mesh.faces[fi]!.vertices
      if(f.length!==4)throw new Error('Edge slide currently requires quad faces')
      if(f.filter((v,i)=>selected.has(key(v,f[(i+1)%4]!))).length!==1)throw new Error('Select separated loops, with only one selected edge per face')
      const neighbor=(v:string,other:string)=>{const i=f.indexOf(v);return [f[(i+3)%4]!,f[(i+1)%4]!].find(n=>n!==other)!}
      return [neighbor(a,b),neighbor(b,a)] as [string,string]
    })
    return {a,b,pairs}
  })
  const rails=new Map<string,[string,string]>(),pending=new Set(constraints)
  while(pending.size){
    const c=[...pending].find(c=>rails.has(c.a)||rails.has(c.b))??pending.values().next().value!
    const {a,b,pairs}=c
    let order=[0,1]
    const existing=rails.get(a)??rails.get(b),column=rails.has(a)?0:1
    if(existing){if(pairs[0]![column]===existing[1])order=[1,0];else if(pairs[0]![column]!==existing[0])throw new Error('Ambiguous slide rails at a pole')}
    for(const [v,col] of [[a,0],[b,1]] as const){
      const pair:[string,string]=[pairs[order[0]!]![col],pairs[order[1]!]![col]],old=rails.get(v)
      if(old && (old[0]!==pair[0]||old[1]!==pair[1]))throw new Error('Twisted or ambiguous slide rails')
      if(pair.some(id=>degree.has(id)))throw new Error('Slide rails must remain outside the selection')
      rails.set(v,pair)
    }
    pending.delete(c)
  }
  const positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
  return [...rails].map(([id,pair])=>{
    const start=positions.get(id)!,end=positions.get(pair[factor<0?1:0])!,t=Math.abs(factor)
    return {id,position:start.map((n,i)=>n+(end[i]!-n)*t) as Vec3}
  })
}
