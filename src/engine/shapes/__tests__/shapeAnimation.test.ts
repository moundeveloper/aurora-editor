import {describe,expect,it} from 'vitest'
import type {EditorLayer,ShapePathPoint} from '@/models/editor'
import {shapePointChannel,evaluatedShapePoint} from '../shapeAnimation'
import {shapeOutline} from '../shapeGeometry'
import {maskGeometryKey} from '@/engine/rendering/maskField'
describe('animated mask paths',()=>{
  it('evaluates anchors and handles without mutating the authored points',()=>{
    const point:ShapePathPoint={id:'p',position:[0,0],handleIn:[-10,0],handleOut:[10,0]}
    const channel=shapePointChannel(point,'position','X')
    channel.animated=true;channel.keyframes=[{id:'a',time:0,value:0,interpolation:'linear'},{id:'b',time:1,value:100,interpolation:'linear'}]
    expect(evaluatedShapePoint(point,.5).position).toEqual([50,0]);expect(point.position).toEqual([0,0])
    const p=(value:number)=>({id:String(value),value,animated:false,keyframes:[]})
    const layer={shapeKind:'path',shapePath:{closed:true,points:[point,{id:'q',position:[100,100],handleIn:[100,100],handleOut:[100,100]},{id:'r',position:[0,100],handleIn:[0,100],handleOut:[0,100]}]},transform:{x:p(100),y:p(100),scaleX:p(100),scaleY:p(100),rotation:p(0),opacity:p(100)}} as EditorLayer
    expect(shapeOutline(layer,16,.5).points[0]).toEqual([50,0])
    expect(maskGeometryKey(layer,0,200,200,200,200)).not.toBe(maskGeometryKey(layer,.5,200,200,200,200))
  })
})
