import {describe,expect,it} from 'vitest'
import {createNode} from '../nodeGraph'
import {captureNodePreset,instantiateNodePreset,groupNodes,insertReroute} from '../nodeEditing'
import {evaluateNodeGraph} from '../evaluateGraph'
import type {EditorNodeConnection} from '@/models/editor'
describe('node graph organization',()=>{
  it('groups and duplicates a connected subgraph with independent IDs',()=>{
    const a=createNode('image',0,0),b=createNode('blur',200,0);a.sourceId='layer'
    const nodes=[a,b],connections:EditorNodeConnection[]=[{id:'wire',fromNodeId:a.id,fromPortId:a.outputs[0]!.id,toNodeId:b.id,toPortId:b.inputs[0]!.id}]
    const group=groupNodes(nodes,[a.id,b.id],'Soft image')!
    expect(a.groupId).toBe(group.id);expect(b.groupId).toBe(group.id)
    const preset=captureNodePreset(nodes,connections,[group.id],'Reusable blur')
    expect(preset.nodes).toHaveLength(3)
    const copy=instantiateNodePreset(preset,400,400)
    expect(copy.nodes.every(node=>!nodes.some(original=>original.id===node.id))).toBe(true)
    const copyBlur=copy.nodes.find(node=>node.kind==='blur')!
    expect(evaluateNodeGraph(copy.nodes,copy.connections,copyBlur.id)?.[0]?.layerId).toBe('layer')
    expect(copyBlur.groupId).toBe(copy.nodes.find(node=>node.kind==='backdrop')!.id)
  })
  it('preserves image and numeric evaluation when inserting reroutes',()=>{
    const image=createNode('image',0,0),blur=createNode('blur',200,0),math=createNode('math',0,200);image.sourceId='layer';math.inputs[0]!.value=8;math.inputs[1]!.value=5
    const nodes=[image,blur,math],connections:EditorNodeConnection[]=[
      {id:'image',fromNodeId:image.id,fromPortId:image.outputs[0]!.id,toNodeId:blur.id,toPortId:blur.inputs[0]!.id},
      {id:'number',fromNodeId:math.id,fromPortId:math.outputs[0]!.id,toNodeId:blur.id,toPortId:blur.inputs[1]!.id},
    ]
    const before=evaluateNodeGraph(nodes,connections,blur.id)
    insertReroute(nodes,connections,'image');insertReroute(nodes,connections,'number')
    expect(evaluateNodeGraph(nodes,connections,blur.id)).toEqual(before)
    expect(before?.[0]?.effects.blur).toBe(13)
  })
})
