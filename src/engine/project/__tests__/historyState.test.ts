import { describe, expect, it } from 'vitest'
import { HistoryStatePool } from '../historyState'
import { createModel, publishModel } from '../../../../shared/modeling'
import { serializeEditorState } from '../serialization'
import type { SerializedEditorState } from '@/models/editor'

describe('history state sharing',()=>{
  it('shares only immutable publications while keeping drafts and editable state independent',()=>{
    const model=createModel();publishModel(model,1)
    const state:SerializedEditorState={project:{id:'test',name:'Test',width:100,height:100,frameRate:30,duration:10,backgroundColor:'#000000',updatedAt:0,version:15},layers:[],assets:[{id:'model',name:'Model',kind:'model3d',nativeModel:model}],scenes3D:[],nodes:[],nodeConnections:[],rigs:[]}
    const pool=new HistoryStatePool(),a=pool.clone(state),b=pool.clone(state)
    const first=pool.capture(state),unchanged=pool.capture(state)
    expect(unchanged).toBe(first)
    model.draft.mesh.vertices[0]!.position[0]=7
    const edited=pool.capture(state)
    expect(edited).not.toBe(first)
    expect(edited.layers).toBe(first.layers)
    expect(edited.assets[0]!.nativeModel!.draft.mesh.vertices[1]).toBe(first.assets[0]!.nativeModel!.draft.mesh.vertices[1])
    expect(first.assets[0]!.nativeModel!.draft.mesh.vertices[0]!.position[0]).not.toBe(7)
    const thawed=pool.clone(edited);thawed.assets[0]!.nativeModel!.draft.mesh.vertices[0]!.position[0]=8
    expect(edited.assets[0]!.nativeModel!.draft.mesh.vertices[0]!.position[0]).toBe(7)
    const publication=a.assets[0]!.nativeModel!.revisions[0]!
    expect(b.assets[0]!.nativeModel!.revisions[0]).toBe(publication)
    expect(publication).not.toBe(model.revisions[0])
    expect(Object.isFrozen(publication.mesh.vertices[0]!.position)).toBe(true)
    expect(a.assets[0]!.nativeModel!.draft).not.toBe(b.assets[0]!.nativeModel!.draft)
    expect(pool.signature(a)).toBe(pool.signature(b))
    expect(pool.signature(a).length).toBeLessThan(serializeEditorState(a).length)
    b.assets[0]!.nativeModel!.draft.mesh.vertices[0]!.position[0]=99
    b.project.name='Edited'
    expect(a.assets[0]!.nativeModel!.draft.mesh.vertices[0]!.position[0]).not.toBe(99)
    expect(a.project.name).toBe('Test')
    expect(pool.signature(a)).not.toBe(pool.signature(b))
    const restored=pool.clone(a)
    expect(restored.assets[0]!.nativeModel!.revisions[0]).toBe(publication)
    expect(JSON.parse(serializeEditorState(restored))).toEqual(JSON.parse(serializeEditorState(a)))
    restored.assets[0]!.nativeModel!.draft.revision=2
    publishModel(restored.assets[0]!.nativeModel!,2)
    const next=pool.clone(restored)
    expect(next.assets[0]!.nativeModel!.revisions).toHaveLength(2)
    expect(a.assets[0]!.nativeModel!.revisions).toHaveLength(1)
  })
})
