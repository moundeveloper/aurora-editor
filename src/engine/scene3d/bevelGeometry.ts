import * as THREE from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'

/** Chamfer sharp edges of low-poly convex solids by intersecting their supporting planes. */
export function bevelGeometry(geometry: THREE.BufferGeometry, width: number) {
  if(width<=1e-6)return geometry
  const attribute=geometry.getAttribute('position'),index=geometry.getIndex()
  const points=Array.from({length:attribute.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(attribute,i))
  const planes:THREE.Plane[]=[],edges=new Map<string,{point:THREE.Vector3;planes:number[]}>()
  const key=(point:THREE.Vector3)=>point.toArray().map(value=>Math.round(value*1e6)).join(',')
  for(let i=0;i+2<(index?.count ?? attribute.count);i+=3) {
    const triangle=[0,1,2].map(offset=>points[index ? index.getX(i+offset) : i+offset]!)
    const plane=new THREE.Plane().setFromCoplanarPoints(triangle[0]!,triangle[1]!,triangle[2]!)
    if(plane.normal.lengthSq()<.5)continue
    let planeId=planes.findIndex(existing=>existing.normal.distanceToSquared(plane.normal)<1e-10 && Math.abs(existing.constant-plane.constant)<1e-6)
    if(planeId<0){planeId=planes.length;planes.push(plane)}
    if(planes.length>32)return geometry
    for(let corner=0;corner<3;corner++) {
      const a=triangle[corner]!,b=triangle[(corner+1)%3]!,edgeKey=[key(a),key(b)].sort().join('|')
      const edge=edges.get(edgeKey) ?? {point:a,planes:[]}
      if(!edge.planes.includes(planeId))edge.planes.push(planeId)
      edges.set(edgeKey,edge)
    }
  }
  if(planes.length<4 || points.some(point=>planes.some(plane=>plane.distanceToPoint(point)>1e-5)))return geometry
  const bounds=new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3())
  width=Math.min(width,Math.min(bounds.x,bounds.y,bounds.z)*.45)
  const original=[...planes]
  for(const edge of edges.values())if(edge.planes.length===2) {
    const a=original[edge.planes[0]!]!,b=original[edge.planes[1]!]!
    if(a.normal.dot(b.normal)>.99999)continue
    const normal=a.normal.clone().add(b.normal).normalize()
    planes.push(new THREE.Plane(normal,-normal.dot(edge.point)+width*Math.sqrt(Math.max(0,(1-a.normal.dot(b.normal))/2))))
  }
  if(planes.length>64)return geometry
  const vertices=new Map<string,THREE.Vector3>()
  for(let i=0;i<planes.length;i++)for(let j=i+1;j<planes.length;j++)for(let k=j+1;k<planes.length;k++) {
    const a=planes[i]!,b=planes[j]!,c=planes[k]!,cross=b.normal.clone().cross(c.normal),det=a.normal.dot(cross)
    if(Math.abs(det)<1e-8)continue
    const point=cross.multiplyScalar(-a.constant).addScaledVector(c.normal.clone().cross(a.normal),-b.constant).addScaledVector(a.normal.clone().cross(b.normal),-c.constant).divideScalar(det)
    if(planes.every(plane=>plane.distanceToPoint(point)<1e-5))vertices.set(key(point),point)
  }
  if(vertices.size<4)return geometry
  const result=new ConvexGeometry([...vertices.values()]),position=result.getAttribute('position'),normal=result.getAttribute('normal'),uv:number[]=[]
  for(let i=0;i<position.count;i++) {
    const n=new THREE.Vector3().fromBufferAttribute(normal,i),p=new THREE.Vector3().fromBufferAttribute(position,i)
    uv.push(Math.abs(n.x)>.5 ? p.z : p.x,Math.abs(n.y)>.5 ? p.z : p.y)
  }
  result.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
  return result
}
