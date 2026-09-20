import { describe,it,expect } from 'vitest'
import { createModel,applyModelOperation,validateMesh,type Vec3 } from '../../../../shared/modeling'
import { queryMeshSelection } from '../../../../shared/meshSelection'
import { topologyEdgeKey as edge } from '../../../../shared/loopCut'

describe('selection by property',()=>{
  it('matches face area, corners and oriented normals',()=>{
    const mesh=createModel().draft.mesh
    expect(queryMeshSelection(mesh,{mode:'face',action:'similar',ids:['f0'],property:'area'})).toHaveLength(6)
    expect(queryMeshSelection(mesh,{mode:'face',action:'similar',ids:['f0'],property:'corners'})).toHaveLength(6)
    expect(queryMeshSelection(mesh,{mode:'face',action:'similar',ids:['f0'],property:'normal'})).toEqual(['f0'])
    expect(queryMeshSelection(mesh,{mode:'face',action:'similar',ids:['f0'],property:'normal',tolerance:90})).toHaveLength(5)
    expect(queryMeshSelection(mesh,{mode:'face',action:'similar',ids:['f0'],property:'normal',tolerance:180})).toHaveLength(6)
  })
  it('uses absolute length tolerance and matches any seed without transitive expansion',()=>{
    const mesh=createModel('plane').draft.mesh
    mesh.vertices.filter(v=>v.position[0]>0).forEach(v=>v.position[0]=1.1)
    const query={mode:'edge' as const,action:'similar' as const,ids:[edge('v0','v1')],property:'length' as const}
    expect(queryMeshSelection(mesh,query)).toHaveLength(2)
    expect(queryMeshSelection(mesh,{...query,tolerance:.1})).toHaveLength(4)
    expect(queryMeshSelection(mesh,{...query,ids:[edge('v0','v1'),edge('v1','v2')]})).toHaveLength(4)
  })
  it('compares edge angles and rejects boundary reference edges',()=>{
    const mesh=createModel().draft.mesh
    expect(queryMeshSelection(mesh,{mode:'edge',action:'similar',ids:[edge('v0','v1')],property:'angle'})).toHaveLength(12)
    expect(()=>queryMeshSelection(createModel('plane').draft.mesh,{mode:'edge',action:'similar',ids:[edge('v0','v1')],property:'angle'})).toThrow(/interior/)
  })
  it('compares vertex connectivity and incident face count',()=>{
    const mesh=createModel().draft.mesh
    mesh.vertices.push({id:'loose',position:[3,0,0]})
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'similar',ids:['v0'],property:'degree'})).toHaveLength(8)
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'similar',ids:['loose'],property:'face-count'})).toEqual(['loose'])
    expect(queryMeshSelection(mesh,{mode:'edge',action:'similar',ids:[edge('v0','v1')],property:'face-count'})).toHaveLength(12)
  })
  it('detects open boundaries in every mode and never changes source',()=>{
    const mesh=createModel('plane').draft.mesh, before=JSON.stringify(mesh)
    for(const mode of ['vertex','edge','face'] as const){
      expect(queryMeshSelection(mesh,{mode,action:'trait',ids:[],trait:'boundary'})).toHaveLength(mode==='face'?1:4)
      expect(queryMeshSelection(mesh,{mode,action:'trait',ids:[],trait:'non-manifold'})).toHaveLength(mode==='face'?1:4)
      expect(queryMeshSelection(createModel().draft.mesh,{mode,action:'trait',ids:[],trait:'non-manifold'})).toEqual([])
    }
    expect(JSON.stringify(mesh)).toBe(before)
  })
  it('finds loose vertices and excludes boundaries and loose points from interior poles',()=>{
    const mesh=createModel().draft.mesh;mesh.vertices.push({id:'loose',position:[3,0,0]})
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'trait',ids:[],trait:'loose'})).toEqual(['loose'])
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'trait',ids:[],trait:'poles'})).toHaveLength(8)
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'trait',ids:[],trait:'non-manifold'})).toEqual(['loose'])
    const plane=createModel('plane').draft
    const grid=applyModelOperation(plane,1,{type:'subdivide',mode:'face',ids:['f0'],cuts:2}).mesh
    expect(queryMeshSelection(grid,{mode:'vertex',action:'trait',ids:[],trait:'poles'})).toEqual([])
  })
  it('detects disconnected closed face fans at a shared vertex',()=>{
    const mesh=createModel().draft.mesh, second=createModel().draft.mesh
    const mapped=(id:string)=>id==='v0'?'v6':`other-${id}`
    mesh.vertices.push(...second.vertices.filter(v=>v.id!=='v0').map(v=>({id:mapped(v.id),position:v.position.map(n=>n+2) as Vec3})))
    mesh.faces.push(...second.faces.map(f=>({id:`other-${f.id}`,vertices:f.vertices.map(mapped)})))
    validateMesh(mesh)
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'trait',ids:[],trait:'non-manifold'})).toEqual(['v6'])
    expect(queryMeshSelection(mesh,{mode:'edge',action:'trait',ids:[],trait:'non-manifold'})).toEqual([])
    expect(queryMeshSelection(mesh,{mode:'face',action:'trait',ids:[],trait:'non-manifold'})).toHaveLength(6)
  })
  it('rejects missing parameters, incompatible modes and invalid tolerances',()=>{
    const mesh=createModel().draft.mesh
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'trait',ids:[]})).toThrow(/trait/)
    expect(()=>queryMeshSelection(mesh,{mode:'edge',action:'trait',ids:[],trait:'loose'})).toThrow(/Vertex/)
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'similar',ids:['f0'],property:'length'})).toThrow(/supported/)
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'similar',ids:[],property:'area'})).toThrow(/reference/)
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'similar',ids:['f0'],property:'area',tolerance:-1})).toThrow()
  })
})
