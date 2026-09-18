import * as THREE from 'three'
import { faceNormal, facePositions, type ModelMesh } from '../../../shared/modeling'

/** Render buffers are disposable derivatives; face IDs belong to the polygon source. */
export function modelGeometry(mesh: ModelMesh) {
  const positions: number[] = [], uvs: number[] = [], faceIds: string[] = []
  const vertices = new Map(mesh.vertices.map(v => [v.id,v.position]))
  for (const face of mesh.faces) {
    const points = facePositions(mesh,face,vertices)
    const normal = faceNormal(points)
    const axis = Math.abs(normal[0]) > Math.abs(normal[1]) && Math.abs(normal[0]) > Math.abs(normal[2]) ? 0 : Math.abs(normal[1]) > Math.abs(normal[2]) ? 1 : 2
    for (let i=1;i<points.length-1;i++) {
      for (const p of [points[0]!,points[i]!,points[i+1]!]) { positions.push(...p); uvs.push(...(axis === 0 ? [p[2],p[1]] : axis === 1 ? [p[0],p[2]] : [p[0],p[1]])) }
      faceIds.push(face.id)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
  geometry.computeVertexNormals(); geometry.computeBoundingSphere()
  geometry.userData.faceIds = faceIds
  return geometry
}
