import type { ShapePathPoint } from '@/models/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'
export function evaluatedShapePoint(point:ShapePathPoint,time:number):ShapePathPoint {
  if(!point.channels)return point
  const pair=(key:'position'|'handleIn'|'handleOut'):[number,number]=>['X','Y'].map((axis,index)=>{
    const channel=point.channels?.[`${key}${axis}` as keyof NonNullable<ShapePathPoint['channels']>]
    return channel?evaluateNumericProperty(channel,time):point[key][index]!
  }) as [number,number]
  return {...point,position:pair('position'),handleIn:pair('handleIn'),handleOut:pair('handleOut')}
}
export function shapePointChannel(point:ShapePathPoint,key:'position'|'handleIn'|'handleOut',axis:'X'|'Y') {
  const channels=point.channels ??= {},id=`${key}${axis}` as keyof typeof channels
  return channels[id] ??= {id:`${point.id}-${id}`,value:point[key][axis==='X'?0:1],animated:false,keyframes:[]}
}
