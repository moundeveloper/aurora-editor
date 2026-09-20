import { describe,it,expect } from 'vitest'
import { createModel,applyModelOperation,validateMesh,type ModelDraft,type ModelOperation } from '../../../../shared/modeling'
const apply=(d:ModelDraft,op:ModelOperation)=>applyModelOperation(d,d.revision,op)
const ids=(d:ModelDraft)=>d.mesh.vertices.map(v=>v.id)
describe('shape transforms',()=>{
  it('offsets cube vertices along normalized normals without changing topology',()=>{
    const base=createModel().draft,result=apply(base,{type:'shrink-fatten',vertexIds:ids(base),distance:.3})
    expect(validateMesh(result.mesh)).toEqual(validateMesh(base.mesh))
    result.mesh.vertices.forEach((v,i)=>v.position.forEach((n,j)=>expect(n).toBeCloseTo(base.mesh.vertices[i]!.position[j]!*(1+.3/Math.sqrt(3)))))
    expect(result.mesh.faces).toEqual(base.mesh.faces)
  })
  it('uses all incident faces and moves only selected vertices',()=>{
    const base=createModel().draft,result=apply(base,{type:'shrink-fatten',vertexIds:['v0'],distance:.1})
    expect(result.mesh.vertices.slice(1)).toEqual(base.mesh.vertices.slice(1))
    expect(result.mesh.vertices[0]!.position[0]).toBeCloseTo(-1-.1/Math.sqrt(3))
  })
  it('pushes by fixed radial distance and preserves center',()=>{
    const base=createModel('plane').draft,result=apply(base,{type:'push-pull',vertexIds:ids(base),distance:.5})
    for(const v of result.mesh.vertices)expect(Math.hypot(...v.position)).toBeCloseTo(Math.sqrt(2)+.5)
    expect(()=>apply(base,{type:'push-pull',vertexIds:ids(base),distance:-2})).toThrow(/pivot/)
  })
  it('flattens a bent quad to an axis plane through its centroid',()=>{
    const base=createModel('plane').draft;base.mesh.vertices[0]!.position[1]=.4
    const result=apply(base,{type:'flatten',vertexIds:ids(base),plane:'y',strength:1})
    for(const v of result.mesh.vertices)expect(v.position[1]).toBeCloseTo(.1)
    expect(result.mesh.faces).toEqual(base.mesh.faces)
    const partial=apply(base,{type:'flatten',vertexIds:ids(base),plane:'y',strength:.5})
    expect(partial.mesh.vertices[0]!.position[1]).toBeCloseTo(.25)
    expect(partial.mesh.vertices[1]!.position[1]).toBeCloseTo(.05)
  })
  it('projects onto an averaged surface plane and preserves its center',()=>{
    const base=createModel('plane').draft;base.mesh.vertices[0]!.position[1]=.4
    const result=apply(base,{type:'flatten',vertexIds:ids(base),plane:'average',strength:1})
    const p=result.mesh.vertices.map(v=>v.position),a=p[0]!,b=p[1]!.map((n,i)=>n-a[i]!),c=p[2]!.map((n,i)=>n-a[i]!),d=p[3]!.map((n,i)=>n-a[i]!)
    const cross=[b[1]!*c[2]!-b[2]!*c[1]!,b[2]!*c[0]!-b[0]!*c[2]!,b[0]!*c[1]!-b[1]!*c[0]!]
    expect(cross.reduce((s,n,i)=>s+n*d[i]!,0)).toBeCloseTo(0)
    expect(p.reduce((s,v)=>s+v[1],0)/4).toBeCloseTo(.1)
  })
  it('rejects ambiguous normals, collapse, no-op, missing and duplicate IDs atomically',()=>{
    const base=createModel().draft,before=JSON.stringify(base)
    expect(()=>apply(base,{type:'flatten',vertexIds:ids(base),plane:'average',strength:1})).toThrow(/normal/)
    expect(()=>apply(base,{type:'flatten',vertexIds:ids(base),plane:'y',strength:1})).toThrow()
    expect(()=>apply(base,{type:'shrink-fatten',vertexIds:ids(base),distance:-2})).toThrow(/reverse/)
    expect(()=>apply(base,{type:'shrink-fatten',vertexIds:['missing'],distance:.2})).toThrow(/known/)
    expect(()=>apply(base,{type:'shrink-fatten',vertexIds:['v0','v0'],distance:.2})).toThrow(/distinct/)
    expect(JSON.stringify(base)).toBe(before)
    const plane=createModel('plane').draft
    expect(()=>apply(plane,{type:'flatten',vertexIds:ids(plane),plane:'y',strength:1})).toThrow(/already/)
    plane.mesh.vertices.push({id:'loose',position:[0,2,0]})
    expect(()=>apply(plane,{type:'shrink-fatten',vertexIds:['loose'],distance:.1})).toThrow(/Loose/)
  })
})
