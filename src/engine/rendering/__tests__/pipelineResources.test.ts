import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { BokehPass } from '../AlphaBokehPass'
import { AuroraSceneRenderPipeline } from '../AuroraSceneRenderPipeline'
import { createDemo3DScene } from '../../scene3d/sceneFactory'

afterEach(()=>vi.restoreAllMocks())
describe('optional pipeline resources',()=>{
  it('allocates only enabled effects, preserves order, resizes and releases them',()=>{
    let composer:EffectComposer
    vi.spyOn(EffectComposer.prototype,'render').mockImplementation(function(this:EffectComposer){composer=this})
    const aoDispose=vi.spyOn(GTAOPass.prototype,'dispose')
    const dofDispose=vi.spyOn(BokehPass.prototype,'dispose')
    const renderer={getPixelRatio:()=>1,getSize:(v:THREE.Vector2)=>v.set(320,180)} as THREE.WebGLRenderer
    const pipeline=new AuroraSceneRenderPipeline(renderer)
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera()
    const settings={...createDemo3DScene().settings,ambientOcclusion:false}
    const lens={focus:10,aperture:.001,maxBlur:.01}
    const draw=(dof=false)=>pipeline.render(scene,camera,settings,640,360,'screen',dof?lens:null)
    try{
      draw();expect(composer!.passes.map(p=>p.constructor.name)).toEqual(['RenderPass','OutputPass'])
      draw(true);expect(composer!.passes.map(p=>p.constructor.name)).toEqual(['RenderPass','BokehPass','OutputPass'])
      const bokeh=composer!.passes[1] as BokehPass
      expect(bokeh.uniforms.aspect!.value).toBeCloseTo(640/360)
      settings.ambientOcclusion=true;draw(true)
      expect(composer!.passes.map(p=>p.constructor.name)).toEqual(['RenderPass','GTAOPass','BokehPass','OutputPass'])
      expect(composer!.passes[2]).toBe(bokeh)
      settings.ambientOcclusion=false;draw()
      expect(aoDispose).toHaveBeenCalledTimes(1);expect(dofDispose).toHaveBeenCalledTimes(1)
      expect(composer!.passes).toHaveLength(2)
      settings.ambientOcclusion=true;draw()
      settings.quality='draft';draw()
      expect(aoDispose).toHaveBeenCalledTimes(2)
      expect(composer!.passes).toHaveLength(2)
    }finally{pipeline.dispose()}
  })
})
