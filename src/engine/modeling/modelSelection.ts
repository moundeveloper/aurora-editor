import * as THREE from 'three'
import type { ModelMesh, Vec3 } from '../../../shared/modeling'

export type SelectionMode = 'vertex' | 'edge' | 'face'
export interface MeshEdge { id:string; vertices:[string,string] }
export function meshEdges(mesh:ModelMesh):MeshEdge[] {
  const edges=new Map<string,MeshEdge>()
  for(const face of mesh.faces) for(let i=0;i<face.vertices.length;i++) {
    const vertices=[face.vertices[i]!,face.vertices[(i+1)%face.vertices.length]!].sort() as [string,string]
    const id=JSON.stringify(vertices)
    edges.set(id,{id,vertices})
  }
  return [...edges.values()]
}
export function selectionVertices(mesh:ModelMesh,mode:SelectionMode,ids:readonly string[]) {
  const selected=new Set(ids)
  if(mode==='vertex') return mesh.vertices.filter(v=>selected.has(v.id)).map(v=>v.id)
  return [...new Set((mode==='edge' ? meshEdges(mesh) : mesh.faces).filter(e=>selected.has(e.id)).flatMap(e=>e.vertices))]
}
export function convertSelection(mesh:ModelMesh,from:SelectionMode,to:SelectionMode,ids:readonly string[]) {
  const vertices=new Set(selectionVertices(mesh,from,ids))
  if(to==='vertex') return [...vertices]
  return (to==='edge' ? meshEdges(mesh) : mesh.faces).filter(e=>e.vertices.every(id=>vertices.has(id))).map(e=>e.id)
}
export function selectionCenter(mesh:ModelMesh,ids:readonly string[]) {
  const selected=new Set(ids), center=new THREE.Vector3(), vertices=mesh.vertices.filter(v=>selected.has(v.id))
  vertices.forEach(v=>center.add(new THREE.Vector3(...v.position)))
  return vertices.length ? center.divideScalar(vertices.length) : center
}
export function transformedVertices(mesh:ModelMesh,ids:readonly string[],matrix:THREE.Matrix4) {
  const selected=new Set(ids)
  return mesh.vertices.filter(v=>selected.has(v.id)).map(v=>({id:v.id,position:new THREE.Vector3(...v.position).applyMatrix4(matrix).toArray() as Vec3}))
}

/** All thresholds are pixels: selection remains usable at any zoom or model scale. */
export function pickMeshElement(mesh:ModelMesh,body:THREE.Mesh,camera:THREE.Camera,mode:SelectionMode,
  point:{x:number;y:number},viewport:{width:number;height:number},xray=false):string|null {
  camera.updateMatrixWorld(); body.updateMatrixWorld(true)
  const ray=new THREE.Raycaster(), ndc=new THREE.Vector2(point.x/viewport.width*2-1,1-point.y/viewport.height*2)
  ray.setFromCamera(ndc,camera)
  if(mode==='face') {
    const hit=ray.intersectObject(body,false)[0]
    return hit?.faceIndex!=null ? body.geometry.userData.faceIds[hit.faceIndex] ?? null : null
  }
  const project=(position:Vec3)=>{
    const p=new THREE.Vector3(...position).project(camera)
    return {x:(p.x+1)*viewport.width/2,y:(1-p.y)*viewport.height/2,z:p.z}
  }
  const visible=(position:THREE.Vector3)=>{
    if(xray)return true
    const p=position.clone().project(camera)
    ray.setFromCamera(new THREE.Vector2(p.x,p.y),camera)
    const hit=ray.intersectObject(body,false)[0]
    return !hit || hit.distance+Math.max(1e-5,hit.distance*1e-5)>=ray.ray.origin.distanceTo(position)
  }
  let nearest:string|null=null, best=11
  const positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
  if(mode==='vertex') for(const vertex of mesh.vertices) {
    const p=project(vertex.position), distance=Math.hypot(p.x-point.x,p.y-point.y)
    if(p.z>=-1 && p.z<=1 && distance<best && visible(new THREE.Vector3(...vertex.position))) {best=distance; nearest=vertex.id}
  }
  if(mode==='edge') for(const edge of meshEdges(mesh)) {
    const a=positions.get(edge.vertices[0])!,b=positions.get(edge.vertices[1])!,pa=project(a),pb=project(b)
    if(pa.z < -1 || pa.z > 1 || pb.z < -1 || pb.z > 1)continue
    const dx=pb.x-pa.x,dy=pb.y-pa.y
    const t=THREE.MathUtils.clamp(((point.x-pa.x)*dx+(point.y-pa.y)*dy)/(dx*dx+dy*dy || 1),0,1)
    const distance=Math.hypot(point.x-pa.x-t*dx,point.y-pa.y-t*dy)
    // Perspective-correct interpolation yields the point whose projection is nearest the cursor.
    const va=new THREE.Vector3(...a).applyMatrix4(camera.matrixWorldInverse),vb=new THREE.Vector3(...b).applyMatrix4(camera.matrixWorldInverse)
    const perspective=camera instanceof THREE.PerspectiveCamera
    const u=perspective ? (t/-vb.z)/((1-t)/-va.z+t/-vb.z) : t
    if(distance<best && visible(new THREE.Vector3(...a).lerp(new THREE.Vector3(...b),u))) {best=distance; nearest=edge.id}
  }
  return nearest
}
