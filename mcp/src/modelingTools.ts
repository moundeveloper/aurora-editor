import { randomUUID } from 'node:crypto'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { z } from 'zod'

import type { ProjectRepository } from '../../server/src/projects/ProjectRepository.ts'

import type { SerializedEditorState } from '../../src/models/editor.ts'

import { modelOperationResult, createModel, modelOperationSchema, publishModel, validateMesh } from '../../shared/modeling.ts'
import { meshSelectionSchema, queryMeshSelection } from '../../shared/meshSelection.ts'



const id = z.string().min(1)

const reference = {projectId:id,assetId:id}

const answer = (value: unknown) => ({content:[{type:'text' as const,text:JSON.stringify(value,null,2)}]})



export function registerModelingTools(server: McpServer, projects: ProjectRepository) {

  async function withProject(projectId: string, write: boolean, run: (project: SerializedEditorState) => unknown) {

    try {

      const stored = await projects.load(projectId)

      if (!stored) throw new Error('Unknown project')

      const result = run(stored as unknown as SerializedEditorState)

      if (write) { stored.project.updatedAt=Date.now(); await projects.save(stored) }

      return answer(result)

    } catch(e) { return {isError:true,...answer({error:e instanceof Error ? e.message : String(e)})} }

  }

  function requireModel(project: SerializedEditorState, assetId: string) {

    const asset=project.assets.find(a => a.id===assetId)

    if (!asset?.nativeModel) throw new Error('Unknown native model asset')

    return asset as typeof asset & {nativeModel:NonNullable<typeof asset.nativeModel>}

  }

  server.registerTool('aurora_model_create', {

    title:'Create editable native model', description:'Create a cube or plane draft in Project Assets. Open it in Modeling to edit by hand; publish before placing it in a scene.',

    inputSchema:z.object({projectId:id,name:z.string().min(1).max(128),primitive:z.enum(['cube','plane']).default('cube')}),

  }, async ({projectId,name,primitive}) => withProject(projectId,true,project => {

    const asset={id:randomUUID(),name,kind:'model3d' as const,nativeModel:createModel(primitive)}

    project.assets.push(asset)

    return {assetId:asset.id,...asset.nativeModel.draft}

  }))

  server.registerTool('aurora_model_get', {

    title:'Inspect native model topology', description:'Returns draft revision, geometry statistics, and a bounded page of vertices/faces with stable IDs. Includes named selection set summaries; pass selectionSet to page its ordered IDs with offset/limit. Use revision with mutation commands.',

    inputSchema:z.object({...reference,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(500).default(100),selectionSet:z.string().optional()}), annotations:{readOnlyHint:true},

  },async ({projectId,assetId,offset,limit,selectionSet}) => withProject(projectId,false,project => {

    const asset=requireModel(project,assetId), draft=asset.nativeModel.draft
    const saved=selectionSet===undefined?undefined:draft.selectionSets?.find(set=>set.name===selectionSet)
    if(selectionSet!==undefined&&!saved)throw new Error('Unknown selection set')

    return {assetId,name:asset.name,revision:draft.revision,color:draft.color,statistics:validateMesh(draft.mesh),selectionSets:(draft.selectionSets??[]).map(set=>({name:set.name,mode:set.mode,count:set.ids.length})),selectionSet:saved?{...saved,ids:saved.ids.slice(offset,offset+limit),count:saved.ids.length}:undefined,publishedRevisions:asset.nativeModel.revisions.map(r=>r.revision),vertices:draft.mesh.vertices.slice(offset,offset+limit),faces:draft.mesh.faces.slice(offset,offset+limit)}

  }))

  server.registerTool('aurora_model_selection_query', {
    title:'Query mesh selection',
    description:'Read-only linked, shortest path, grow, shrink, invert, similar, or trait selection in vertex/edge/face mode. Vertices connect by edges, edges by shared endpoints, faces by shared edges. Path requires exactly two IDs and minimizes adjacency hops (not distance). Shrink removes open boundaries and isolated elements as well as the selection border. Includes hidden geometry. Similar uses property degree/face-count for vertices, length/angle/face-count for edges, area/normal/corners for faces; tolerance is absolute meters, square meters, degrees, or counts (0-180, default 0). Matches any reference ID. Trait replaces selection using boundary/non-manifold, or vertex-only loose/poles. Non-manifold includes boundaries, loose vertices and disconnected vertex fans. Poles are non-boundary vertices of positive degree other than four. Face traits include faces touching matching vertices. Checker deselection uses keep/skip (1-100, default 1), offset (0-199, default 0) over shortest adjacency rings within selected geometry; each component starts at its first selected ID. Odd loops and branching selections need not strictly alternate. Returns IDs without editing the draft or UI selection.',
    inputSchema:z.object({...reference,expectedRevision:z.number().int().positive(),selection:meshSelectionSchema}),
    annotations:{readOnlyHint:true},
  },async ({projectId,assetId,expectedRevision,selection}) => withProject(projectId,false,project => {
    const draft=requireModel(project,assetId).nativeModel.draft
    if(draft.revision!==expectedRevision)throw new Error('Stale model revision; refresh the model')
    return {assetId,revision:draft.revision,mode:selection.mode,ids:queryMeshSelection(draft.mesh,selection)}
  }))

  server.registerTool('aurora_model_operations_apply', {

    title:'Edit native model atomically', description:'Apply 1–100 ordered operations using the same kernel as the UI. Convex polygons; bent quads are supported, while larger n-gons must be planar. set-positions transforms selected vertex IDs without changing quad topology. knife accepts either the legacy faceId/start/end form or a resolved segments array; each segment cuts one face between two edge points, and multiple segments can cut a complete through-path. Set through when the path was resolved with hidden faces included. delete removes selected vertices, faces, or topology edges (and the faces that own those edges). edge-slide moves selected edgeIds (sorted endpoint pairs encoded as JSON strings) along adjacent quad edges with a signed factor from -0.99 to 0.99. loop-cut follows connected quads from an edge endpoint pair, with 1–16 cuts; position controls a single cut, multiple cuts are evenly spaced. inset-region creates an even-width border around selected faceIds using thickness in meters; requires planar faces and compatible corner offsets. extrude-region joins selected faceIds into a cap with boundary-only side walls; defaults to the area-weighted region normal or accepts direction. Extrude/inset preserve the cap face ID. merge welds selected vertexIds by distance or at center/first/last (array order). dissolve removes coplanar interior edges/face regions or collinear degree-two vertices. fill accepts complete boundary vertex/edge IDs with polygon, triangles (convex planar center fan), or grid (four equally sampled sides) style; fill-holes repairs all boundaries atomically. delete-loose removes unused vertices. Repair operations reject invalid output without changing source; changes reports created/deleted IDs and selection candidates per operation. bevel accepts mode edge/vertex, ids, width in meters, segments (1-16), profile (0.1-0.9), and clampOverlap; requires closed convex components with planar outward faces, and vertex mode supports one segment. bridge accepts edgeIds from exactly two complete open boundary loops of equal vertex count, cuts (0-32 intermediate rows), and signed twist in vertex steps; alignment is automatic and interpolation is linear. subdivide accepts mode face/edge, ids, and cuts (1-15); fully selected triangles/quads become regular grids and edge splits propagate to neighbors. unsubdivide accepts faceIds and iterations (1-4) for complete regular 2x2 quad blocks; edited or incomplete blocks are rejected. connect-path connects distinct vertexIds in array order across continuous coplanar surfaces and returns path edge selection. rotate-edge flips selected interior edgeIds between coplanar triangles; selected edges cannot share faces. split detaches faceIds by duplicating shared boundary vertices. rip detaches faceIds and translates the entire selected region by nonzero offset [x,y,z]. Both require an adjoining unselected region. poke creates triangle fans in planar faceIds with optional signed normal offset (default 0). selection-set-save stores name (1-64 characters), mode and ordered ids; replace:true explicitly updates an existing name. selection-set-delete removes a named set. Up to 64 sets per model; topology edits prune deleted IDs and preserve empty sets. shrink-fatten moves vertexIds by signed distance along normalized area-weighted normals from all incident faces. push-pull moves vertexIds by fixed signed radial distance from their centroid; rejects pivot crossings or a vertex at the pivot. flatten projects vertexIds toward a centroid plane: plane average/x/y/z, strength 0.001-1 (default 1). Average uses fully selected faces or incident faces as fallback; cancelling normals reject. Local face/edge reversal and invalid topology reject; global intersections are not tested. Every operation increments revision. Entire batch rolls back on validation failure or stale project write.',

    inputSchema:z.object({...reference,expectedRevision:z.number().int().positive(),operations:z.array(modelOperationSchema).min(1).max(100)}),

  },async ({projectId,assetId,expectedRevision,operations}) => withProject(projectId,true,project => {

    const asset=requireModel(project,assetId)

    let draft=asset.nativeModel.draft, revision=expectedRevision

    const changes=[]
    for (const operation of operations) {
      const result=modelOperationResult(draft,revision,operation)
      draft=result.draft; revision=draft.revision
      changes.push({revision,created:result.created,deleted:result.deleted,selection:result.selection,diagnostics:result.diagnostics})
    }

    asset.nativeModel.draft=draft

    return {assetId,revision:draft.revision,statistics:validateMesh(draft.mesh),changes}

  }))

  server.registerTool('aurora_model_publish', {

    title:'Publish native model revision', description:'Publish immutable editable source for scene placement. Existing instances stay pinned. Use aurora_scene_model_add to place the latest published revision.',

    inputSchema:z.object({...reference,expectedRevision:z.number().int().positive()}),annotations:{idempotentHint:true},

  },async ({projectId,assetId,expectedRevision}) => withProject(projectId,true,project => {

    const asset=requireModel(project,assetId), revision=publishModel(asset.nativeModel,expectedRevision)

    return {assetId,publishedRevision:revision.revision}

  }))

}

