import type { ModelMesh,Vec3 } from './modeling.ts'
import { topologyEdgeKey } from './loopCut.ts'

/** Extrude a face region as a connected cap, creating side quads only on its boundary. */
export function extrudeRegion(mesh:ModelMesh,faceIds:string[],distance:number,direction?:Vec3){
  if(!Number.isFinite(distance)||Math.abs(distance)<1e-6)throw new Error('Extrusion distance must be nonzero')
  const selected=new Set(faceIds),faces=mesh.faces.filter(f=>selected.has(f.id))
  if(!selected.size || faces.length!==selected.size)throw new Error('Unknown face; refresh the selection')
  const positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
  const normal:Vec3=direction?[...direction]:[0,0,0]
  const edges=new Map<string,Array<[string,string]>>()
  for(const f of faces)for(let i=0;i<f.vertices.length;i++){
    const a=f.vertices[i]!,b=f.vertices[(i+1)%f.vertices.length]!,key=topologyEdgeKey(a,b)
    const uses=edges.get(key)??[];uses.push([a,b]);edges.set(key,uses)
    if(!direction){const p=positions.get(a)!,q=positions.get(b)!
      normal[0]+=(p[1]-q[1])*(p[2]+q[2]);normal[1]+=(p[2]-q[2])*(p[0]+q[0]);normal[2]+=(p[0]-q[0])*(p[1]+q[1])
    }
  }
  const length=Math.hypot(...normal)
  if(length<1e-8)throw new Error('Region has no common normal. Choose X, Y or Z to set the extrusion direction.')
  const boundary=[...edges.values()].filter(uses=>uses.length===1).map(uses=>uses[0]!)
  const outgoing=new Set<string>(),incoming=new Set<string>()
  for(const [a,b] of boundary){
    if(outgoing.has(a)||incoming.has(b))throw new Error('Region boundary touches itself. Select faces connected through edges.')
    outgoing.add(a);incoming.add(b)
  }
  const ids=new Set(faces.flatMap(f=>f.vertices)),copies=new Map<string,string>()
  if(mesh.vertices.length+ids.size>12000||mesh.faces.length+boundary.length>12000)throw new Error('Extrusion would exceed the model geometry limit')
  for(const id of ids){
    const next=`v${mesh.nextId++}`,p=positions.get(id)!
    copies.set(id,next);mesh.vertices.push({id:next,position:p.map((n,i)=>n+normal[i]!/length*distance) as Vec3})
  }
  for(const f of faces)f.vertices=f.vertices.map(id=>copies.get(id)!)
  for(const [a,b] of boundary)mesh.faces.push({id:`f${mesh.nextId++}`,vertices:[a,b,copies.get(b)!,copies.get(a)!]})
  // Interior source vertices have no remaining faces; do not leave loose hidden points behind.
  const used=new Set(mesh.faces.flatMap(f=>f.vertices))
  mesh.vertices=mesh.vertices.filter(v=>used.has(v.id))
}
