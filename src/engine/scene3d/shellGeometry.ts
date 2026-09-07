import * as THREE from 'three'

/** Weld positions for topology only; original UV seams stay separate in emitted triangles. */
function topology(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'), index = geometry.getIndex()
  const vertices = Array.from({length:position.count},(_,i) => new THREE.Vector3().fromBufferAttribute(position,i))
  const key = (i:number) => vertices[i]!.toArray().map(value => Math.round(value*1e6)).join(',')
  const triangles: number[][] = [], edges = new Map<string,{a:number;b:number;count:number}>(), normals = new Map<string,THREE.Vector3>()
  for(let i=0;i+2<(index?.count ?? position.count);i+=3) {
    const face = [0,1,2].map(offset => index ? index.getX(i+offset) : i+offset)
    const normal = vertices[face[1]!]!.clone().sub(vertices[face[0]!]!).cross(vertices[face[2]!]!.clone().sub(vertices[face[0]!]!))
    if (normal.lengthSq()<1e-18) continue
    triangles.push(face)
    for(let corner=0;corner<3;corner++) {
      const a = face[corner]!, b = face[(corner+1)%3]!, from=key(a),to=key(b),edgeKey=[from,to].sort().join('|')
      const edge=edges.get(edgeKey)
      if(edge) edge.count++; else edges.set(edgeKey,{a,b,count:1})
      if(!normals.has(from)) normals.set(from,new THREE.Vector3())
      normals.get(from)!.add(normal)
    }
  }
  return {vertices,triangles,boundary:[...edges.values()].filter(edge=>edge.count===1),normals:vertices.map((_,i)=>normals.get(key(i))?.clone().normalize() ?? new THREE.Vector3())}
}

function emitter() {
  const positions:number[]=[],uvs:number[]=[]
  return {
    triangle(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,uv: number[][] = [[0,0],[1,0],[1,1]]) { positions.push(...a.toArray(),...b.toArray(),...c.toArray());uvs.push(...uv.flat()) },
    finish() { const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));result.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));result.computeVertexNormals();return result },
  }
}
export function solidifyGeometry(geometry:THREE.BufferGeometry,thickness:number) {
  if(Math.abs(thickness)<1e-6)return geometry
  const {vertices,triangles,boundary,normals}=topology(geometry)
  if((triangles.length*2+boundary.length*2)*3>240000)return geometry
  const inner=vertices.map((point,i)=>point.clone().addScaledVector(normals[i]!,-thickness)),out=emitter(),uv=geometry.getAttribute('uv')
  const tex=(indices:number[])=>indices.map(index=>uv ? [uv.getX(index),uv.getY(index)] : [0,0])
  for(const face of triangles) {
    const [a,b,c]=face as [number,number,number]
    if(thickness>0) {out.triangle(vertices[a]!,vertices[b]!,vertices[c]!,tex([a,b,c]));out.triangle(inner[c]!,inner[b]!,inner[a]!,tex([c,b,a]))}
    else {out.triangle(vertices[c]!,vertices[b]!,vertices[a]!,tex([c,b,a]));out.triangle(inner[a]!,inner[b]!,inner[c]!,tex([a,b,c]))}
  }
  for(const {a,b} of boundary) {
    if(thickness>0) {out.triangle(vertices[b]!,vertices[a]!,inner[a]!);out.triangle(vertices[b]!,inner[a]!,inner[b]!)}
    else {out.triangle(vertices[a]!,vertices[b]!,inner[b]!);out.triangle(vertices[a]!,inner[b]!,inner[a]!)}
  }
  return out.finish()
}

/** Sweep the boundary of an open surface around local Y, with optional axial pitch. */
export function screwGeometry(geometry:THREE.BufferGeometry,angle:number,pitch:number,steps:number) {
  const {vertices,triangles,boundary}=topology(geometry)
  steps=Math.max(1,Math.min(128,Math.round(steps)))
  if(!boundary.length || Math.abs(angle)+Math.abs(pitch)<1e-6 || (boundary.length*steps*2+triangles.length*2)*3>240000)return geometry
  const radians=THREE.MathUtils.degToRad(angle),out=emitter()
  const at=(index:number,t:number)=>vertices[index]!.clone().applyAxisAngle(new THREE.Vector3(0,1,0),radians*t).add(new THREE.Vector3(0,pitch*t,0))
  for(let step=0;step<steps;step++)for(const {a,b} of boundary) {
    const p=at(a,step/steps),q=at(b,step/steps),r=at(b,(step+1)/steps),s=at(a,(step+1)/steps)
    out.triangle(p,q,r,[[step/steps,0],[step/steps,1],[(step+1)/steps,1]])
    out.triangle(p,r,s,[[step/steps,0],[(step+1)/steps,1],[(step+1)/steps,0]])
  }
  if(Math.abs(angle%360)>1e-6 || Math.abs(pitch)>1e-6)for(const face of triangles) {
    const [a,b,c]=face as [number,number,number]
    out.triangle(at(c,0),at(b,0),at(a,0));out.triangle(at(a,1),at(b,1),at(c,1))
  }
  return out.finish()
}
