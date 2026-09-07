import type {EditorNode,EditorNodeConnection} from '@/models/editor'
import {createNode,nodeHeight,NODE_WIDTH} from './nodeGraph'
export interface NodePreset {id:string;name:string;nodes:EditorNode[];connections:EditorNodeConnection[]}
export function groupNodes(nodes:EditorNode[],ids:string[],name:string) {
  const members=nodes.filter(node=>ids.includes(node.id) && node.kind!=='backdrop')
  if(!members.length)return null
  const group=createNode('backdrop',Math.min(...members.map(node=>node.x))-25,Math.min(...members.map(node=>node.y))-75)
  group.title=name.trim()||'Node group'
  group.properties.width=String(Math.max(...members.map(node=>node.x+NODE_WIDTH))-group.x+25)
  group.properties.height=String(Math.max(...members.map(node=>node.y+nodeHeight(node)))-group.y+25)
  group.properties.note='';group.properties.color='#68729a'
  members.forEach(node=>{node.groupId=group.id})
  nodes.unshift(group)
  return group
}
export function insertReroute(nodes:EditorNode[],connections:EditorNodeConnection[],id:string) {
  const index=connections.findIndex(connection=>connection.id===id),connection=connections[index]
  if(!connection)return null
  const from=nodes.find(node=>node.id===connection.fromNodeId),to=nodes.find(node=>node.id===connection.toNodeId)
  const type=from?.outputs.find(socket=>socket.id===connection.fromPortId)?.type
  if(!from || !to || !type)return null
  const reroute=createNode('reroute',(from.x+to.x)/2,(from.y+to.y)/2)
  reroute.inputs[0]!.type=type;reroute.outputs[0]!.type=type
  nodes.push(reroute)
  connections.splice(index,1,{...connection,toNodeId:reroute.id,toPortId:reroute.inputs[0]!.id},{id:crypto.randomUUID(),fromNodeId:reroute.id,fromPortId:reroute.outputs[0]!.id,toNodeId:connection.toNodeId,toPortId:connection.toPortId})
  return reroute
}
export function captureNodePreset(nodes:EditorNode[],connections:EditorNodeConnection[],ids:string[],name:string):NodePreset {
  const chosen=new Set(ids)
  for(const node of nodes)if(node.groupId && chosen.has(node.groupId))chosen.add(node.id)
  return JSON.parse(JSON.stringify({id:crypto.randomUUID(),name:name.trim()||'Node preset',nodes:nodes.filter(node=>chosen.has(node.id)),connections:connections.filter(connection=>chosen.has(connection.fromNodeId) && chosen.has(connection.toNodeId))}))
}
export function instantiateNodePreset(preset:NodePreset,x:number,y:number) {
  const cloned=JSON.parse(JSON.stringify(preset)) as NodePreset
  const ids=new Map<string,string>(),ports=new Map<string,string>()
  const minX=Math.min(...cloned.nodes.map(node=>node.x)),minY=Math.min(...cloned.nodes.map(node=>node.y))
  for(const node of cloned.nodes){const id=crypto.randomUUID();ids.set(node.id,id);node.id=id;node.x+=x-minX;node.y+=y-minY;for(const port of [...node.inputs,...node.outputs]){const next=crypto.randomUUID();ports.set(port.id,next);port.id=next}}
  for(const node of cloned.nodes)if(node.groupId)node.groupId=ids.get(node.groupId)
  cloned.connections=cloned.connections.map(connection=>({id:crypto.randomUUID(),fromNodeId:ids.get(connection.fromNodeId)!,fromPortId:ports.get(connection.fromPortId)!,toNodeId:ids.get(connection.toNodeId)!,toPortId:ports.get(connection.toPortId)!}))
  return cloned
}
