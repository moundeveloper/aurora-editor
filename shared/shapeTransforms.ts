import { faceNormal, facePositions, type ModelMesh, type Vec3 } from './modeling.ts'

const dot=(a:Vec3,b:Vec3)=>a.reduce((sum,n,i)=>sum+n*b[i]!,0)
const subtract=(a:Vec3,b:Vec3)=>a.map((n,i)=>n-b[i]!) as Vec3
const normalize=(v:Vec3)=>{
  const length=Math.hypot(...v)
  if(length<1e-9)throw new Error('No unambiguous normal direction; choose an axis or a smaller selection')
  return v.map(n=>n/length) as Vec3
}
/** Newell vector weights each incident polygon by its oriented projected area. */
function areaNormal(points:Vec3[]):Vec3 {
  const sum:Vec3=[0,0,0]
  for(let i=0;i<points.length;i++){
    const a=points[i]!,b=points[(i+1)%points.length]!
    sum[0]+=(a[1]-b[1])*(a[2]+b[2]);sum[1]+=(a[2]-b[2])*(a[0]+b[0]);sum[2]+=(a[0]-b[0])*(a[1]+b[1])
  }
  return sum
}
type ShapeOperation =
  | {type:'shrink-fatten'|'push-pull';vertexIds:string[];distance:number}
  | {type:'flatten';vertexIds:string[];plane:'average'|'x'|'y'|'z';strength:number}

export function shapeTransform(mesh:ModelMesh,op:ShapeOperation){
  const selected=new Set(op.vertexIds), vertices=mesh.vertices.filter(v=>selected.has(v.id))
  if(selected.size!==op.vertexIds.length||vertices.length!==selected.size)throw new Error('Select distinct known vertices')
  const positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
  const center=vertices.reduce<Vec3>((sum,v)=>sum.map((n,i)=>n+v.position[i]!/vertices.length) as Vec3,[0,0,0])
  const normals=new Map<string,Vec3>()
  let planeNormal:Vec3=[0,0,0]
  if(op.type==='shrink-fatten'||(op.type==='flatten'&&op.plane==='average')){
    const enclosed=mesh.faces.filter(f=>f.vertices.every(id=>selected.has(id)))
    const planeFaces=new Set((enclosed.length?enclosed:mesh.faces.filter(f=>f.vertices.some(id=>selected.has(id)))).map(f=>f.id))
    for(const face of mesh.faces){
      if(!face.vertices.some(id=>selected.has(id)))continue
      const normal=areaNormal(facePositions(mesh,face,positions))
      if(planeFaces.has(face.id))planeNormal=planeNormal.map((n,i)=>n+normal[i]!) as Vec3
      for(const id of face.vertices)if(selected.has(id)){
        const current=normals.get(id)??[0,0,0]
        normals.set(id,current.map((n,i)=>n+normal[i]!) as Vec3)
      }
    }
  }
  if(op.type==='flatten'){
    if(vertices.length<3)throw new Error('Flatten requires at least three selected vertices')
    planeNormal=op.plane==='average'?normalize(planeNormal):op.plane==='x'?[1,0,0]:op.plane==='y'?[0,1,0]:[0,0,1]
  }else if(Math.abs(op.distance)<1e-7)throw new Error('Distance must be nonzero')
  const updates=new Map<string,Vec3>()
  for(const vertex of vertices){
    let move:Vec3
    if(op.type==='flatten')move=planeNormal.map(n=>-n*dot(subtract(vertex.position,center),planeNormal)*op.strength) as Vec3
    else if(op.type==='shrink-fatten'){
      const normal=normals.get(vertex.id)
      if(!normal)throw new Error('Loose vertices have no surface normal')
      move=normalize(normal).map(n=>n*op.distance) as Vec3
    }else{
      const radial=subtract(vertex.position,center),length=Math.hypot(...radial)
      if(length<1e-9)throw new Error('A selected vertex lies at the pivot; choose a different selection')
      if(length+op.distance<1e-7)throw new Error('Push/Pull would reach or cross the pivot')
      move=radial.map(n=>n/length*op.distance) as Vec3
    }
    updates.set(vertex.id,vertex.position.map((n,i)=>n+move[i]!) as Vec3)
  }
  if(!vertices.some(v=>Math.hypot(...subtract(updates.get(v.id)!,v.position))>1e-8))throw new Error('The selection is already on the target plane')
  // Reject local reversals before committing positions. Global intersections are not tested.
  const nextPositions=new Map([...positions,...updates])
  for(const face of mesh.faces){
    if(!face.vertices.some(id=>selected.has(id)))continue
    if(dot(faceNormal(facePositions(mesh,face,positions)),faceNormal(facePositions(mesh,face,nextPositions)))<=1e-8)throw new Error('Transform would reverse or collapse a face')
    for(let i=0;i<face.vertices.length;i++){
      const a=face.vertices[i]!,b=face.vertices[(i+1)%face.vertices.length]!
      if(dot(subtract(positions.get(b)!,positions.get(a)!),subtract(nextPositions.get(b)!,nextPositions.get(a)!))<=1e-10)throw new Error('Transform would reverse or collapse an edge')
    }
  }
  for(const vertex of vertices)vertex.position=updates.get(vertex.id)!
}
