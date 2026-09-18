import {Vector3} from 'three'
export type Axis='x'|'y'|'z'
export interface TransformConstraint{axis:Axis|null;exclude:boolean}
export function toggleConstraint(current:TransformConstraint,axis:Axis,exclude:boolean):TransformConstraint{
 return current.axis===axis&&current.exclude===exclude?{axis:null,exclude:false}:{axis,exclude}
}
export function constrainedMove(delta:Vector3,constraint:TransformConstraint,numeric:number|null){
 const {axis,exclude}=constraint,result=delta.clone()
 if(!axis)return numeric===null?result:result.set(numeric,0,0)
 if(exclude){result[axis]=0;if(numeric!==null)for(const a of ['x','y','z'] as const)if(a!==axis)result[a]=numeric}
 else{const value=numeric??result[axis];result.set(0,0,0);result[axis]=value}
 return result
}
export function constrainedScale(value:number,{axis,exclude}:TransformConstraint){
 const result=new Vector3(1,1,1)
 for(const a of ['x','y','z'] as const)if(!axis||(exclude?a!==axis:a===axis))result[a]=value
 return result
}
export function constraintLabel({axis,exclude}:TransformConstraint){return axis?(exclude?`Plane ${['X','Y','Z'].filter(a=>a!==axis.toUpperCase()).join('')} (exclude ${axis.toUpperCase()})`:`Axis ${axis.toUpperCase()}`):'Free'}
