import { afterEach, expect, it, vi } from 'vitest'
import type { SerializedEditorState } from '@/models/editor'

const database=vi.hoisted(()=>({saveSnapshot:vi.fn(),setActiveProject:vi.fn()}))
vi.mock('@/engine/project/AuroraProjectDatabase',()=>({auroraProjectDatabase:database}))
import { auroraProjectLibrary } from '../projectLibrary'

afterEach(()=>vi.unstubAllGlobals())

it('keeps a separate recoverable local branch when the server rejects a stale save',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'stale'}),{status:409})))
  const snapshot:SerializedEditorState={project:{id:'source',name:'Architecture',width:1920,height:1080,frameRate:30,duration:10,backgroundColor:'#000000',updatedAt:0,version:15},layers:[],assets:[],scenes3D:[],nodes:[],nodeConnections:[],rigs:[]}
  await expect(auroraProjectLibrary.saveSnapshot(snapshot)).rejects.toThrow('Local recovery')
  expect(database.saveSnapshot).toHaveBeenCalledTimes(2)
  const recovery=database.saveSnapshot.mock.calls[1]![0] as SerializedEditorState
  expect(recovery.project.id).not.toBe(snapshot.project.id)
  expect(recovery.project.name).toBe('Architecture — Local recovery')
  expect(snapshot.project.name).toBe('Architecture')
  expect(database.setActiveProject).toHaveBeenCalledWith('source')
})
