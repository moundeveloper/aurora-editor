import { faceNormal, facePositions, type ModelMesh, type Vec3 } from './modeling.ts'
import { meshTopology } from './meshTopology.ts'
import type { MeshSelectionQuery } from './meshSelection.ts'

export const similarProperties = {
  vertex: [{value:'degree',label:'Connected edges'}, {value:'face-count',label:'Incident faces'}],
  edge: [{value:'length',label:'Length'}, {value:'angle',label:'Face angle'}, {value:'face-count',label:'Incident faces'}],
  face: [{value:'area',label:'Area'}, {value:'normal',label:'Normal direction'}, {value:'corners',label:'Corner count'}],
} as const
const angle = (a:Vec3,b:Vec3) => Math.acos(Math.max(-1,Math.min(1,a.reduce((sum,n,i)=>sum+n*b[i]!,0))))*180/Math.PI

/** Read-only geometric and topological selection. No mesh attributes are assumed. */
export function selectByProperty(mesh:ModelMesh, query:MeshSelectionQuery):string[] {
  const {mode,action,ids}=query, topology=meshTopology(mesh)
  const vertices=new Map(mesh.vertices.map(v=>[v.id,v])), faces=new Map(mesh.faces.map(f=>[f.id,f]))
  const positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
  const all=mode==='vertex'?[...vertices.keys()]:mode==='edge'?[...topology.edges.keys()]:[...faces.keys()]
  if(action==='trait') {
    if(!query.trait)throw new Error('Choose a selection trait')
    if((query.trait==='loose'||query.trait==='poles')&&mode!=='vertex')throw new Error('Loose vertices and poles require Vertex mode')
    const boundaryEdges=new Set([...topology.edges].filter(([,uses])=>uses.length===1).map(([id])=>id))
    const boundaryVertices=new Set([...boundaryEdges].flatMap(id=>{const use=topology.edges.get(id)![0]!;return [use.from,use.to]}))
    if(query.trait==='loose')return all.filter(id=>topology.vertexFaces.get(id)!.size===0)
    if(query.trait==='poles')return all.filter(id=>!boundaryVertices.has(id)&&topology.vertexEdges.get(id)!.size>0&&topology.vertexEdges.get(id)!.size!==4)
    if(query.trait==='boundary')return all.filter(id=>mode==='edge'?boundaryEdges.has(id):mode==='vertex'?boundaryVertices.has(id):faces.get(id)!.vertices.some(v=>boundaryVertices.has(v)))
    const badEdges=new Set([...topology.edges].filter(([,uses])=>uses.length!==2||(uses[0]!.from===uses[1]!.from)).map(([id])=>id))
    const badVertices=new Set<string>()
    for(const vertex of mesh.vertices){
      const incident=topology.vertexFaces.get(vertex.id)!, edges=topology.vertexEdges.get(vertex.id)!
      if(!incident.size||[...edges].some(id=>badEdges.has(id))){badVertices.add(vertex.id);continue}
      // A closed manifold vertex must have one connected incident face fan.
      const neighbors=new Map([...incident].map(id=>[id,new Set<string>()]))
      for(const id of edges){const uses=topology.edges.get(id)!;for(const a of uses)for(const b of uses)if(a.faceId!==b.faceId)neighbors.get(a.faceId)!.add(b.faceId)}
      const queue=[incident.values().next().value!], visited=new Set(queue)
      for(let i=0;i<queue.length;i++)for(const next of neighbors.get(queue[i]!)!)if(!visited.has(next)){visited.add(next);queue.push(next)}
      if(visited.size!==incident.size)badVertices.add(vertex.id)
    }
    return all.filter(id=>mode==='edge'?badEdges.has(id):mode==='vertex'?badVertices.has(id):faces.get(id)!.vertices.some(v=>badVertices.has(v)))
  }
  if(!ids.length)throw new Error('Select at least one reference element')
  const property=query.property
  if(!property||!similarProperties[mode].some(p=>p.value===property))throw new Error('Choose a similarity property supported by this selection mode')
  const tolerance=query.tolerance??0
  const normals=new Map<string,Vec3>()
  const normal=(id:string)=>{if(!normals.has(id))normals.set(id,faceNormal(facePositions(mesh,faces.get(id)!,positions)));return normals.get(id)!}
  const value=(id:string):number|Vec3|null=>{
    if(property==='degree')return topology.vertexEdges.get(id)!.size
    if(property==='face-count')return mode==='vertex'?topology.vertexFaces.get(id)!.size:topology.edges.get(id)!.length
    if(property==='corners')return faces.get(id)!.vertices.length
    if(property==='normal')return normal(id)
    if(property==='length'){const use=topology.edges.get(id)![0]!,a=vertices.get(use.from)!.position,b=vertices.get(use.to)!.position;return Math.hypot(...a.map((n,i)=>n-b[i]!))}
    if(property==='angle'){const uses=topology.edges.get(id)!;return uses.length===2?angle(normal(uses[0]!.faceId),normal(uses[1]!.faceId)):null}
    const points=facePositions(mesh,faces.get(id)!,positions),a=points[0]!
    let area=0
    for(let i=1;i<points.length-1;i++){
      const b=points[i]!.map((n,j)=>n-a[j]!),c=points[i+1]!.map((n,j)=>n-a[j]!)
      area+=Math.hypot(b[1]!*c[2]!-b[2]!*c[1]!,b[2]!*c[0]!-b[0]!*c[2]!,b[0]!*c[1]!-b[1]!*c[0]!)/2
    }
    return area
  }
  const references=ids.map(value)
  if(references.some(v=>v===null))throw new Error('Face angle requires interior edges with two incident faces')
  const matches=all.filter(id=>{const candidate=value(id);return candidate!==null&&references.some(reference=>Array.isArray(candidate)&&Array.isArray(reference)?angle(candidate,reference)<=tolerance+1e-7:typeof candidate==='number'&&typeof reference==='number'&&Math.abs(candidate-reference)<=tolerance+1e-7)})
  const selected=new Set(ids)
  return [...ids,...matches.filter(id=>!selected.has(id))]
}
