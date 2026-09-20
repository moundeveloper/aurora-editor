import type { ModelMesh, Vec3 } from './modeling.ts'
import { topologyEdgeKey } from './loopCut.ts'
import { boundaryRings, meshTopology } from './meshTopology.ts'

const mix=(a:Vec3,b:Vec3,t:number)=>a.map((x,i)=>x+(b[i]!-x)*t) as Vec3
const near=(a:Vec3,b:Vec3)=>Math.hypot(...a.map((x,i)=>x-b[i]!))<1e-6

/** Uniform authored subdivision; edge samples are reused by every incident face. */
export function subdivide(mesh:ModelMesh,mode:'face'|'edge',ids:string[],cuts:number){
  const topology=meshTopology(mesh),selected=new Set(ids),faces=new Map(mesh.faces.map(f=>[f.id,f]))
  if([...selected].some(id=>!(mode==='face'?faces:topology.edges).has(id)))throw new Error(`Unknown ${mode} in subdivision selection`)
  const edges=mode==='edge'?selected:new Set([...selected].flatMap(id=>{
    const f=faces.get(id)!;return f.vertices.map((v,i)=>topologyEdgeKey(v,f.vertices[(i+1)%f.vertices.length]!))
  }))
  const full=new Set(mesh.faces.filter(f=>mode==='face'?selected.has(f.id):f.vertices.every((v,i)=>edges.has(topologyEdgeKey(v,f.vertices[(i+1)%f.vertices.length]!)))).map(f=>f.id))
  if([...full].some(id=>![3,4].includes(faces.get(id)!.vertices.length)))throw new Error('Face subdivision requires triangles or quads')
  const n=cuts+1,positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
  const newFaces=[...full].reduce((sum)=>sum+n*n-1,0)
  const newVertices=edges.size*cuts+[...full].reduce((sum,id)=>sum+(faces.get(id)!.vertices.length===4?cuts*cuts:cuts*(cuts-1)/2),0)
  if(mesh.faces.length+newFaces>12000||mesh.vertices.length+newVertices>12000)throw new Error('Subdivision would exceed the model geometry limit')
  const samples=new Map<string,string[]>()
  for(const key of edges){
    const use=topology.edges.get(key)![0]!,a=use.from,b=use.to,points=[a]
    for(let i=1;i<n;i++){const id=`v${mesh.nextId++}`;mesh.vertices.push({id,position:mix(positions.get(a)!,positions.get(b)!,i/n)});points.push(id)}
    points.push(b);samples.set(key,points)
  }
  const edge=(a:string,b:string)=>{const points=samples.get(topologyEdgeKey(a,b))!;return points[0]===a?points:[...points].reverse()}
  const result:ModelMesh['faces']=[]
  for(const face of mesh.faces){
    if(!full.has(face.id)){
      const vertices=face.vertices.flatMap((a,i)=>{const b=face.vertices[(i+1)%face.vertices.length]!;return edges.has(topologyEdgeKey(a,b))?edge(a,b).slice(0,-1):[a]})
      result.push({...face,vertices});continue
    }
    const v=face.vertices,grid=new Map<string,string>(),p=v.map(id=>positions.get(id)!)
    let first=true
    const emit=(vertices:string[])=>{result.push({id:first?face.id:`f${mesh.nextId++}`,vertices});first=false}
    if(v.length===4){
      const bottom=edge(v[0]!,v[1]!),right=edge(v[1]!,v[2]!),top=edge(v[3]!,v[2]!),left=edge(v[0]!,v[3]!)
      for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
        let id=y===0?bottom[x]!:x===n?right[y]!:y===n?top[x]!:x===0?left[y]!:''
        if(!id){id=`v${mesh.nextId++}`;mesh.vertices.push({id,position:mix(mix(p[0]!,p[1]!,x/n),mix(p[3]!,p[2]!,x/n),y/n)})}
        grid.set(`${x},${y}`,id)
      }
      for(let y=0;y<n;y++)for(let x=0;x<n;x++)emit([[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([a,b])=>grid.get(`${a},${b}`)!))
    }else{
      const bottom=edge(v[0]!,v[1]!),diagonal=edge(v[1]!,v[2]!),left=edge(v[0]!,v[2]!)
      for(let y=0;y<=n;y++)for(let x=0;x<=n-y;x++){
        let id=y===0?bottom[x]!:x===0?left[y]!:x+y===n?diagonal[y]!:''
        if(!id){id=`v${mesh.nextId++}`;mesh.vertices.push({id,position:p[0]!.map((a,i)=>a+(p[1]![i]!-a)*x/n+(p[2]![i]!-a)*y/n) as Vec3})}
        grid.set(`${x},${y}`,id)
      }
      const at=(x:number,y:number)=>grid.get(`${x},${y}`)!
      for(let y=0;y<n;y++)for(let x=0;x<n-y;x++){
        emit([at(x,y),at(x+1,y),at(x,y+1)])
        if(x+y<n-1)emit([at(x+1,y),at(x+1,y+1),at(x,y+1)])
      }
    }
  }
  mesh.faces=result
}

/** Coarsen complete regular 2×2 quad blocks, with no reliance on undo history or generated IDs. */
export function unsubdivide(mesh:ModelMesh,faceIds:string[],iterations:number){
  let selection=new Set(faceIds)
  for(let iteration=0;iteration<iterations;iteration++){
    const topology=meshTopology(mesh),faces=new Map(mesh.faces.map(f=>[f.id,f])),positions=new Map(mesh.vertices.map(v=>[v.id,v.position]))
    if([...selection].some(id=>!faces.has(id)))throw new Error('Unknown face in Un-Subdivide selection')
    if([...selection].some(id=>faces.get(id)!.vertices.length!==4))throw new Error('Un-Subdivide requires complete regular 2×2 quad blocks')
    const candidates:Array<{center:string;faces:string[];ring:string[];corners:string[]}>=[]
    for(const [center,incident] of topology.vertexFaces){
      if(incident.size!==4||[...incident].some(id=>!selection.has(id)))continue
      const group=new Set(incident),neighbors=new Set([...topology.vertexEdges.get(center)!].map(key=>{const u=topology.edges.get(key)![0]!;return u.from===center?u.to:u.from}))
      if(neighbors.size!==4)continue
      const localEdges=new Set([...incident].flatMap(id=>{const f=faces.get(id)!;return f.vertices.map((v,i)=>topologyEdgeKey(v,f.vertices[(i+1)%f.vertices.length]!))}))
      const border=[...localEdges].flatMap(key=>{const inside=topology.edges.get(key)!.filter(u=>group.has(u.faceId));return inside.length===1?inside:[]})
      let rings:string[][]
      try{rings=boundaryRings(border)}catch{continue}
      if(rings.length!==1||rings[0]!.length!==8)continue
      const ring=rings[0]!,corners=ring.filter(id=>!neighbors.has(id))
      if(corners.length!==4)continue
      if(!ring.every((id,i)=>neighbors.has(id)?!neighbors.has(ring[(i+1)%8]!)&&near(positions.get(id)!,mix(positions.get(ring[(i+7)%8]!)!,positions.get(ring[(i+1)%8]!)!,.5)):true))continue
      const average=[0,1,2].map(axis=>corners.reduce((sum,id)=>sum+positions.get(id)![axis]!,0)/4) as Vec3
      if(!near(positions.get(center)!,average))continue
      candidates.push({center,faces:[...incident],ring,corners})
    }
    const remaining=new Set(selection),groups:typeof candidates=[]
    const byFace=new Map([...selection].map(id=>[id,[] as typeof candidates]))
    for(const candidate of candidates)for(const id of candidate.faces)byFace.get(id)!.push(candidate)
    // Boundary blocks determine the phase of a regular grid. Prefer the most
    // constrained face so a neighboring grid junction isn't mistaken for its center.
    while(remaining.size){
      let options:typeof candidates|undefined
      for(const id of remaining){const available=byFace.get(id)!.filter(c=>c.faces.every(f=>remaining.has(f)));if(!options||available.length<options.length)options=available;if(!options.length)break}
      if(!options?.length)throw new Error('Select complete regular 2×2 quad blocks; this selection cannot be coarsened safely')
      const chosen=options[0]!;groups.push(chosen);chosen.faces.forEach(id=>remaining.delete(id))
    }
    const removedFaces=new Set(groups.flatMap(g=>g.faces.slice(1))),replacements=new Map(groups.map(g=>[g.faces[0]!,g.ring]))
    mesh.faces=mesh.faces.filter(f=>!removedFaces.has(f.id)).map(f=>({...f,vertices:replacements.get(f.id)??f.vertices}))
    const midpoints=new Set(groups.flatMap(g=>g.ring.filter(id=>!g.corners.includes(id))))
    // Remove a midpoint only when every incident polygon sees it as a straight
    // boundary point. Otherwise retain it as a transition to the finer neighbor.
    const removable=new Set<string>()
    for(const id of midpoints){
      const neighbors=new Set<string>();let straight=true
      for(const face of mesh.faces){const i=face.vertices.indexOf(id);if(i<0)continue;const a=face.vertices[(i+face.vertices.length-1)%face.vertices.length]!,b=face.vertices[(i+1)%face.vertices.length]!;neighbors.add(a);neighbors.add(b);if(!near(positions.get(id)!,mix(positions.get(a)!,positions.get(b)!, .5)))straight=false}
      if(straight&&neighbors.size===2)removable.add(id)
    }
    for(const face of mesh.faces)face.vertices=face.vertices.filter(id=>!removable.has(id))
    const used=new Set(mesh.faces.flatMap(f=>f.vertices)),centers=new Set(groups.map(g=>g.center))
    mesh.vertices=mesh.vertices.filter(v=>used.has(v.id)||(!centers.has(v.id)&&!removable.has(v.id)))
    selection=new Set(groups.map(g=>g.faces[0]!))
  }
  return [...selection]
}
