import { insetRegion } from './insetRegion.ts'
import { extrudeRegion } from './extrudeRegion.ts'
import { edgeSlideVertices } from './edgeLoops.ts'
import { z } from 'zod'
import { insertQuadLoop } from './loopCut.ts'

export type Vec3 = [number, number, number]
export interface ModelVertex { id: string; position: Vec3 }
export interface ModelFace { id: string; vertices: string[] }
export interface ModelMesh { vertices: ModelVertex[]; faces: ModelFace[]; nextId: number }
export interface ModelDraft { schemaVersion: 1; revision: number; mesh: ModelMesh; color: string }
export interface NativeModel { draft: ModelDraft; revisions: ModelDraft[] }

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const modelOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('extrude'), faceId: z.string(), distance: z.number().finite().min(-1000).max(1000), direction:vector.optional() }),
  z.object({type:z.literal('extrude-region'),faceIds:z.array(z.string()).min(1).max(12000),distance:z.number().finite().min(-1000).max(1000),direction:vector.optional()}),
  z.object({type:z.literal('inset-region'),faceIds:z.array(z.string()).min(1).max(12000),thickness:z.number().finite().positive().max(1000)}),
  z.object({ type: z.literal('inset'), faceId: z.string(), fraction: z.number().min(.001).max(.95) }),
  z.object({ type: z.literal('translate'), vertexIds: z.array(z.string()).min(1), offset: vector }),
  z.object({ type: z.literal('set-positions'), vertices: z.array(z.object({id:z.string(),position:vector})).min(1).max(12000) }),
  z.object({ type: z.literal('scale'), factors: vector }),
  z.object({ type: z.literal('color'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({type:z.literal('edge-slide'),edgeIds:z.array(z.string()).min(1).max(24000),factor:z.number().min(-.99).max(.99)}),
  z.object({ type:z.literal('loop-cut'),edge:z.tuple([z.string(),z.string()]),cuts:z.number().int().min(1).max(16),position:z.number().min(.01).max(.99) }),
])
export type ModelOperation = z.infer<typeof modelOperationSchema>
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]

export function facePositions(mesh: ModelMesh, face: ModelFace, vertices = new Map(mesh.vertices.map(v => [v.id, v.position]))): Vec3[] {
  return face.vertices.map(id => {
    const position = vertices.get(id)
    if (!position) throw new Error(`Missing vertex ${id}`)
    return position
  })
}
export function faceNormal(points: Vec3[]): Vec3 {
  const normal: Vec3 = [0, 0, 0]
  for (let i=0; i<points.length; i++) {
    const a = points[i]!, b = points[(i+1)%points.length]!
    normal[0] += (a[1]-b[1])*(a[2]+b[2])
    normal[1] += (a[2]-b[2])*(a[0]+b[0])
    normal[2] += (a[0]-b[0])*(a[1]+b[1])
  }
  const length = Math.hypot(...normal)
  if (length < 1e-8) throw new Error('Degenerate face: zero area')
  return normal.map(n => n/length) as Vec3
}

/** Quads may bend during vertex editing; triangulation is a render detail, not source topology. */
export function validateMesh(mesh: ModelMesh) {
  if (mesh.vertices.length > 12000 || mesh.faces.length > 12000) throw new Error('Model limit: 12,000 vertices/faces')
  if (!mesh.vertices.length || !mesh.faces.length) throw new Error('A model needs vertices and faces')
  if (!Number.isSafeInteger(mesh.nextId) || mesh.nextId < 0) throw new Error('Invalid topology ID counter')
  const ids = [...mesh.vertices.map(v => v.id), ...mesh.faces.map(f => f.id)]
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate topology IDs')
  if (mesh.vertices.some(v => v.position.length !== 3 || v.position.some(n => !Number.isFinite(n) || Math.abs(n)>1e6))) throw new Error('Invalid vertex position')
  const positions = new Map(mesh.vertices.map(v => [v.id,v.position]))
  const edges = new Map<string, string[]>()
  for (const face of mesh.faces) {
    if (face.vertices.length < 3 || face.vertices.length > 128 || new Set(face.vertices).size !== face.vertices.length) throw new Error('Invalid polygon')
    const points = facePositions(mesh, face, positions), normal = faceNormal(points)
    // A locally convex turn is insufficient: star polygons can have consistent turns.
    // Every vertex must lie on the inner half-plane of every directed polygon edge.
    for (let i=0;i<points.length;i++) {
      const a=points[i]!, b=points[(i+1)%points.length]!
      for (const point of points) {
        if (dot(cross(subtract(b,a),subtract(point,a)),normal)<-1e-7) throw new Error('Concave or self-intersecting polygon')
      }
    }
    for (let i=0; i<points.length; i++) {
      const a = points[i]!, b = points[(i+1)%points.length]!, c = points[(i+2)%points.length]!
      if (Math.hypot(...subtract(b,a)) < 1e-7) throw new Error('Zero-length edge')
      if (points.length>4 && Math.abs(dot(subtract(a,points[0]!),normal))>1e-5) throw new Error('Non-planar n-gon: use quads for vertex editing')
      if (dot(cross(subtract(b,a),subtract(c,b)),normal)<-1e-7) throw new Error('Concave polygons are not supported yet')
      const from = face.vertices[i]!, to = face.vertices[(i+1)%points.length]!
      const key = [from,to].sort().join(':')
      const uses = edges.get(key) ?? []
      uses.push(`${from}:${to}`); edges.set(key,uses)
      if (uses.length>2 || (uses.length===2 && uses[0]===uses[1])) throw new Error('Non-manifold or inconsistent edge winding')
    }
  }
  return { vertices: mesh.vertices.length, faces: mesh.faces.length, edges: edges.size, boundaryEdges: [...edges.values()].filter(v => v.length===1).length }
}

export function createModel(primitive: 'cube' | 'plane' = 'cube'): NativeModel {
  const positions: Vec3[] = primitive === 'cube'
    ? [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]
    : [[-1,0,-1],[-1,0,1],[1,0,1],[1,0,-1]]
  const polygons = primitive === 'cube' ? [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]] : [[0,1,2,3]]
  const mesh: ModelMesh = {
    vertices: positions.map((position,i) => ({id:`v${i}`,position})),
    faces: polygons.map((vertices,i) => ({id:`f${i}`,vertices:vertices.map(v => `v${v}`)})), nextId: 20,
  }
  validateMesh(mesh)
  return { draft: {schemaVersion:1,revision:1,mesh,color:'#9aa8bd'}, revisions:[] }
}

export function applyModelOperation(draft: ModelDraft, expectedRevision: number, input: ModelOperation): ModelDraft {
  if (draft.schemaVersion!==1) throw new Error('Unsupported model schema')
  if (draft.revision!==expectedRevision) throw new Error(`Stale model revision: expected ${expectedRevision}, current ${draft.revision}`)
  const op = modelOperationSchema.parse(input), result = clone(draft), mesh = result.mesh
  validateMesh(mesh)
  if (op.type === 'color') result.color = op.color
  else if (op.type === 'inset-region') insetRegion(mesh,op.faceIds,op.thickness)
  else if (op.type === 'extrude-region') extrudeRegion(mesh,op.faceIds,op.distance,op.direction)
  else if (op.type === 'edge-slide') {
    const moved=new Map(edgeSlideVertices(mesh,op.edgeIds,op.factor).map(v=>[v.id,v.position]))
    for(const v of mesh.vertices)if(moved.has(v.id))v.position=moved.get(v.id)!
  }
  else if (op.type === 'loop-cut') insertQuadLoop(mesh,op)
  else if (op.type === 'scale') {
    if (op.factors.some(n => n<.001 || n>1000)) throw new Error('Scale factors must be between 0.001 and 1000')
    mesh.vertices.forEach(v => { v.position = v.position.map((n,i) => n*op.factors[i]!) as Vec3 })
  } else if (op.type === 'set-positions') {
    const updates=new Map(op.vertices.map(v=>[v.id,v.position]))
    if (updates.size!==op.vertices.length) throw new Error('Duplicate vertices in transform')
    const known=new Set(mesh.vertices.map(v=>v.id))
    if (op.vertices.some(v=>!known.has(v.id))) throw new Error('Unknown vertex in selection')
    mesh.vertices.forEach(v=>{const position=updates.get(v.id); if(position) v.position=[...position]})
  } else if (op.type === 'translate') {
    const selected = new Set(op.vertexIds)
    if ([...selected].some(id => !mesh.vertices.some(v => v.id===id))) throw new Error('Unknown vertex in selection')
    mesh.vertices.forEach(v => { if (selected.has(v.id)) v.position = v.position.map((n,i) => n+op.offset[i]!) as Vec3 })
  } else {
    const face = mesh.faces.find(f => f.id===op.faceId)
    if (!face) throw new Error('Unknown face; refresh the selection')
    const points = facePositions(mesh,face), normal = faceNormal(points)
    if (op.type==='extrude' && op.direction) {
      const length=Math.hypot(...op.direction)
      if(length<1e-8) throw new Error('Extrusion direction must be nonzero')
      normal.splice(0,3,...op.direction.map(n=>n/length))
    }
    const center = points.reduce<Vec3>((a,p) => [a[0]+p[0]/points.length,a[1]+p[1]/points.length,a[2]+p[2]/points.length],[0,0,0])
    if (op.type==='extrude' && Math.abs(op.distance)<1e-6) throw new Error('Extrusion distance must be nonzero')
    const old = [...face.vertices]
    face.vertices = points.map(p => {
      const id = `v${mesh.nextId++}`
      const position = p.map((n,i) => op.type==='extrude' ? n+normal[i]!*op.distance : n+(center[i]!-n)*op.fraction) as Vec3
      mesh.vertices.push({id,position}); return id
    })
    old.forEach((a,i) => {
      const j=(i+1)%old.length
      mesh.faces.push({id:`f${mesh.nextId++}`,vertices:[a,old[j]!,face.vertices[j]!,face.vertices[i]!]})
    })
    // Reuse the cap face ID so repeated extrusion and inset keep the selection meaningful.
  }
  validateMesh(mesh)
  result.revision++
  return result
}

export function publishModel(model: NativeModel, expectedRevision: number): ModelDraft {
  if (model.draft.schemaVersion!==1) throw new Error('Unsupported model schema')
  if (model.draft.revision!==expectedRevision) throw new Error('Stale model revision')
  validateMesh(model.draft.mesh)
  const existing = model.revisions.find(r => r.revision===expectedRevision)
  if (existing) return existing
  if (model.revisions.length>=50) throw new Error('This model has reached the initial 50 published revisions limit')
  const published = clone(model.draft)
  model.revisions.push(published)
  return published
}
