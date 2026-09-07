import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { lightLinkWeights, syncLightLinking } from '../lightLinking'
import { createPrimitiveObject } from '../sceneFactory'
describe('per-object light linking',()=>{
  it('matches shadow-first light ordering and sums only linked ambient lights',()=>{
    const object=createPrimitiveObject('box',1),a=new THREE.PointLight(),b=new THREE.PointLight(),ambient=new THREE.AmbientLight('#ffffff',2)
    a.userData.auroraId='a';b.userData.auroraId='b';ambient.userData.auroraId='ambient';b.castShadow=true
    object.lightLink={mode:'include',ids:['a']}
    const weights=lightLinkWeights(object,[a,b,ambient])
    expect(weights.auroraPointMask).toEqual([0,1])
    expect((weights.auroraAmbient as THREE.Color).r).toBe(0)
    object.lightLink.mode='exclude'
    expect(lightLinkWeights(object,[a,b,ambient]).auroraPointMask).toEqual([1,0])
  })
  it('keeps existing uniform objects live as linking changes',()=>{
    const object=createPrimitiveObject('box',1),light=new THREE.DirectionalLight(),material=new THREE.MeshStandardMaterial()
    light.userData.auroraId='key';object.lightLink={mode:'include',ids:[]}
    syncLightLinking(material,object,[light])
    const uniform=material.userData.auroraLinkUniforms.auroraDirectionalMask
    object.lightLink.ids=['key'];syncLightLinking(material,object,[light])
    expect(material.userData.auroraLinkUniforms.auroraDirectionalMask).toBe(uniform)
    expect(uniform.value).toEqual([1])
  })
})
