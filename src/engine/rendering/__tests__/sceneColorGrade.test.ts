import { describe, expect, it } from 'vitest'
import { applySceneLook, sceneColorGrade } from '../../../../shared/sceneLook'
import { colorGradeUniforms } from '../sceneColorGrade'
import type { Aurora3DScene, Scene3DSettings } from '@/models/editor'

describe('scene color grading',()=>{
  it('preserves legacy and neutral output exactly and bypasses a disabled grade',()=>{
    const settings={} as Scene3DSettings
    expect(colorGradeUniforms(settings).enabled).toBe(0)
    settings.colorGrade={...sceneColorGrade(settings),enabled:true}
    expect(colorGradeUniforms(settings).enabled).toBe(0)
    settings.colorGrade.saturation=0
    expect(colorGradeUniforms(settings).enabled).toBe(1)
    settings.colorGrade.enabled=false
    expect(colorGradeUniforms(settings).enabled).toBe(0)
  })
  it('merges partial settings and rejects invalid patches atomically',()=>{
    const scene={settings:{ambientOcclusion:false}} as Aurora3DScene
    applySceneLook(scene,{colorGrade:{enabled:true,temperature:20}})
    applySceneLook(scene,{colorGrade:{saturation:.8},ambientOcclusion:true})
    expect(scene.settings.colorGrade).toEqual({enabled:true,temperature:20,tint:0,contrast:1,saturation:.8})
    const before=structuredClone(scene)
    expect(()=>applySceneLook(scene,{ambientOcclusion:false,colorGrade:{contrast:3}})).toThrow()
    expect(scene).toEqual(before)
  })
})
