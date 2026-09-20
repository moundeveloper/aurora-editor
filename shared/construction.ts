import { faceNormal, facePositions, type ModelMesh, type Vec3 } from './modeling.ts'
import { boundaryRings, meshTopology } from './meshTopology.ts'

const sub = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]!) as Vec3
const add = (a: Vec3, b: Vec3) => a.map((v, i) => v + b[i]!) as Vec3
const mul = (a: Vec3, s: number) => a.map(v => v * s) as Vec3
const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i]!, 0)
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v); if (l < 1e-8) throw new Error('Degenerate construction direction'); return mul(v, 1/l) }
const lerp = (a: Vec3, b: Vec3, t: number) => add(mul(a, 1-t), mul(b, t))

/** Two directed boundary rings, aligned by minimum squared distance before applying twist. */
export function bridgeLoops(mesh: ModelMesh, edgeIds: string[], cuts: number, twist: number) {
  const topology = meshTopology(mesh), selected = [...new Set(edgeIds)]
  const uses = selected.map(id => {
    const uses = topology.edges.get(id)
    if (!uses || uses.length !== 1) throw new Error('Bridge requires open boundary edges')
    return uses[0]!
  })
  const rings = boundaryRings(uses)
  if (rings.length !== 2) throw new Error('Select exactly two complete boundary loops to bridge')
  const a = rings[0]!, reversed = [...rings[1]!].reverse()
  if (a.length !== reversed.length) throw new Error('Bridge loops must have the same vertex count')
  const positions = new Map(mesh.vertices.map(v => [v.id, v.position])), n = a.length
  if (mesh.vertices.length + n * cuts > 12000 || mesh.faces.length + n * (cuts + 1) > 12000) throw new Error('Bridge would exceed the model geometry limit')
  let best = 0, bestCost = Infinity
  for (let offset = 0; offset < n; offset++) {
    let cost = 0
    for (let i = 0; i < n; i++) { const d = sub(positions.get(a[i]!)!, positions.get(reversed[(i+offset)%n]!)!); cost += dot(d,d) }
    if (cost < bestCost) { best = offset; bestCost = cost }
  }
  const b = a.map((_, i) => reversed[((i + best + twist) % n + n) % n]!)
  const sourcePolygons = new Set(mesh.faces.map(f => [...f.vertices].sort().join(',')))
  for (let i=0;i<n;i++) if(sourcePolygons.has([a[i]!,a[(i+1)%n]!,b[i]!,b[(i+1)%n]!].sort().join(','))) throw new Error('These loops are already joined by a surface; bridging would overlap it')
  const rows = [a]
  for (let cut = 1; cut <= cuts; cut++) rows.push(a.map((id, i) => {
    const next = `v${mesh.nextId++}`
    mesh.vertices.push({ id: next, position: lerp(positions.get(id)!, positions.get(b[i]!)!, cut/(cuts+1)) })
    return next
  }))
  rows.push(b)
  for (let row = 0; row < rows.length - 1; row++) for (let i = 0; i < n; i++) {
    const j = (i+1)%n
    mesh.faces.push({ id: `f${mesh.nextId++}`, vertices: [rows[row]![j]!, rows[row]![i]!, rows[row+1]![i]!, rows[row+1]![j]!] })
  }
}

/** Clip a convex authored solid, keeping source face IDs and sharing every plane/edge intersection. */
function clip(mesh: ModelMesh, normal: Vec3, distance: number) {
  const positions = new Map(mesh.vertices.map(v => [v.id, v.position])), intersections = new Map<string, string>()
  const cap = new Set<string>(), faces: ModelMesh['faces'] = []
  let removed = false
  for (const face of mesh.faces) {
    const polygon: string[] = []
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i]!, b = face.vertices[(i+1)%face.vertices.length]!, p = positions.get(a)!, q = positions.get(b)!
      const da = dot(normal,p)-distance, db = dot(normal,q)-distance
      const insideA = da <= 1e-8, insideB = db <= 1e-8
      if (insideA) { polygon.push(a); if (Math.abs(da) <= 1e-8) cap.add(a) } else removed = true
      if (insideA !== insideB) {
        // Reuse on-plane endpoints rather than creating zero-length edges.
        let id = Math.abs(da) <= 1e-8 ? a : Math.abs(db) <= 1e-8 ? b : ''
        if (!id) {
          const key = JSON.stringify([a,b].sort())
          id = intersections.get(key) ?? ''
          if (!id) { id = `v${mesh.nextId++}`; const position = lerp(p,q,da/(da-db)); mesh.vertices.push({id,position}); positions.set(id,position); intersections.set(key,id) }
        }
        polygon.push(id); cap.add(id)
      }
    }
    const vertices = polygon.filter((id,i) => id !== polygon[(i+polygon.length-1)%polygon.length])
    if (vertices.length >= 3) faces.push({...face,vertices})
  }
  if (!removed) return
  if (cap.size < 3) throw new Error('Bevel width removes the solid; reduce the width')
  const ids = [...cap], center = mul(ids.reduce((s,id) => add(s,positions.get(id)!), [0,0,0] as Vec3), 1/ids.length)
  const x = unit(sub(positions.get(ids[0]!)!,center)), y = cross(normal,x)
  ids.sort((a,b) => { const p=sub(positions.get(a)!,center),q=sub(positions.get(b)!,center); return Math.atan2(dot(p,y),dot(p,x))-Math.atan2(dot(q,y),dot(q,x)) })
  faces.push({id:`f${mesh.nextId++}`,vertices:ids})
  mesh.faces = faces
  const used = new Set(faces.flatMap(f => f.vertices))
  mesh.vertices = mesh.vertices.filter(v => used.has(v.id))
}

export interface BevelOptions { mode:'edge'|'vertex'; ids:string[]; width:number; segments:number; profile:number; clampOverlap:boolean }

/** Plane-based bevel for closed convex components. No render triangulation is baked into authored topology. */
export function bevel(mesh: ModelMesh, options: BevelOptions) {
  const {mode,ids,width,segments,profile,clampOverlap} = options
  const topology = meshTopology(mesh), positions = new Map(mesh.vertices.map(v=>[v.id,v.position]))
  const selected = [...new Set(ids)]
  if (selected.some(id => !(mode==='edge' ? topology.edges : positions).has(id))) throw new Error(`Unknown ${mode} in bevel selection`)
  if (mode==='vertex' && segments!==1) throw new Error('Vertex bevel currently supports one-segment chamfers')
  const seedVertices = mode==='vertex' ? selected : selected.flatMap(id => { const use=topology.edges.get(id)![0]!; return [use.from,use.to] })
  const reached = new Set<string>(), components: Set<string>[] = []
  for (const seed of seedVertices) {
    if (reached.has(seed)) continue
    const queue=[seed], component=new Set([seed]); reached.add(seed)
    for (let i=0;i<queue.length;i++) for (const edge of topology.vertexEdges.get(queue[i]!) ?? []) for (const use of topology.edges.get(edge)!) for (const v of [use.from,use.to]) if(!reached.has(v)){reached.add(v);component.add(v);queue.push(v)}
    components.push(component)
  }
  for (const component of components) {
    const sourceFaces=mesh.faces.filter(f=>component.has(f.vertices[0]!))
    const sourceVertices=mesh.vertices.filter(v=>component.has(v.id))
    if (!sourceFaces.length) throw new Error('Bevel requires surface geometry')
    const normals=new Map(sourceFaces.map(f=>[f.id,faceNormal(facePositions(mesh,f))]))
    for (const face of sourceFaces) {
      const n=normals.get(face.id)!, d=dot(n,positions.get(face.vertices[0]!)!)
      if (face.vertices.some(id=>Math.abs(dot(n,positions.get(id)!)-d)>1e-5) || sourceVertices.some(v=>dot(n,v.position)-d>1e-5)) throw new Error('Bevel currently requires convex solids with planar faces and outward normals')
    }
    for (const uses of topology.edges.values()) if(component.has(uses[0]!.from) && uses.length!==2) throw new Error('Bevel requires a closed solid; fill open boundaries first')
    const chosen=selected.filter(id=>mode==='vertex'?component.has(id):component.has(topology.edges.get(id)![0]!.from))
    let limit=Infinity
    for (const id of chosen) {
      if(mode==='vertex') {
        for(const key of topology.vertexEdges.get(id)!) {const use=topology.edges.get(key)![0]!;limit=Math.min(limit,Math.hypot(...sub(positions.get(use.from)!,positions.get(use.to)!))*.49)}
      } else {
        const uses=topology.edges.get(id)!, p=positions.get(uses[0]!.from)!, direction=unit(sub(positions.get(uses[0]!.to)!,p))
        if(dot(normals.get(uses[0]!.faceId)!,normals.get(uses[1]!.faceId)!)>1-1e-7) throw new Error('Coplanar edges do not need beveling; dissolve them instead')
        // A support plane acts along the entire straight corner. Require every
        // authored segment there, rather than beveling unselected continuations.
        for(const [key,other] of topology.edges) if(component.has(other[0]!.from) && key!==id && !selected.includes(key)) {
          const a=positions.get(other[0]!.from)!,b=positions.get(other[0]!.to)!
          if(Math.hypot(...cross(sub(a,p),direction))<1e-7 && Math.hypot(...cross(sub(b,p),direction))<1e-7) throw new Error('Select every segment along this straight corner before beveling')
        }
        for(const use of uses) for(const vertex of sourceFaces.find(f=>f.id===use.faceId)!.vertices) if(vertex!==use.from && vertex!==use.to) {
          const spacing=Math.hypot(...cross(sub(positions.get(vertex)!,p),direction))
          if(spacing>1e-7)limit=Math.min(limit,spacing*.49)
        }
      }
    }
    if(width>limit && !clampOverlap) throw new Error(`Bevel width exceeds the safe limit (${limit.toPrecision(4)} m); enable overlap clamping or reduce width`)
    const amount=Math.min(width,limit), planes:Array<{n:Vec3;d:number}>=[]
    for(const id of chosen) {
      if(mode==='vertex') {
        const p=positions.get(id)!, normal=unit([...topology.vertexFaces.get(id)!].reduce((s,f)=>add(s,normals.get(f)!),[0,0,0] as Vec3))
        const depths=[...topology.vertexEdges.get(id)!].map(key=>{const use=topology.edges.get(key)![0]!,neighbor=positions.get(use.from===id?use.to:use.from)!;return dot(normal,unit(sub(p,neighbor)))*amount})
        const depth=Math.min(...depths)
        if(depth<1e-7) throw new Error('Vertex bevel requires a convex corner')
        planes.push({n:normal,d:dot(normal,p)-depth})
      } else {
        const uses=topology.edges.get(id)!, first=uses[0]!, p=positions.get(first.from)!, direction=unit(sub(positions.get(first.to)!,p))
        const points=uses.map(use=>add(p,mul(unit(cross(normals.get(use.faceId)!,unit(sub(positions.get(use.to)!,positions.get(use.from)!)))),amount)))
        const origin=sub(add(points[0]!,points[1]!),p), a=sub(points[0]!,origin), b=sub(points[1]!,origin)
        const outward=add(normals.get(first.faceId)!,normals.get(uses[1]!.faceId)!)
        const curve=(t:number)=>add(origin,add(mul(a,Math.cos(t*Math.PI/2)**(2*(1-profile))),mul(b,Math.sin(t*Math.PI/2)**(2*(1-profile)))))
        for(let segment=0;segment<segments;segment++) {
          const from=curve(segment/segments),to=curve((segment+1)/segments)
          let n=unit(cross(direction,sub(to,from)));if(dot(n,outward)<0)n=mul(n,-1)
          planes.push({n,d:dot(n,from)})
        }
      }
    }
    const part:ModelMesh={vertices:sourceVertices,faces:sourceFaces,nextId:mesh.nextId}
    for(const plane of planes) {
      clip(part,plane.n,plane.d)
      if(part.vertices.length>12000||part.faces.length>12000)throw new Error('Bevel would exceed the model geometry limit')
    }
    if(sourceFaces.some(f=>!part.faces.some(next=>next.id===f.id)))throw new Error('Bevel overlaps an existing face; reduce the width')
    mesh.vertices=[...mesh.vertices.filter(v=>!component.has(v.id)),...part.vertices]
    const oldFaces=new Set(sourceFaces.map(f=>f.id))
    mesh.faces=[...mesh.faces.filter(f=>!oldFaces.has(f.id)),...part.faces];mesh.nextId=part.nextId
  }
}
