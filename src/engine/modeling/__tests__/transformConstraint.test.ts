import {describe,it,expect} from 'vitest'
import {Vector3,Matrix4} from 'three'
import {constrainedMove,constrainedScale,toggleConstraint,constraintLabel} from '../transformConstraint'
import {createModel,applyModelOperation} from '../../../../shared/modeling'
import {transformedVertices,selectionVertices,selectionCenter} from '../modelSelection'
describe('axis exclusion',()=>{
 it('toggles plane and axis constraints independently',()=>{
  let c=toggleConstraint({axis:null,exclude:false},'y',true)
  expect(constraintLabel(c)).toBe('Plane XZ (exclude Y)')
  c=toggleConstraint(c,'z',false);expect(constrainedMove(new Vector3(2,3,4),c,null).toArray()).toEqual([0,0,4])
  expect(toggleConstraint(c,'z',false)).toEqual({axis:null,exclude:false})
 })
 it('keeps every excluded axis unchanged for pointer and numeric movement and scaling',()=>{
  for(const axis of ['x','y','z'] as const){
   const c={axis,exclude:true}
   expect(constrainedMove(new Vector3(2,3,4),c,null)[axis]).toBe(0)
   expect(constrainedMove(new Vector3(2,3,4),c,5)[axis]).toBe(0)
   expect(constrainedScale(2,c)[axis]).toBe(1)
  }
  expect(constrainedMove(new Vector3(2,3,4),{axis:'y',exclude:true},5).toArray()).toEqual([5,0,5])
  expect(constrainedScale(2,{axis:'y',exclude:true}).toArray()).toEqual([2,1,2])
 })
 it('preserves excluded coordinates in object, face, edge and vertex transforms',()=>{
  const draft=createModel().draft
  const selections=[draft.mesh.vertices.map(v=>v.id),selectionVertices(draft.mesh,'face',['f1']),selectionVertices(draft.mesh,'edge',['["v5","v6"]']),['v6']]
  for(const ids of selections){
   const center=selectionCenter(draft.mesh,ids),c={axis:'y' as const,exclude:true}
   const move=new Matrix4().makeTranslation(constrainedMove(new Vector3(.1,.2,.3),c,null))
   const scale=new Matrix4().makeTranslation(center).multiply(new Matrix4().makeScale(...constrainedScale(1.05,c).toArray())).multiply(new Matrix4().makeTranslation(center.clone().negate()))
   for(const matrix of [move,scale]){
    const result=applyModelOperation(draft,1,{type:'set-positions',vertices:transformedVertices(draft.mesh,ids,matrix)})
    for(const v of result.mesh.vertices){const original=draft.mesh.vertices.find(o=>o.id===v.id)!
     expect(v.position[1]).toBe(original.position[1]);if(!ids.includes(v.id))expect(v).toEqual(original)
    }
   }
  }
 })
})
