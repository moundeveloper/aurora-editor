import * as THREE from 'three'
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg'

/** Both inputs are cloned: BVH metadata must never attach to the reusable primitive. */
export function booleanGeometry(source:THREE.BufferGeometry,target:THREE.BufferGeometry,matrix:THREE.Matrix4,operation:number) {
  if(source.getAttribute('position').count+target.getAttribute('position').count>240000)return source
  const a=new Brush(source.clone()),b=new Brush(target.clone().applyMatrix4(matrix))
  for(const brush of [a,b]) {
    if(!brush.geometry.getAttribute('normal'))brush.geometry.computeVertexNormals()
    if(!brush.geometry.getAttribute('uv'))brush.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(brush.geometry.getAttribute('position').count*2),2))
    brush.updateMatrixWorld(true)
  }
  const evaluator=new Evaluator();evaluator.useGroups=false
  try {
    const result=evaluator.evaluate(a,b,[SUBTRACTION,ADDITION,INTERSECTION][Math.max(0,Math.min(2,Math.round(operation)))]!)
    return result.geometry
  } finally { a.disposeCacheData();b.disposeCacheData();a.geometry.dispose();b.geometry.dispose() }
}
