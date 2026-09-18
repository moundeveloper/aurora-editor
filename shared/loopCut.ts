import type { ModelMesh, Vec3 } from './modeling.ts'

export interface LoopCutOptions { edge:[string,string]; cuts:number; position:number }
export const topologyEdgeKey=(a:string,b:string)=>JSON.stringify([a,b].sort())

/** Follow opposite edges through a quad strip in both directions, preserving interpolation direction. */
export function insertQuadLoop(mesh:ModelMesh,{edge,cuts,position}:LoopCutOptions) {
  if(!Number.isInteger(cuts)||cuts<1||cuts>16||!Number.isFinite(position)||position<.01||position>.99) throw new Error('Loop cuts require 1–16 cuts and a position between 0.01 and 0.99')
  const adjacency=new Map<string,Array<{face:number;index:number}>>()
  mesh.faces.forEach((face,f)=>face.vertices.forEach((a,i)=>{
    const key=topologyEdgeKey(a,face.vertices[(i+1)%face.vertices.length]!)
    const uses=adjacency.get(key)??[];uses.push({face:f,index:i});adjacency.set(key,uses)
  }))
  const seed=topologyEdgeKey(...edge)
  if(edge[0]===edge[1]||!adjacency.has(seed))throw new Error('Choose an existing mesh edge for the loop cut')
  const crossed=new Map<string,[string,string]>([[seed,[...edge]]]),queue=[seed]
  const faces=new Map<number,number>()
  for(let cursor=0;cursor<queue.length;cursor++) {
    const key=queue[cursor]!,oriented=crossed.get(key)!,uses=adjacency.get(key)!
    if(uses.length>2)throw new Error('Loop cut cannot cross a non-manifold edge')
    for(const use of uses) {
      const vertices=mesh.faces[use.face]!.vertices,i=use.index
      if(vertices.length!==4)throw new Error('Loop cut requires a quad strip; this strip reaches a triangle or n-gon')
      const previous=faces.get(use.face)
      if(previous!==undefined) {
        if(previous!==i&&(previous+2)%4!==i)throw new Error('This loop crosses itself; choose a different edge')
        continue
      }
      faces.set(use.face,i)
      // Corresponding positions on opposite edges run in opposite face-winding directions.
      const c=vertices[(i+2)%4]!,d=vertices[(i+3)%4]!
      const next:[string,string]=vertices[i]===oriented[0]?[d,c]:[c,d]
      const nextKey=topologyEdgeKey(...next),existing=crossed.get(nextKey)
      if(existing && existing[0]!==next[0])throw new Error('Twisted loop orientation is not supported')
      if(!existing){crossed.set(nextKey,next);queue.push(nextKey)}
    }
  }
  if(mesh.vertices.length+crossed.size*cuts>12000||mesh.faces.length+faces.size*cuts>12000)throw new Error('Loop cut would exceed the model geometry limit')
  const positions=new Map(mesh.vertices.map(v=>[v.id,v.position])),inserted=new Map<string,string[]>()
  for(const [key,[a,b]] of crossed) {
    const start=positions.get(a)!,end=positions.get(b)!,ids:string[]=[]
    for(let i=0;i<cuts;i++) {
      const t=cuts===1?position:(i+1)/(cuts+1),id=`v${mesh.nextId++}`
      mesh.vertices.push({id,position:start.map((n,axis)=>n+(end[axis]!-n)*t) as Vec3});ids.push(id)
    }
    inserted.set(key,ids)
  }
  const pointsOnEdge=(a:string,b:string)=>{
    const key=topologyEdgeKey(a,b),ids=inserted.get(key)!
    return [a,...(crossed.get(key)![0]===a?ids:[...ids].reverse()),b]
  }
  const cutEdges:Array<[string,string]>=[],result:ModelMesh['faces']=[]
  mesh.faces.forEach((face,index)=>{
    const i=faces.get(index)
    if(i===undefined){result.push(face);return}
    const v=face.vertices,a=pointsOnEdge(v[i]!,v[(i+1)%4]!),b=pointsOnEdge(v[(i+3)%4]!,v[(i+2)%4]!)
    for(let j=0;j<=cuts;j++)result.push({id:j===0?face.id:`f${mesh.nextId++}`,vertices:[a[j]!,a[j+1]!,b[j+1]!,b[j]!]})
    for(let j=1;j<=cuts;j++)cutEdges.push([a[j]!,b[j]!])
  })
  mesh.faces=result
  return {cutEdges,faceCount:faces.size}
}
