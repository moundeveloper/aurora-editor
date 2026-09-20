import { describe,it,expect } from 'vitest'
import { createPinia,setActivePinia } from 'pinia'
import { createModel,applyModelOperation,type ModelOperation } from '../../../../shared/modeling'
import { queryMeshSelection } from '../../../../shared/meshSelection'
import { useEditorStore } from '@/stores/editor'
import { serializeEditorState,deserializeEditorState } from '@/engine/project/serialization'
const planeGrid=()=>{const base=createModel('plane').draft;return applyModelOperation(base,1,{type:'subdivide',mode:'face',ids:['f0'],cuts:2})}

describe('checker deselection',()=>{
  it('alternates selected grid rings and preserves source selection order',()=>{
    const mesh=planeGrid().mesh,ids=mesh.faces.map(f=>f.id)
    const a=queryMeshSelection(mesh,{mode:'face',action:'checker',ids})
    const b=queryMeshSelection(mesh,{mode:'face',action:'checker',ids,offset:1})
    expect(a.length+b.length).toBe(9);expect(a.some(id=>b.includes(id))).toBe(false)
    expect(a).toContain(ids[0]);expect(a.length).toBe(5)
    expect(queryMeshSelection(mesh,{mode:'face',action:'checker',ids,keep:2,skip:1})).toHaveLength(6)
  })
  it('supports edge and vertex patterns and restarts disconnected selections',()=>{
    const mesh=createModel('plane').draft.mesh
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'checker',ids:['v0','v1','v2','v3']})).toEqual(['v0','v2'])
    expect(queryMeshSelection(mesh,{mode:'vertex',action:'checker',ids:['v0','v2']})).toEqual(['v0','v2'])
    const edges=['["v0","v1"]','["v1","v2"]','["v2","v3"]','["v0","v3"]']
    expect(queryMeshSelection(mesh,{mode:'edge',action:'checker',ids:edges})).toEqual([edges[0],edges[2]])
    expect(()=>queryMeshSelection(mesh,{mode:'vertex',action:'checker',ids:['v0'],skip:0})).toThrow()
  })
})
describe('named selection sets',()=>{
  it('saves ordered IDs, rejects duplicate names, explicitly updates and deletes',()=>{
    const base=createModel().draft
    const saved=applyModelOperation(base,1,{type:'selection-set-save',name:'  Corners  ',mode:'vertex',ids:['v2','v0']})
    expect(saved.selectionSets).toEqual([{name:'Corners',mode:'vertex',ids:['v2','v0']}])
    expect(saved.mesh).toEqual(base.mesh);expect(base.selectionSets).toBeUndefined()
    expect(()=>applyModelOperation(saved,2,{type:'selection-set-save',name:'Corners',mode:'face',ids:['f0']})).toThrow(/already exists/)
    const updated=applyModelOperation(saved,2,{type:'selection-set-save',name:'Corners',mode:'face',ids:['f0'],replace:true})
    expect(updated.selectionSets![0]!.mode).toBe('face')
    expect(applyModelOperation(updated,3,{type:'selection-set-delete',name:'Corners'}).selectionSets).toEqual([])
  })
  it('prunes invalidated face, edge, and vertex references without selecting new IDs',()=>{
    let draft=createModel().draft
    const save=(name:string,mode:'vertex'|'edge'|'face',ids:string[])=>{draft=applyModelOperation(draft,draft.revision,{type:'selection-set-save',name,mode,ids})}
    save('vertex','vertex',['v0','v6']);save('edge','edge',['["v0","v1"]']);save('face','face',['f0','f1'])
    const result=applyModelOperation(draft,draft.revision,{type:'delete',mode:'vertex',ids:['v0']})
    expect(result.selectionSets).toEqual([{name:'vertex',mode:'vertex',ids:['v6']},{name:'edge',mode:'edge',ids:[]},{name:'face',mode:'face',ids:['f1']}])
    expect(draft.selectionSets![0]!.ids).toEqual(['v0','v6'])
  })
  it('rejects stale writes, invalid IDs, empty names, unknown deletes and the set limit atomically',()=>{
    const base=createModel().draft,before=JSON.stringify(base)
    const save:ModelOperation={type:'selection-set-save',name:'test',mode:'face',ids:['f0']}
    expect(()=>applyModelOperation(base,2,save)).toThrow(/Stale/)
    expect(()=>applyModelOperation(base,1,{...save,ids:['v0']})).toThrow(/unknown/)
    expect(()=>applyModelOperation(base,1,{...save,name:'  '})).toThrow()
    expect(()=>applyModelOperation(base,1,{...save,replace:true})).toThrow(/Unknown/)
    expect(()=>applyModelOperation(base,1,{type:'selection-set-delete',name:'missing'})).toThrow(/Unknown/)
    expect(JSON.stringify(base)).toBe(before)
    base.selectionSets=Array.from({length:64},(_,i)=>({name:`set${i}`,mode:'face',ids:['f0']}))
    expect(()=>applyModelOperation(base,1,save)).toThrow(/64/)
  })
  it('roundtrips project storage and supports undo/redo of set writes and pruning',()=>{
    setActivePinia(createPinia());const store=useEditorStore(),asset=store.createNativeModel()
    store.editNativeModel(asset.id,1,{type:'selection-set-save',name:'Top',mode:'face',ids:['f5']})
    const state={project:store.project,layers:store.layers,scenes3D:store.scenes3D,assets:store.assets,nodes:store.nodes,nodeConnections:store.nodeConnections,rigs:store.rigs}
    const loaded=deserializeEditorState(serializeEditorState(state),state).assets.find(a=>a.id===asset.id)!.nativeModel!.draft
    expect(loaded.selectionSets).toEqual([{name:'Top',mode:'face',ids:['f5']}])
    store.editNativeModel(asset.id,2,{type:'delete',mode:'face',ids:['f5']})
    expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.selectionSets![0]!.ids).toEqual([])
    store.undo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.selectionSets![0]!.ids).toEqual(['f5'])
    store.undo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.selectionSets).toBeUndefined()
    store.redo();expect(store.assets.find(a=>a.id===asset.id)!.nativeModel!.draft.selectionSets).toEqual(loaded.selectionSets)
  })
})
