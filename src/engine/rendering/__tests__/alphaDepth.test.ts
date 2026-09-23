import { expect,it,vi } from 'vitest'
import * as THREE from 'three'
import { BokehPass } from '../AlphaBokehPass'
it('honors image alpha in depth and restores all scene state when rendering throws',()=>{
  const scene=new THREE.Scene(),source=new THREE.MeshStandardMaterial({map:new THREE.Texture(),opacity:.5,transparent:true,side:THREE.DoubleSide})
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),source);scene.add(mesh)
  const override=new THREE.MeshBasicMaterial();scene.overrideMaterial=override;scene.background=new THREE.Color('red')
  const background=scene.background,pass=new BokehPass(scene,new THREE.PerspectiveCamera())
  const renderer={autoClear:true,getClearColor:(c:THREE.Color)=>c.set('blue'),getClearAlpha:()=>.2,getRenderTarget:()=>null,setClearColor:vi.fn(),setRenderTarget:vi.fn(),clear:vi.fn(),render:()=>{
    const depth=mesh.material as unknown as THREE.MeshDepthMaterial
    expect(depth).toBeInstanceOf(THREE.MeshDepthMaterial);expect(depth.map).toBe(source.map);expect(depth.alphaTest).toBeGreaterThan(0);expect(depth.opacity).toBe(.5)
    expect(scene.overrideMaterial).toBeNull();throw new Error('GPU failure')
  }} as unknown as THREE.WebGLRenderer
  expect(()=>pass.render(renderer,new THREE.WebGLRenderTarget(),new THREE.WebGLRenderTarget())).toThrow('GPU failure')
  expect(mesh.material).toBe(source);expect(scene.overrideMaterial).toBe(override);expect(scene.background).toBe(background);expect(renderer.autoClear).toBe(true)
  pass.dispose()
})
