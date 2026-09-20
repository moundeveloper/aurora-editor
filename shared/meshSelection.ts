import { z } from 'zod'
import type { ModelMesh } from './modeling.ts'
import { meshTopology } from './meshTopology.ts'
import { selectByProperty } from './selectionProperties.ts'

export const meshSelectionSchema = z.object({
  mode: z.enum(['vertex', 'edge', 'face']),
  action: z.enum(['linked', 'path', 'grow', 'shrink', 'invert', 'similar', 'trait', 'checker']),
  ids: z.array(z.string()).max(24000),
  property: z.enum(['degree','face-count','length','angle','area','normal','corners']).optional(),
  trait: z.enum(['boundary','non-manifold','loose','poles']).optional(),
  tolerance: z.number().finite().min(0).max(180).optional(),
  keep: z.number().int().min(1).max(100).optional(),
  skip: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(199).optional(),
})
export type MeshSelectionQuery = z.infer<typeof meshSelectionSchema>

/** Selection uses authored adjacency, never render diagonals or screen visibility. */
export function queryMeshSelection(mesh: ModelMesh, input: MeshSelectionQuery): string[] {
  const { mode, action, ids } = meshSelectionSchema.parse(input)
  const topology = meshTopology(mesh)
  const all = mode === 'vertex' ? mesh.vertices.map(v => v.id) : mode === 'edge' ? [...topology.edges.keys()] : mesh.faces.map(f => f.id)
  const known = new Set(all), selected = new Set(ids)
  if (selected.size !== ids.length) throw new Error('Select distinct elements')
  if (ids.some(id => !known.has(id))) throw new Error('Unknown selection element; refresh the model')
  if (action === 'similar' || action === 'trait') return selectByProperty(mesh, meshSelectionSchema.parse(input))
  if (action === 'invert') return all.filter(id => !selected.has(id))
  if (!ids.length) throw new Error('Select at least one element')

  const faceNeighbors = new Map(mesh.faces.map(f => [f.id, new Set<string>()]))
  const boundary = new Set<string>()
  for (const [id, uses] of topology.edges) {
    if (uses.length === 1) {
      if (mode === 'edge') boundary.add(id)
      else if (mode === 'vertex') { boundary.add(uses[0]!.from); boundary.add(uses[0]!.to) }
      else boundary.add(uses[0]!.faceId)
    }
    if (mode === 'face') for (const a of uses) for (const b of uses) if (a.faceId !== b.faceId) faceNeighbors.get(a.faceId)!.add(b.faceId)
  }
  const neighbors = (id: string): Set<string> => {
    if (mode === 'face') return faceNeighbors.get(id)!
    const adjacent = new Set<string>()
    if (mode === 'vertex') {
      for (const edge of topology.vertexEdges.get(id)!) {
        const use = topology.edges.get(edge)![0]!
        adjacent.add(use.from === id ? use.to : use.from)
      }
    } else {
      const use = topology.edges.get(id)![0]!
      for (const vertex of [use.from, use.to]) for (const edge of topology.vertexEdges.get(vertex)!) if (edge !== id) adjacent.add(edge)
    }
    return adjacent
  }
  if (action === 'checker') {
    const keep=input.keep??1, skip=input.skip??1, offset=input.offset??0
    const distance=new Map<string,number>()
    // Restart at the first selected element of each induced connected component.
    for(const seed of ids) {
      if(distance.has(seed))continue
      const queue=[seed];distance.set(seed,0)
      for(let head=0;head<queue.length;head++)for(const next of neighbors(queue[head]!)) {
        if(selected.has(next)&&!distance.has(next)){distance.set(next,distance.get(queue[head]!)!+1);queue.push(next)}
      }
    }
    return ids.filter(id=>(distance.get(id)!+offset)%(keep+skip)<keep)
  }
  if (action === 'grow') {
    for (const id of ids) for (const next of neighbors(id)) selected.add(next)
    return [...selected]
  }
  if (action === 'shrink') return ids.filter(id => {
    const adjacent = neighbors(id)
    return !boundary.has(id) && adjacent.size > 0 && [...adjacent].every(next => selected.has(next))
  })
  if (action === 'path' && ids.length !== 2) throw new Error('Select exactly two path endpoints')
  const queue = action === 'path' ? [ids[0]!] : [...ids]
  const visited = new Set(queue), previous = new Map<string, string>()
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!
    if (action === 'path' && id === ids[1]) {
      const path = [id]
      while (path[path.length - 1] !== ids[0]) path.push(previous.get(path[path.length - 1]!)!)
      return path.reverse()
    }
    for (const next of neighbors(id)) if (!visited.has(next)) {
      visited.add(next); previous.set(next, id); queue.push(next)
    }
  }
  if (action === 'path') throw new Error('The endpoints are disconnected in this selection mode')
  return queue
}
