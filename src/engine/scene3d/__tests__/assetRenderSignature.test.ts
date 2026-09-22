import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, watch } from 'vue'
import { createModel, publishModel } from '../../../../shared/modeling'
import type { MediaAsset } from '@/models/editor'
import { assetRenderSignature } from '../assetRenderSignature'

describe('render asset dependencies',()=>{
  it('ignores draft vertex edits but redraws after publication and image metadata changes',async()=>{
    const assets=reactive<MediaAsset[]>([{id:'native',name:'Native',kind:'model3d',nativeModel:createModel()}])
    const redraw=vi.fn(),stop=watch(()=>assetRenderSignature(assets),redraw)
    try {
      assets[0]!.nativeModel!.draft.mesh.vertices[0]!.position[0]=-.8
      await nextTick();expect(redraw).not.toHaveBeenCalled()
      publishModel(assets[0]!.nativeModel!,1)
      await nextTick();expect(redraw).toHaveBeenCalledTimes(1)
      assets.push({id:'image',name:'Image',kind:'image',hash:'a'.repeat(64),dimensions:'100 × 100'})
      await nextTick();expect(redraw).toHaveBeenCalledTimes(2)
      assets[1]!.dimensions='200 × 100'
      await nextTick();expect(redraw).toHaveBeenCalledTimes(3)
      assets[1]!.hash='b'.repeat(64)
      await nextTick();expect(redraw).toHaveBeenCalledTimes(4)
    } finally {stop()}
  })
})
