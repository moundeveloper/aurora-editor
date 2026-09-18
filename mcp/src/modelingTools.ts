import { randomUUID } from 'node:crypto'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { z } from 'zod'

import type { ProjectRepository } from '../../server/src/projects/ProjectRepository.ts'

import type { SerializedEditorState } from '../../src/models/editor.ts'

import { applyModelOperation, createModel, modelOperationSchema, publishModel, validateMesh } from '../../shared/modeling.ts'



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

    title:'Inspect native model topology', description:'Returns draft revision, geometry statistics, and a bounded page of vertices/faces with stable IDs. Use revision with mutation commands.',

    inputSchema:z.object({...reference,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(500).default(100)}), annotations:{readOnlyHint:true},

  },async ({projectId,assetId,offset,limit}) => withProject(projectId,false,project => {

    const asset=requireModel(project,assetId), draft=asset.nativeModel.draft

    return {assetId,name:asset.name,revision:draft.revision,color:draft.color,statistics:validateMesh(draft.mesh),publishedRevisions:asset.nativeModel.revisions.map(r=>r.revision),vertices:draft.mesh.vertices.slice(offset,offset+limit),faces:draft.mesh.faces.slice(offset,offset+limit)}

  }))

  server.registerTool('aurora_model_operations_apply', {

    title:'Edit native model atomically', description:'Apply 1–100 ordered operations using the same kernel as the UI. Convex polygons; bent quads are supported, while larger n-gons must be planar. set-positions transforms selected vertex IDs without changing quad topology. edge-slide moves selected edgeIds (sorted endpoint pairs encoded as JSON strings) along adjacent quad edges with a signed factor from -0.99 to 0.99. loop-cut follows connected quads from an edge endpoint pair, with 1–16 cuts; position controls a single cut, multiple cuts are evenly spaced. inset-region creates an even-width border around selected faceIds using thickness in meters; requires planar faces and compatible corner offsets. extrude-region joins selected faceIds into a cap with boundary-only side walls; defaults to the area-weighted region normal or accepts direction. Extrude/inset preserve the cap face ID. Every operation increments revision. Entire batch rolls back on validation failure or stale project write.',

    inputSchema:z.object({...reference,expectedRevision:z.number().int().positive(),operations:z.array(modelOperationSchema).min(1).max(100)}),

  },async ({projectId,assetId,expectedRevision,operations}) => withProject(projectId,true,project => {

    const asset=requireModel(project,assetId)

    let draft=asset.nativeModel.draft, revision=expectedRevision

    for (const operation of operations) { draft=applyModelOperation(draft,revision,operation); revision=draft.revision }

    asset.nativeModel.draft=draft

    return {assetId,revision:draft.revision,statistics:validateMesh(draft.mesh)}

  }))

  server.registerTool('aurora_model_publish', {

    title:'Publish native model revision', description:'Publish immutable editable source for scene placement. Existing instances stay pinned. Use aurora_scene_model_add to place the latest published revision.',

    inputSchema:z.object({...reference,expectedRevision:z.number().int().positive()}),annotations:{idempotentHint:true},

  },async ({projectId,assetId,expectedRevision}) => withProject(projectId,true,project => {

    const asset=requireModel(project,assetId), revision=publishModel(asset.nativeModel,expectedRevision)

    return {assetId,publishedRevision:revision.revision}

  }))

}

