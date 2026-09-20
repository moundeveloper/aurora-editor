import { describe, it, expect } from 'vitest'
import { createModel, applyModelOperation } from '../../../../shared/modeling'
import { queryMeshSelection } from '../../../../shared/meshSelection'
import { meshTopology } from '../../../../shared/meshTopology'
import { topologyEdgeKey as edge } from '../../../../shared/loopCut'

describe('topology selection',()=>{
  it.each(['vertex','edge','face'] as const)('selects a connected cube in %s mode without mutation',mode=>{
    const mesh=createModel().draft.mesh, before=JSON.stringify(mesh)
    const ids=mode==='vertex'?mesh.vertices.map(v=>v.id):mode==='edge'?[...meshTopology(mesh).edges.keys()]:mesh.faces.map(f=>f.id)
    expect(new Set(queryMeshSelection(mesh,{mode,action:'linked',ids:[ids[0]!]}))).toEqual(new Set(ids))
    expect(JSON.stringify(mesh)).toBe(before)
  })
  it('does not cross detached regions or join coincident vertices',()=>{
    const base=createModel().draft
    const mesh=applyModelOperation(base,1,{type:'split',faceIds:['f5']}).mesh
    expect(queryMeshSelection(mesh,{mode:'face',action:'linked',ids:['f5']})).toEqual(['f5'])
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'path',ids:['f5','f0']})).toThrow(/disconnected/)
    expect(queryMeshSelection(mesh,{mode:'face',action:'linked',ids:['f5','f0']})).toHaveLength(6)
  })
  it('selects shortest vertex paths through authored edges in endpoint order',()=>{
    const mesh=createModel().draft.mesh,query={mode:'vertex' as const,action:'path' as const,ids:['v0','v6']}
    const path=queryMeshSelection(mesh,query), edges=meshTopology(mesh).edges
    expect(path).toHaveLength(4);expect(path[0]).toBe('v0');expect(path[3]).toBe('v6')
    path.slice(1).forEach((v,i)=>expect(edges.has(edge(path[i]!,v))).toBe(true))
    expect(queryMeshSelection(mesh,query)).toEqual(path)
  })
  it('finds paths between edges and between faces',()=>{
    const mesh=createModel().draft.mesh
    expect(queryMeshSelection(mesh,{mode:'edge',action:'path',ids:[edge('v0','v1'),edge('v6','v7')]})).toHaveLength(4)
    expect(queryMeshSelection(mesh,{mode:'face',action:'path',ids:['f0','f1']})).toHaveLength(3)
  })
  it('grows one ring rather than flooding the component',()=>{
    const mesh=createModel().draft.mesh
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'grow',ids:['v0']})).toHaveLength(4)
    expect(queryMeshSelection(mesh,{mode:'edge',action:'grow',ids:[edge('v0','v1')]})).toHaveLength(5)
    const faces=queryMeshSelection(mesh,{mode:'face',action:'grow',ids:['f5']})
    expect(faces).toHaveLength(5)
    expect(queryMeshSelection(mesh,{mode:'face',action:'shrink',ids:faces})).toEqual(['f5'])
  })
  it('shrinks open boundaries and retains fully selected closed components',()=>{
    const base=createModel('plane').draft
    const mesh=applyModelOperation(base,1,{type:'subdivide',mode:'face',ids:['f0'],cuts:2}).mesh
    expect(queryMeshSelection(mesh,{mode:'face',action:'shrink',ids:mesh.faces.map(f=>f.id)})).toHaveLength(1)
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'shrink',ids:mesh.vertices.map(v=>v.id)})).toHaveLength(4)
    const cube=createModel().draft.mesh
    expect(queryMeshSelection(cube,{mode:'face',action:'shrink',ids:cube.faces.map(f=>f.id)})).toHaveLength(6)
  })
  it('handles isolated vertices and inversion including empty selections',()=>{
    const mesh=createModel('plane').draft.mesh;mesh.vertices.push({id:'loose',position:[3,0,0]})
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'linked',ids:['loose']})).toEqual(['loose'])
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'shrink',ids:['loose']})).toEqual([])
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'invert',ids:[]})).toHaveLength(5)
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'invert',ids:['loose']})).toHaveLength(4)
  })
  it('rejects stale IDs, duplicates and invalid path endpoints',()=>{
    const mesh=createModel().draft.mesh
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'linked',ids:['v0']})).toThrow(/Unknown/)
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'path',ids:['f0','f0']})).toThrow(/distinct/)
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'path',ids:['f0']})).toThrow(/exactly two/)
    expect(()=>queryMeshSelection(mesh,{mode:'face',action:'grow',ids:[]})).toThrow(/at least one/)
  })
})
