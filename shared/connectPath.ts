import { faceNormal, facePositions, type ModelMesh, type Vec3 } from './modeling.ts'
import { topologyEdgeKey } from './loopCut.ts'
import { meshTopology } from './meshTopology.ts'

const sub=(a:Vec3,b:Vec3)=>a.map((n,i)=>n-b[i]!) as Vec3
const dot=(a:Vec3,b:Vec3)=>a.reduce((sum,n,i)=>sum+n*b[i]!,0)
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
const mix=(a:Vec3,b:Vec3,t:number)=>a.map((n,i)=>n+(b[i]!-n)*t) as Vec3
const epsilon=1e-7

/** Trace straight segments across convex coplanar authored faces; split shared edges once. */
export function connectVertexPath(mesh:ModelMesh,vertexIds:string[]){
  if(new Set(vertexIds).size!==vertexIds.length)throw new Error('Select distinct vertices in path order')
  if(vertexIds.some(id=>!mesh.vertices.some(v=>v.id===id)))throw new Error('Unknown vertex in connection path')
  let changes=0
  for(let segment=0;segment<vertexIds.length-1;segment++){
    const start=vertexIds[segment]!,end=vertexIds[segment+1]!,positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
    if(meshTopology(mesh).edges.has(topologyEdgeKey(start,end)))continue
    const a=positions.get(start)!,b=positions.get(end)!,direction=sub(b,a),length=Math.hypot(...direction)
    if(length<epsilon)throw new Error('Connection endpoints must have different positions')
    type Hit={faceId:string;lo:number;hi:number;interior:boolean}
    let hits:Hit[]|undefined
    const faceNormals=new Map(mesh.faces.map(f=>[f.id,faceNormal(facePositions(mesh,f,positions))]))
    for(const seed of mesh.faces.filter(f=>f.vertices.includes(start))){
      const normal=faceNormals.get(seed.id)!
      if(Math.abs(dot(direction,normal))>epsilon)continue
      const candidate:Hit[]=[]
      for(const face of mesh.faces){
        if(dot(normal,faceNormals.get(face.id)!)<1-epsilon||face.vertices.some(id=>Math.abs(dot(sub(positions.get(id)!,a),normal))>epsilon))continue
        let lo=0,hi=1,interior=true
        for(let i=0;i<face.vertices.length;i++){
          const p=positions.get(face.vertices[i]!)!,q=positions.get(face.vertices[(i+1)%face.vertices.length]!)!,edge=sub(q,p)
          const h0=dot(cross(edge,sub(a,p)),normal),h1=dot(cross(edge,sub(b,p)),normal),delta=h1-h0
          if(Math.abs(delta)<epsilon){if(h0 < -epsilon){lo=1;hi=0;break}if(Math.abs(h0)<epsilon)interior=false;continue}
          const crossing=-h0/delta
          if(delta>0)lo=Math.max(lo,crossing);else hi=Math.min(hi,crossing)
        }
        if(hi-lo>epsilon)candidate.push({faceId:face.id,lo:Math.max(0,lo),hi:Math.min(1,hi),interior})
      }
      candidate.sort((l,r)=>l.lo-r.lo)
      let covered=0
      for(const hit of candidate){if(hit.lo>covered+epsilon)break;covered=Math.max(covered,hit.hi)}
      if(covered>=1-epsilon){hits=candidate;break}
    }
    if(!hits)throw new Error('Connect Path requires a continuous coplanar surface between each pair of vertices')
    const edgeSplits=new Map<string,Array<{id:string;t:number;from:string}>>()
    const endpoint=(faceId:string,t:number)=>{
      const face=mesh.faces.find(f=>f.id===faceId)!,point=mix(a,b,t)
      if(t<epsilon){if(!face.vertices.includes(start))throw new Error('Path crosses disconnected topology; merge touching vertices first');return start}
      if(t>1-epsilon){if(!face.vertices.includes(end))throw new Error('Path crosses disconnected topology; merge touching vertices first');return end}
      for(const id of face.vertices)if(Math.hypot(...sub(positions.get(id)!,point))<epsilon)return id
      for(let i=0;i<face.vertices.length;i++){
        const from=face.vertices[i]!,to=face.vertices[(i+1)%face.vertices.length]!,p=positions.get(from)!,q=positions.get(to)!,edge=sub(q,p)
        const u=dot(sub(point,p),edge)/dot(edge,edge)
        if(u<0||u>1||Math.hypot(...sub(mix(p,q,u),point))>epsilon)continue
        const key=topologyEdgeKey(from,to),splits=edgeSplits.get(key)??[],existing=splits.find(s=>Math.hypot(...sub(positions.get(s.id)!,point))<epsilon)
        if(existing)return existing.id
        const id=`v${mesh.nextId++}`;mesh.vertices.push({id,position:point});positions.set(id,point)
        splits.push({id,t:u,from});edgeSplits.set(key,splits);return id
      }
      throw new Error('Cannot resolve path intersection; choose a different path')
    }
    const resolved=hits.map(hit=>({...hit,from:endpoint(hit.faceId,hit.lo),to:endpoint(hit.faceId,hit.hi)}))
    const joints=resolved.flatMap(hit=>[{t:hit.lo,id:hit.from},{t:hit.hi,id:hit.to}]).sort((a,b)=>a.t-b.t)
    for(let i=1;i<joints.length;i++)if(Math.abs(joints[i]!.t-joints[i-1]!.t)<epsilon&&joints[i]!.id!==joints[i-1]!.id)throw new Error('Path crosses disconnected topology; merge touching vertices first')
    const cuts=resolved.filter(hit=>hit.interior)
    for(const face of mesh.faces)face.vertices=face.vertices.flatMap((from,i)=>{
      const to=face.vertices[(i+1)%face.vertices.length]!,splits=edgeSplits.get(topologyEdgeKey(from,to))??[]
      return [from,...splits.map(s=>({id:s.id,t:s.from===from?s.t:1-s.t})).sort((a,b)=>a.t-b.t).map(s=>s.id)]
    })
    for(const cut of cuts){
      const face=mesh.faces.find(f=>f.id===cut.faceId)!,i=face.vertices.indexOf(cut.from),j=face.vertices.indexOf(cut.to)
      if(i<0||j<0)throw new Error('Path endpoints are not on a common face boundary')
      const lo=Math.min(i,j),hi=Math.max(i,j),n=face.vertices.length
      if(hi-lo===1||hi-lo===n-1)continue
      const original=[...face.vertices]
      face.vertices=original.slice(lo,hi+1)
      mesh.faces.push({id:`f${mesh.nextId++}`,vertices:[...original.slice(hi),...original.slice(0,lo+1)]});changes++
    }
    if(mesh.faces.length>12000||mesh.vertices.length>12000)throw new Error('Connect Path would exceed the model geometry limit')
  }
  if(!changes)throw new Error('These vertices are already connected by edges')
}

export function connectionEdges(mesh:ModelMesh,vertexIds:string[]){
  const positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
  return [...meshTopology(mesh).edges].filter(([,uses])=>{
    const use=uses[0]!
    return vertexIds.slice(0,-1).some((id,i)=>{
      const a=positions.get(id)!,b=positions.get(vertexIds[i+1]!)!,d=sub(b,a),length2=dot(d,d)
      if(length2<epsilon*epsilon)return false
      return [use.from,use.to].every(id=>{const p=positions.get(id)!,t=dot(sub(p,a),d)/length2;return t>=-epsilon&&t<=1+epsilon&&Math.hypot(...sub(p,mix(a,b,t)))<epsilon})
    })
  }).map(([id])=>id)
}
