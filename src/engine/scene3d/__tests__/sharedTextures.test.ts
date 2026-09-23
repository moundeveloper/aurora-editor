import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { acquireTexture } from '../sharedTextures'
afterEach(()=>vi.restoreAllMocks())
describe('texture leases',()=>{
  it('shares loads across viewports and disposes only after the final release',async()=>{
    const texture=new THREE.Texture(),dispose=vi.spyOn(texture,'dispose')
    const load=vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockResolvedValue(texture)
    const a=acquireTexture('shared-test',true),b=acquireTexture('shared-test',true)
    expect(await a.promise).toBe(await b.promise);expect(load).toHaveBeenCalledTimes(1)
    a.release();await Promise.resolve();expect(dispose).not.toHaveBeenCalled()
    b.release();await Promise.resolve();expect(dispose).toHaveBeenCalledTimes(1)
    b.release();expect(dispose).toHaveBeenCalledTimes(1)
  })
  it('safely releases pending loads and keeps color/data variants separate',async()=>{
    let finish!:(value:THREE.Texture)=>void
    vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    const texture=new THREE.Texture(),dispose=vi.spyOn(texture,'dispose'),a=acquireTexture('pending-test',false)
    a.release();finish(texture);await a.promise;await Promise.resolve();expect(dispose).toHaveBeenCalledOnce()
  })
})
