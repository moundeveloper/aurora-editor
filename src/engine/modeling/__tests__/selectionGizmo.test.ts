import {describe,it,expect} from 'vitest'
import {Object3D,PerspectiveCamera,Scene,Matrix4,Vector3} from 'three'
import {TransformControls} from 'three/addons/controls/TransformControls.js'
import {attachSelectionGizmo} from '../selectionGizmo'
import {selectionVertices,transformedVertices} from '../modelSelection'
import {createModel,applyModelOperation} from '../../../../shared/modeling'
describe('component selection gizmo',()=>{
 it('attaches real handles to vertices, edges and faces for every transform mode',()=>{
  const mesh=createModel().draft.mesh,pivot=new Object3D(),scene=new Scene(),gizmo=new TransformControls(new PerspectiveCamera(),{addEventListener(){},removeEventListener(){},style:{}} as unknown as HTMLElement)
  scene.add(pivot,gizmo.getHelper())
  for(const [mode,selection] of [['vertex',['v6']],['edge',['["v5","v6"]']],['face',['f1']]] as const){
   const ids=selectionVertices(mesh,mode,selection)
   for(const tool of ['translate','rotate','scale'] as const){
    attachSelectionGizmo(gizmo,pivot,mesh,ids,tool)
    expect(gizmo.object).toBe(pivot);expect(gizmo.getHelper().visible).toBe(true);expect(gizmo.mode).toBe(tool)
    expect(pivot.position.z).toBe(1)
   }
   const draft=createModel().draft
   const result=applyModelOperation(draft,1,{type:'set-positions',vertices:transformedVertices(mesh,ids,new Matrix4().makeTranslation(new Vector3(0,0,.2)))})
   for(const v of result.mesh.vertices)expect(v.position[2]).toBeCloseTo(mesh.vertices.find(o=>o.id===v.id)!.position[2]+(ids.includes(v.id)?.2:0))
  }
  attachSelectionGizmo(gizmo,pivot,mesh,[],'translate');expect(gizmo.object).toBeUndefined()
  gizmo.dispose()
 })
})
