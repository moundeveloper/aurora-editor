# Aurora MCP Server Implementation Plan

Status: proposed  
Branch: `feat/mcp-server-implementation`  
Planning baseline: 2026-08-31

## 1. Objective

Build an Aurora Model Context Protocol server that lets an AI agent inspect and operate the editor through stable, semantic tools. The target is not mouse automation. The agent should be able to create and load projects, understand a project structurally and visually, import and create assets, build timelines and clusters, animate properties, edit visual and audio node graphs, construct 3D scenes, manage rigs, inspect viewports, and start exports.

The MCP server must preserve the same invariants as the UI, produce undoable and auditable edits, support explicit project targeting, and return enough structured context that an agent can verify its work without dumping the entire project into every response.

## 2. Definition of “full control”

The first production release is complete when an agent can perform these workflows without editing Aurora files or databases directly:

1. List projects, create a project, open it in Aurora, update its settings, save it, close it, and load it again.
2. Inspect project metadata, library assets, nested timeline structure, animation channels, visual node graph, audio graph, 3D scenes, rigs, selection, workspace, playhead, and export state.
3. Import media from an allowed local path, reuse an existing vault asset, delete an unreferenced asset, and create Aurora-native assets such as compositions and 3D scenes.
4. Add, move, trim, split, reorder, rename, hide, mute, lock, and remove layers and tracks.
5. Create, enter, edit, publish, resize, and release nested clusters.
6. Set values and keyframes for 2D transforms, 3D transforms, materials, lights, cameras, constraints, influences, and rig pose channels.
7. Add, configure, connect, disconnect, mute, and remove visual nodes, including masks and render roots.
8. Add and configure audio sources, processors, buses, and links after the audio graph becomes project state.
9. Create and edit 3D objects, image planes, model assets, cameras, lights, camera cuts, paths, constraints, influences, and rigs.
10. Move the playhead, select entities, switch workspaces, capture the Motion, Nodes, 3D, Audio, and Export viewports, and receive the capture as an MCP image result.
11. Start an export, poll progress, cancel it, and retrieve its output metadata.
12. Apply a multi-step edit atomically, preview the proposed changes, and undo it as one editor history operation.

## 3. Non-goals for the first release

- An AI model embedded inside Aurora. Aurora exposes MCP; model orchestration remains in Codex, ChatGPT, or another MCP client.
- Raw arbitrary JavaScript, SQL, filesystem, or Pinia mutation tools.
- Pixel-coordinate UI automation as the primary control path.
- Internet-facing unauthenticated MCP transport.
- Collaborative multi-user editing or CRDTs.
- Claiming support for operations Aurora itself does not yet implement, notably real MP4 encoding or executable audio processing.
- Silent access to arbitrary local files. File import is restricted to explicit allowlisted roots.

## 4. Current architecture and gaps

### 4.1 What exists

- The Vue app owns live editor state in `src/stores/editor.ts`.
- Project snapshots are stored in browser IndexedDB through `AuroraProjectDatabase`.
- Serialization and migration exist in `src/engine/project/serialization.ts`; the current document version is 11.
- The Node/Hono server owns a loopback media vault, a SQLite asset index, content-addressed blobs, and byte-range media delivery.
- `shared/contracts.ts` already establishes Zod as the boundary schema mechanism.
- The hybrid renderer can render 2D, visual-node, rigged-image, and 3D content from a `RenderFrameRequest` in a browser WebGL context.
- The Pinia store contains most user operations, including history, clusters, timeline editing, visual nodes, 3D scenes, paths, influences, camera cuts, and rigs.

### 4.2 Blocking gaps

| Gap | Why it matters | Required resolution |
| --- | --- | --- |
| Projects live only in IndexedDB | A Node MCP process cannot reliably read or update browser-owned storage | Move durable project authority to the Aurora server and migrate existing IndexedDB snapshots |
| Business rules live inside Pinia methods | Reimplementing them in MCP would produce divergent behavior | Extract a browser/Node-neutral command and validation core |
| Renderer is browser-owned | MCP cannot capture the viewport from Node alone | Add an authenticated live-session bridge and later a managed headless render host |
| Audio graph is local component state | It is neither saved nor executable | Add audio graph models, serialization, commands, and rendering/runtime integration before exposing write tools |
| MP4 export is a placeholder | MCP cannot truthfully offer finished video export | Expose GIF first; gate MP4 tools until a real encoder exists |
| Asset import begins with browser `File` objects | MCP imports begin with server-visible paths or streams | Move the canonical import operation into a server media service |
| IDs and selection are often implicit | AI calls must remain deterministic across sessions | Require explicit `projectId` and object IDs for persistent mutations |
| Store saves are debounced | An MCP call needs a durable completion boundary | Commands return only after the new revision is persisted |

## 5. Architecture decision

Use a service-oriented local architecture with one authoritative command path:

```text
Codex / ChatGPT / MCP client
          |
          | MCP: STDIO first, Streamable HTTP later
          v
  Aurora MCP adapter
          |
          | typed automation API
          v
  Aurora Hono server -------------------- Media vault
          |                                  |
          | AuroraAutomationService           +-- content-addressed blobs
          |                                  +-- SQLite asset index
          |
          +-- ProjectRepository
          |     +-- atomic project documents
          |     +-- metadata + revision index
          |
          +-- EditorCommandService
          |     +-- shared schemas
          |     +-- validation/invariants
          |     +-- transactions + audit
          |
          +-- EditorSessionGateway <------ WebSocket ------ Aurora Vue app
                                                 |
                                                 +-- Pinia UI adapter
                                                 +-- Hybrid WebGL renderer
                                                 +-- viewport capture
```

### 5.1 Why MCP is an adapter

MCP handlers should validate protocol input, call `AuroraAutomationService`, and translate results into MCP content. They must not contain editor business logic. The same automation service will back integration tests, optional HTTP automation, and future first-party plugins.

### 5.2 Source of truth

- The server becomes the durable source of truth for project documents.
- The browser keeps a working copy for responsive editing.
- Every durable document has an integer `revision` separate from the existing 3D scene revision.
- UI and MCP mutations go through the same command definitions.
- The browser may apply high-frequency interactive changes locally, but commits the completed gesture as one command transaction.
- Server commits broadcast an invalidation or patch to every session viewing that project.

### 5.3 Rendering source of truth

- A connected Aurora editor session is the preferred render host because it has the exact active renderer and GPU environment.
- `aurora_viewport_capture` sends a render request through the session bridge and receives PNG bytes plus semantic metadata.
- A managed hidden browser becomes the fallback for projects that are not open. It loads an automation-only route, opens the server project, renders once, and exits or returns to a pool.
- Structural queries never require a render host.

## 6. Proposed repository layout

```text
shared/
  contracts.ts
  editor/
    documentSchemas.ts
    commandSchemas.ts
    querySchemas.ts
    resultSchemas.ts
    errorCodes.ts

core/
  editor/
    EditorDocument.ts
    executeCommand.ts
    queryDocument.ts
    projectFactory.ts
    invariants/
      timeline.ts
      clusters.ts
      nodes.ts
      scene3d.ts
      rigs.ts
      audio.ts

server/src/
  automation/
    AuroraAutomationService.ts
    AutomationAuditLog.ts
  projects/
    ProjectRepository.ts
    ProjectIndex.ts
    migrations.ts
  sessions/
    EditorSessionGateway.ts
    RenderHostPool.ts
    sessionProtocol.ts
  routes/
    projects.ts
    automation.ts
    sessions.ts
  media/
    MediaImportService.ts

mcp/
  src/
    index.ts
    server.ts
    instructions.ts
    client/AuroraAutomationClient.ts
    tools/
    resources/
    prompts/
    resultFormatting.ts
  tsconfig.json

src/
  automation/
    editorSessionClient.ts
    commandAdapter.ts
  stores/
    editor.ts
```

The `shared` and `core` folders must remain free of DOM, Node-only, Vue, Pinia, Three.js runtime, and filesystem APIs. IDs and timestamps are supplied through injected services so command tests are deterministic.

## 7. Project document and persistence

### 7.1 Document envelope

Persist a versioned envelope rather than a naked `SerializedEditorState`:

```ts
interface AuroraProjectDocument {
  schemaVersion: number
  revision: number
  savedAt: number
  state: SerializedEditorState
}
```

Keep `schemaVersion` for file migrations and `revision` for concurrency. Do not reuse `project.version`, which currently represents editor-format evolution, or `scene.revision`, which invalidates 3D runtime caches.

### 7.2 Repository format

- Store each document at `vault/projects/<project-id>.aurora.json`.
- Write to a unique file under `vault/.tmp`, flush it, and atomically rename it into place.
- Store searchable project metadata, revision, and timestamps in SQLite.
- Never store media bytes inside the project document; retain content hashes.
- Keep the last known-good document during migration and write periodic backups before destructive schema migrations.
- Add `ProjectRepository` tests using a temporary vault.

### 7.3 IndexedDB migration

1. Add the server project endpoints without changing the browser source of truth.
2. On app startup, query the server project index.
3. If server storage is empty and IndexedDB contains projects, upload every normalized snapshot.
4. Compare IDs and `updatedAt`; do not overwrite a newer server document automatically.
5. Mark migration complete in IndexedDB but retain the local records for one release as rollback data.
6. Switch browser load/save to the server repository.
7. Remove Dexie authority only after migration telemetry and tests are stable.

## 8. Shared command model

### 8.1 Command envelope

Every persistent write uses this shape:

```ts
interface EditorCommandEnvelope<TCommand> {
  operationId: string
  projectId: string
  expectedRevision?: number
  command: TCommand
}
```

- `operationId` makes retries idempotent.
- `expectedRevision` prevents overwriting newer edits.
- A command returns the new revision, changed IDs, warnings, and a compact summary.
- Validation errors use stable machine codes and field paths.

### 8.2 Command result

```ts
interface EditorCommandResult {
  ok: true
  projectId: string
  revision: number
  changedIds: string[]
  createdIds: Record<string, string>
  warnings: Array<{ code: string; message: string }>
  summary: string
}
```

Errors use a discriminated envelope with codes such as `PROJECT_NOT_FOUND`, `REVISION_CONFLICT`, `ENTITY_NOT_FOUND`, `INVALID_REFERENCE`, `CYCLE_DETECTED`, `ASSET_IN_USE`, `NO_RENDER_SESSION`, `IMPORT_PATH_DENIED`, and `UNSUPPORTED_OPERATION`.

### 8.3 Transactions

`aurora_batch_apply` accepts a bounded list of semantic operations. The service:

1. Loads one project revision.
2. Clones a working document.
3. Applies every command and validates cross-object invariants.
4. Produces a dry-run diff when `dryRun: true`.
5. Persists once when all operations succeed.
6. Broadcasts one update and creates one undo entry.

No partial state is retained after a failed operation.

## 9. MCP surface

Tool names use lowercase snake case for broad client compatibility. Inputs use strict JSON Schema with `additionalProperties: false`. Persistent tools require `projectId`; session-only tools require `sessionId`.

### 9.1 Discovery and project tools

| Tool | Purpose | Mutation |
| --- | --- | --- |
| `aurora_capabilities` | Return server version, schema version, enabled feature gates, transports, and limits | No |
| `aurora_project_list` | Page through project summaries | No |
| `aurora_project_get` | Return a compact project overview or requested sections | No |
| `aurora_project_create` | Create an empty normalized project | Yes |
| `aurora_project_update` | Rename project or update dimensions, frame rate, duration, and background | Yes |
| `aurora_project_open` | Open a project in an existing or managed editor session | Session |
| `aurora_project_duplicate` | Clone structure while preserving media references | Yes |
| `aurora_project_delete` | Delete a project after explicit confirmation; media remains reference-counted | Destructive |

`aurora_project_get` uses a section allowlist such as `summary`, `timeline`, `assets`, `nodes`, `audio`, `scenes3d`, and `rigs`. Default output is intentionally compact.

### 9.2 Editor session and viewport tools

| Tool | Purpose |
| --- | --- |
| `aurora_session_list` | List active UI and managed render sessions |
| `aurora_editor_state` | Read workspace, playhead, selection, open cluster, active camera, and save status |
| `aurora_editor_navigate` | Set workspace, playhead, active cluster, selection, selected node, or selected 3D entity |
| `aurora_viewport_capture` | Render and return a PNG for Motion, Nodes, 3D, Audio, or Export |
| `aurora_viewport_compare` | Capture two times or workspaces and return both images with a structural delta |

`aurora_viewport_capture` parameters include `projectId`, optional `sessionId`, `workspace`, `time`, `width`, `height`, `quality`, `includeOverlays`, optional `nodeId`, optional `sceneId`, and optional `cameraId`. The response contains an MCP image block and text metadata: exact time, frame, project revision, camera, source count, render backend, and warnings.

### 9.3 Asset tools

| Tool | Purpose |
| --- | --- |
| `aurora_asset_list` | Query project library or global vault by kind/name/hash |
| `aurora_asset_get` | Read metadata, references, and available thumbnail/resource URIs |
| `aurora_asset_import_file` | Import a file under an allowlisted root into the vault and optionally the project |
| `aurora_asset_attach` | Attach an existing vault item to a project library |
| `aurora_asset_delete` | Remove a project or vault reference with reference checks |

Local file import rules:

- Resolve the real canonical path.
- Require it to be under `AURORA_MCP_IMPORT_ROOTS` or an explicitly configured project import directory.
- Reject devices, directories, symlink escapes, unsupported extensions, and files above the configured limit.
- Stream bytes through the existing hash/blob pipeline.
- Do not add URL fetching in the first release; it creates SSRF and authentication concerns.

### 9.4 Timeline and cluster tools

| Tool | Purpose |
| --- | --- |
| `aurora_timeline_get` | Return flattened or nested tracks, clips, timings, and channels |
| `aurora_layer_add` | Add media, generated text/shape, adjustment, audio, cluster, or 3D scene layer |
| `aurora_layer_update` | Update name, timing, visibility, lock, mute, text/shape content, and transform defaults |
| `aurora_layer_move` | Move or reorder a clip/track with optional ripple behavior |
| `aurora_layer_split` | Split a clip at an exact frame |
| `aurora_layer_delete` | Remove clips with explicit `keepTracks` and ripple options |
| `aurora_cluster_create` | Cluster selected layer IDs or create an empty cluster |
| `aurora_cluster_update` | Rename/resize a cluster and optionally fit it to children |
| `aurora_cluster_release` | Release children back into the parent context |

All time values are seconds plus an optional integer `frame` alternative. Supplying both is an error. Results echo canonical snapped seconds and frames.

### 9.5 Animation tools

| Tool | Purpose |
| --- | --- |
| `aurora_animation_channels` | List animatable property IDs, paths, value types, defaults, and current keys |
| `aurora_keyframes_set` | Upsert many keyframes on one or more channels |
| `aurora_keyframes_delete` | Delete by IDs, time range, or channel |
| `aurora_keyframes_move` | Retime keys with collision policy and snapping |
| `aurora_keyframes_interpolate` | Set hold, linear, or Bézier interpolation and easing handles |

Channels are addressed by stable property ID and accompanied by a readable path such as `layers/<id>/transform/opacity`. The service validates bounds and sorts keys after every edit.

### 9.6 Visual node tools

| Tool | Purpose |
| --- | --- |
| `aurora_graph_get` | Return node definitions, nodes, sockets, links, and render root |
| `aurora_node_add` | Create a supported node with defaults and optional position/source |
| `aurora_node_update` | Update title, position, source, properties, socket defaults, mute, or mask feather |
| `aurora_node_connect` | Create or replace a compatible input link |
| `aurora_node_disconnect` | Remove a link |
| `aurora_node_delete` | Delete nodes and dependent links |
| `aurora_graph_set_root` | Set or clear the Viewer render root |

The server uses the same `NODE_DEFINITIONS`, dynamic socket synchronization, type checking, and cycle prevention as the UI.

### 9.7 Audio graph tools

Do not expose these until the audio graph is promoted from `AudioWorkspace.vue` local state into `SerializedEditorState` and project migrations.

| Tool | Purpose |
| --- | --- |
| `aurora_audio_graph_get` | Read sources, processors, buses, links, and meters available from the current runtime |
| `aurora_audio_node_add` | Add source, gain/pan, EQ, compressor, reverb, bus, or output node |
| `aurora_audio_node_update` | Change inline node parameters, mute, solo, bypass, or routing properties |
| `aurora_audio_connect` | Connect compatible audio ports with cycle prevention |
| `aurora_audio_disconnect` | Remove an audio link |
| `aurora_audio_node_delete` | Delete a processor and optionally reconnect the chain |

Audio meters are transient session data, not persisted project state.

### 9.8 3D scene tools

| Tool | Purpose |
| --- | --- |
| `aurora_scene3d_get` | Read a scene or selected sections |
| `aurora_scene3d_create` | Create an empty scene and its timeline/library wrapper |
| `aurora_scene3d_entity_add` | Add box, sphere, image plane, model, group/null, camera, or light |
| `aurora_scene3d_entity_update` | Update name, visibility, lock, transform, material, asset, light, or camera fields |
| `aurora_scene3d_entity_delete` | Delete an entity and repair dependent references |
| `aurora_scene3d_camera_cuts` | Replace or patch the normalized camera-cut sequence |
| `aurora_scene3d_path_edit` | Create/update/delete paths and points, including handles and modes |
| `aurora_scene3d_constraint_set` | Set or clear camera path/object constraints and their offsets |
| `aurora_scene3d_influence_edit` | Add/update/reorder/toggle/delete geometry influences |
| `aurora_scene3d_environment_set` | Set HDR environment, intensity, shadows, quality, and background |

Bulk transform and material patches are preferred over one tool call per axis. Animation remains in the shared animation tools through property IDs.

### 9.9 Rig tools

| Tool | Purpose |
| --- | --- |
| `aurora_rig_get` | Read rigs, bones, attachments, and animatable pose channels |
| `aurora_rig_create` | Create a rig with validated mesh density |
| `aurora_rig_update` | Rename or change grid density |
| `aurora_rig_attach` | Attach/detach a rig from an image layer or 3D image plane |
| `aurora_rig_bones_edit` | Add/update/reparent/delete multiple bones atomically |
| `aurora_rig_delete` | Delete a rig and release every attachment |

Bone edit validation must reject self-parenting and descendant cycles and preserve children when a parent is removed.

### 9.10 Export tools

| Tool | Purpose |
| --- | --- |
| `aurora_export_capabilities` | Report truthful encoder/format support |
| `aurora_export_start` | Start GIF export with range, size, palette, rate, and loop settings |
| `aurora_export_status` | Return job progress, warnings, output path/size, and completion state |
| `aurora_export_cancel` | Cancel a running job |

Export output must go to a configured Aurora export directory or explicit allowlisted path. MP4 stays absent from capabilities until the encoder is real.

### 9.11 Batch tool

`aurora_batch_apply` is the primary construction tool for agents. It accepts up to a configured number of operations, supports `dryRun`, and returns a concise diff. Individual tools remain useful for exploration and simple edits; batch avoids dozens of network round trips while creating a composition.

## 10. MCP resources and prompts

### 10.1 Resources

Expose read-only resources for large or reusable context:

- `aurora://projects`
- `aurora://project/{projectId}/summary`
- `aurora://project/{projectId}/document`
- `aurora://project/{projectId}/timeline`
- `aurora://project/{projectId}/graph`
- `aurora://project/{projectId}/audio`
- `aurora://project/{projectId}/scene/{sceneId}`
- `aurora://project/{projectId}/rig/{rigId}`
- `aurora://asset/{assetId}/metadata`
- `aurora://asset/{assetId}/thumbnail`
- `aurora://session/{sessionId}/state`

Full documents are resources, not default tool responses. Tools return resource links when the result is too large.

### 10.2 Prompts

After tools stabilize, add optional prompts for repeatable workflows:

- `aurora_build_composition`
- `aurora_animate_selection`
- `aurora_build_3d_scene`
- `aurora_audit_project`
- `aurora_prepare_export`

Prompts never grant capabilities beyond the underlying tools.

## 11. MCP server instructions and annotations

The server initialization `instructions` should begin with a self-contained rule set under 512 characters, because current Codex guidance recommends putting the most important cross-tool behavior first. It should state:

- Inspect capabilities and project revision before editing.
- Use explicit project/object IDs.
- Prefer batch dry-runs for multi-step edits.
- Capture a viewport after material visual changes.
- Never retry a revision conflict blindly.
- File imports are restricted to configured roots.
- Destructive tools require explicit intent.

Apply MCP tool annotations accurately:

- Queries and captures: `readOnlyHint: true`.
- Deterministic upserts with operation IDs: `idempotentHint: true`.
- Delete/release operations: `destructiveHint: true`.
- Local vault operations: `openWorldHint: false`.
- Any future URL import: `openWorldHint: true` and approval required.

Codex supports STDIO and Streamable HTTP MCP servers, server instructions, allow/deny lists, and per-tool approval behavior. Default local configuration should use approval mode `writes`, with destructive tools overridden to `prompt`.

## 12. Internal automation API

The Hono server exposes an internal loopback API used by MCP and the browser:

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
POST   /api/projects/:id/commands
POST   /api/projects/:id/batch
GET    /api/projects/:id/query/:section
POST   /api/assets/import-file
GET    /api/sessions
POST   /api/sessions/:id/navigate
POST   /api/sessions/:id/capture
GET    /api/jobs/:id
DELETE /api/jobs/:id
WS     /api/editor-session
```

Loopback binding is necessary but not sufficient. Generate a random capability token when the Aurora server starts. The app and MCP process receive it through a protected launch/config path and send it on every automation request. Do not expose the token in URLs or stdout.

## 13. Live editor session protocol

The browser opens a WebSocket after project initialization and registers:

```ts
interface EditorSessionHello {
  sessionId: string
  projectId: string
  revision: number
  appVersion: string
  capabilities: string[]
}
```

Server-to-browser requests:

- `navigate`: workspace, time, selection, cluster, node, scene, or camera.
- `capture`: render workspace/target at exact time and dimensions.
- `reloadRevision`: load a committed server revision.
- `applyCommand`: optional low-latency path after shared command execution is stable.
- `ping` and `shutdown` for lifecycle.

Browser responses carry `requestId`, success/error, current revision, and optional binary PNG data. Requests have cancellation and timeouts. A disconnected browser never leaves an MCP call hanging; it returns `NO_RENDER_SESSION` or starts the managed render host when enabled.

## 14. Security and safety

1. Bind HTTP and Streamable HTTP to loopback by default.
2. Use a per-launch capability token for internal automation routes.
3. Use OAuth or bearer authentication before any non-loopback deployment.
4. Canonicalize every filesystem path and enforce allowlisted roots.
5. Set byte, pixel, frame, node, layer, batch-operation, and response-size limits.
6. Validate all MCP and internal API input with Zod at the boundary.
7. Never expose a raw document patch, SQL, shell, or arbitrary file-read tool.
8. Require `expectedRevision` for destructive or high-impact writes once a project has multiple sessions.
9. Record tool name, operation ID, project, old/new revision, changed IDs, duration, result, and caller/session in an append-only audit log. Do not log media bytes or secrets.
10. Make destructive operations explicit and reference-aware.
11. Return previews/diffs before deleting clusters, scenes, rigs, or referenced assets.
12. Send MCP protocol messages only on stdout for STDIO; diagnostics go to stderr or the audit file.

## 15. Concurrency, undo, and consistency

- Use optimistic concurrency on every durable command.
- Return `REVISION_CONFLICT` with current revision and a compact changed-section list.
- Cache completed `operationId` results for safe retries.
- One MCP batch becomes one history entry in connected editor sessions.
- UI interactive gestures become one committed command when the gesture ends.
- Server broadcasts committed revisions; sessions acknowledge or reload.
- Reject commands against stale entity IDs instead of silently retargeting current selection.
- Save cluster library templates and their source clusters in the same transaction.
- Repair node links, scene references, camera cuts, rig attachments, and asset references before commit.

## 16. Result design for agents

Tool results should be compact and decision-ready:

```json
{
  "ok": true,
  "projectId": "project-123",
  "revision": 42,
  "summary": "Added text layer 'Title' on V2 from frame 30 to 150 and keyed opacity.",
  "createdIds": { "layerId": "layer-456" },
  "changedIds": ["layer-456"],
  "warnings": [],
  "next": ["Capture Motion viewport at frame 30", "Save or continue editing"]
}
```

- Never return only “success”.
- Echo canonical snapped values.
- Include IDs needed by the next call.
- Paginate lists and allow field/section selection.
- Return resource links for large state.
- Add an image content block for viewport tools.
- Include actionable recovery information in errors.

## 17. Delivery phases

### Phase 0 — Contracts and architectural seams

Deliverables:

- Add shared Zod schemas for the complete project document.
- Add command/query/result envelopes and stable error codes.
- Extract deterministic ID/clock services.
- Add `AuroraAutomationService` interfaces with in-memory fakes.
- Add architecture decision records for persistence, command authority, and viewport rendering.

Exit criteria:

- Browser and Node type-check against the same schemas.
- A normalized project round-trips through the new document schema.
- No MCP dependency is required by core editor code.

### Phase 1 — Server-owned projects and read-only MCP

Deliverables:

- Implement atomic `ProjectRepository` and SQLite project index.
- Add browser migration from IndexedDB.
- Add project list/get/create/open REST routes.
- Scaffold STDIO MCP with `aurora_capabilities`, project queries, asset queries, timeline query, graph query, scene query, and rig query.
- Add project-scoped `.codex/config.toml.example` and setup documentation.

Exit criteria:

- Codex can list and inspect the same projects visible in Aurora.
- Restarting app/server preserves identical normalized state.
- Read-only tools are correctly annotated and contract-tested.

### Phase 2 — Shared mutations, assets, timeline, and clusters

Deliverables:

- Extract project/timeline/cluster invariants from Pinia into core commands.
- Implement revisioned command execution and `aurora_batch_apply`.
- Move canonical file import to `MediaImportService`.
- Add asset, project update, layer, track, and cluster tools.
- Map batches to single UI history entries.

Exit criteria:

- An MCP client can create a project, import media, assemble a nested timeline, reload it, and get the same structure.
- Revision conflicts and retry idempotency have integration tests.
- A failed batch leaves no partial changes.

### Phase 3 — Animation and visual nodes

Deliverables:

- Add stable channel discovery and bulk keyframe commands.
- Extract graph mutation invariants and node definitions into shared core.
- Add animation and visual graph tools.
- Add structural graph evaluation summaries to project inspection.

Exit criteria:

- An agent can build and animate a 2D composition and a valid visual effect graph entirely through MCP.
- Cycles, invalid sockets, invalid sources, and keyframe collisions are rejected deterministically.

### Phase 4 — 3D, paths, influences, cameras, and rigs

Deliverables:

- Extract 3D entity, path, constraint, influence, camera-cut, and rig commands.
- Add the 3D and rig tool families.
- Add reference repair and validation at transaction commit.
- Add high-level scene summaries for agent inspection.

Exit criteria:

- An agent can create a lit 3D scene, animate a camera on a path, add influences, rig an image plane, and save/reload without broken references.

### Phase 5 — Live session bridge and viewport vision

Deliverables:

- Add authenticated WebSocket session registration.
- Add editor navigation and PNG capture commands.
- Add Motion/Nodes/3D/Audio/Export capture adapters.
- Add managed hidden-browser fallback and a small render-host pool.
- Add image result formatting and viewport resource templates.

Exit criteria:

- After each material edit, an MCP client can capture the exact frame and workspace.
- Captures report project revision and are rejected if the session is stale.
- A closed project can be captured through the managed render host.

### Phase 6 — Persistent audio graph

Deliverables:

- Define `AudioNode`, typed ports, connections, buses, and transient meter state.
- Migrate the current AudioWorkspace prototype into project state.
- Add audio graph commands, serialization migration, runtime evaluation, and tools.

Exit criteria:

- Audio graph edits survive reload and affect preview/export audio once an audio runtime exists.
- MCP reports the distinction between persistent parameters and transient meters.

### Phase 7 — Export jobs, hardening, and optional remote transport

Deliverables:

- Move GIF export into a server-visible job abstraction or render-host job.
- Add status/cancel/output metadata tools.
- Add audit viewer, limits, load tests, crash recovery, and packaging.
- Add Streamable HTTP transport behind authentication.
- Add tool allowlist profiles such as `read-only`, `editing`, `3d`, and `full`.

Exit criteria:

- Long jobs survive MCP client polling and cancel cleanly.
- Security tests cover path traversal, oversized inputs, replay, auth failure, and destructive approval metadata.
- STDIO and authenticated HTTP pass the same MCP conformance suite.

## 18. Test strategy

### Unit tests

- Every Zod input/output schema.
- Time/frame canonicalization.
- Project format bounds.
- Timeline/track compatibility and ripple behavior.
- Cluster nesting, name uniqueness, and template synchronization.
- Node socket compatibility, replacement, dynamic inputs, and cycle rejection.
- 3D entity reference cleanup, camera-cut normalization, and path editing.
- Influence parameter bounds and ordering.
- Rig parent-cycle rejection and attachment cleanup.
- File root/symlink enforcement.
- Operation idempotency and revision conflict behavior.

### Repository tests

- Atomic save and crash-before-rename recovery.
- Migration from every supported project version.
- Concurrent read/write behavior.
- Metadata index rebuild from project files.
- Media reference integrity.

### MCP contract tests

- Start the STDIO server with an in-memory automation service.
- List tools/resources and snapshot their schemas.
- Call every tool with valid, invalid, missing, and extra fields.
- Assert annotations, error codes, image content, pagination, and resource links.
- Ensure stdout contains only MCP frames.

### Integration workflows

1. Create a 1920×1080/30 project.
2. Import an image and audio clip from an allowed fixture root.
3. Add image, text, shape, adjustment, and audio layers.
4. Trim/split/reorder them and create a nested cluster.
5. Key text position and opacity with Bézier interpolation.
6. Build a blur/mask/composite visual graph.
7. Create a 3D scene with object, image plane, camera, lights, path, camera cuts, and influence.
8. Create and attach a rig, then animate a bone.
9. Capture Motion, Nodes, and 3D viewports at known frames.
10. Save, close, reopen, and compare the normalized document.
11. Export a ranged GIF and verify frame count and output metadata.

### Visual tests

- Capture deterministic fixtures at fixed dimensions and times.
- Compare perceptual hashes with a tolerance rather than raw PNG bytes.
- Record renderer/backend metadata with failures.
- Keep structural assertions alongside image assertions so a similar-looking wrong scene does not pass.

## 19. Acceptance criteria

- No MCP write bypasses domain commands or project revision checks.
- All persistent entity types are inspectable with stable IDs.
- Every supported UI mutation has either a matching semantic command or an explicitly documented gap.
- The agent can verify visual edits through viewport image results.
- Imported files cannot escape configured roots.
- Project creation and editing work without an already open UI; visual capture can start a managed render host.
- Active UI sessions converge on MCP commits without silent data loss.
- Tool results are concise enough for iterative agent use and large data is available through resources.
- The complete end-to-end workflow passes on Windows, the current primary development platform.
- OpenAI/Codex setup instructions document STDIO, project-scoped configuration, approval modes, timeouts, and tool allowlists.

## 20. First implementation slice

The first pull request on this branch should be deliberately narrow:

1. Add shared project envelope and project-summary schemas.
2. Implement `ProjectRepository` with atomic JSON files and SQLite metadata.
3. Add list/get/create endpoints without switching the browser yet.
4. Scaffold an STDIO MCP server exposing:
   - `aurora_capabilities`
   - `aurora_project_list`
   - `aurora_project_get`
   - `aurora_project_create`
5. Add in-memory and temporary-vault integration tests.
6. Add `.codex/config.toml.example` and a manual smoke-test script.

Do not begin timeline mutation tools until project persistence and revision behavior are proven.

## 21. Open decisions to resolve in Phase 0

1. Whether project documents remain JSON-only or gain a compact binary option later. Default: JSON for inspectability and migrations.
2. Whether the managed render host uses Playwright or a packaged Electron/Chromium control channel. Default: reuse the packaged app runtime if available; Playwright only for development and CI.
3. Whether server command broadcasts send JSON Patch or revision invalidations. Default: invalidation first, typed patches after correctness is established.
4. Maximum tool count exposed by default. Default: all read tools plus core editing; advanced 3D/audio/export tools enabled through profiles if discovery latency becomes material.
5. Retention and UI for the audit log. Default: bounded JSON Lines files under the Aurora vault with media paths redacted.
6. Export process ownership. Default: render host owns browser-dependent encoding; server owns job state and output placement.

## 22. Documentation basis

The design follows current official OpenAI guidance that Codex supports local STDIO and Streamable HTTP MCP servers, reads server instructions, supports project-scoped configuration, tool allow/deny lists, timeouts, and write-aware approval modes. See:

- [Model Context Protocol in Codex](https://developers.openai.com/codex/mcp/)
- [MCP and Connectors in the OpenAI API](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

