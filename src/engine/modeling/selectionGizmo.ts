import type { Object3D } from 'three'
import type { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { ModelMesh } from '../../../shared/modeling'
import { selectionCenter } from './modelSelection'

export function attachSelectionGizmo(gizmo:TransformControls,pivot:Object3D,mesh:ModelMesh|undefined,ids:string[],tool:'select'|'translate'|'rotate'|'scale'){
  gizmo.detach()
  if(!mesh||!ids.length||tool==='select')return
  pivot.position.copy(selectionCenter(mesh,ids));pivot.quaternion.identity();pivot.scale.set(1,1,1);pivot.updateMatrixWorld(true)
  gizmo.setMode(tool);gizmo.attach(pivot)
}
