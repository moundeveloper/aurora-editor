import { describe, expect, it } from 'vitest'
import { pointAlongOutline, textUnits, textAnimatorWeight } from '../textAnimation'
import type { TextAnimator } from '@/models/editor'
describe('text animation layout', () => {
  it('keeps combining characters and emoji sequences intact', () => {
    expect(textUnits('e\u0301👩‍🚀', 'character').map(unit => unit.text)).toEqual(['e\u0301','👩‍🚀'])
    expect(textUnits('one two', 'word').map(unit => unit.index)).toEqual([0,0,0,0,1,1,1])
  })
  it('samples arc length, clamps open paths, and wraps closed paths', () => {
    expect(pointAlongOutline([[0,0],[10,0],[10,20]], false, 20)).toEqual({x:10,y:10,rotation:Math.PI/2})
    expect(pointAlongOutline([[0,0],[10,0]], false, 100).x).toBe(10)
    expect(pointAlongOutline([[0,0],[10,0]], true, -5).x).toBe(5)
  })
  it('stagger reveals settle every selected character at progress one', () => {
    const parameters = Object.fromEntries(Object.entries({start:0,end:100,progress:1,stagger:.2}).map(([id,value]) => [id,{id,value,animated:false,keyframes:[]}]))
    const animator = {enabled:true,parameters} as unknown as TextAnimator
    expect([0,1,2,3].map(index => textAnimatorWeight(animator,index,4,0))).toEqual([0,0,0,0])
    animator.parameters.progress.value = 0
    expect(textAnimatorWeight(animator,3,4,0)).toBe(1)
    animator.enabled = false
    expect(textAnimatorWeight(animator,3,4,0)).toBe(0)
  })
})
