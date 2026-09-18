import type { ModelMesh } from './modeling.ts'
import { topologyEdgeKey } from './loopCut.ts'

export type DeleteMode = 'vertex' | 'edge' | 'face'

/** Delete selected edit-mode elements and the faces/vertices that depend on them. */
export function deleteMeshElements(mesh:ModelMesh,mode:DeleteMode,ids:string[]){
  const selected=new Set(ids)
  if(!selected.size)throw new Error('Select geometry to delete')
  if(mode==='vertex'){
    const known=new Set(mesh.vertices.map(vertex=>vertex.id))
    if([...selected].some(id=>!known.has(id)))throw new Error('Unknown vertex in selection')
    mesh.faces=mesh.faces.filter(face=>!face.vertices.some(id=>selected.has(id)))
  }else if(mode==='face'){
    const known=new Set(mesh.faces.map(face=>face.id))
    if([...selected].some(id=>!known.has(id)))throw new Error('Unknown face in selection')
    mesh.faces=mesh.faces.filter(face=>!selected.has(face.id))
  }else{
    const known=new Set<string>()
    for(const face of mesh.faces)for(let index=0;index<face.vertices.length;index++)known.add(topologyEdgeKey(face.vertices[index]!,face.vertices[(index+1)%face.vertices.length]!))
    if([...selected].some(id=>!known.has(id)))throw new Error('Unknown edge in selection')
    mesh.faces=mesh.faces.filter(face=>!face.vertices.some((vertex,index)=>selected.has(topologyEdgeKey(vertex,face.vertices[(index+1)%face.vertices.length]!))))
  }
  if(!mesh.faces.length)throw new Error('Cannot delete all faces; the model must retain at least one face')
  const used=new Set(mesh.faces.flatMap(face=>face.vertices))
  mesh.vertices=mesh.vertices.filter(vertex=>used.has(vertex.id))
}
