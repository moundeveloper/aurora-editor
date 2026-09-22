import { describe, expect, it } from 'vitest'
import type { AnimatableProperty, Keyframe } from '@/models/editor'
import { evaluateNumericProperty } from '../evaluateProperty'
const key=(time:number,value:number):Keyframe<number>=>({id:`key-${time}`,time,value,interpolation:'linear'})
describe('cached keyframe ordering',()=>{
  it('keeps in-place value edits live and detects retiming, replacement and array mutations',()=>{
    const property:AnimatableProperty<number>={id:'x',value:0,animated:true,keyframes:[key(10,10),key(0,0)]}
    const evaluate=()=>evaluateNumericProperty(property,5)
    expect(evaluate()).toBe(5)
    property.keyframes[0]!.value=20;expect(evaluate()).toBe(10)
    property.keyframes[0]!.time=20;expect(evaluate()).toBe(5)
    property.keyframes.push(key(5,30));expect(evaluate()).toBe(30)
    property.keyframes.reverse();expect(evaluate()).toBe(30)
    property.keyframes.splice(0,1);expect(evaluate()).toBe(5)
    property.keyframes[1]=key(10,40);expect(evaluate()).toBe(20)
    property.keyframes=[key(0,10),key(10,20)];expect(evaluate()).toBe(15)
    property.animated=false;expect(evaluate()).toBe(0)
  })
})
