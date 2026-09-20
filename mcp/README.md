# Aurora MCP server

Aurora exposes its local project vault over an MCP STDIO server. The editor and MCP server use the
same project repository, so an MCP-authored project appears in Aurora's project browser and remains
fully editable.

## Run

```powershell
pnpm mcp
```

Register it with Codex from the repository root:

```powershell
codex mcp add aurora-editor -- node mcp/src/index.ts
```

The server currently provides:

- `aurora_project_list` — list projects in the vault.
- `aurora_project_get` — inspect a complete editable project document.
- `aurora_project_create_showcase` — author and activate the Neon Singularity hybrid animation.
- `aurora_project_create_pillar_run` — author and activate the DRONE-07 cinematic pillar run.
- `aurora_scene_object_influence_upsert` — add or update array, radial-array, mirror, subdivision, displacement, or twist influences on an existing mesh or group.
- `aurora_scene_camera_lens_set` — switch depth of field on for a camera and set its focus distance and f-number, either as values or as keyframed curves.
- `aurora_scene_light_upsert` — add or update an ambient, directional, point, or spot light, including a spot's cone angle, range, and edge softness.
- `aurora_scene_environment_set` — light a scene from an imported `.hdr` or `.exr` radiance map, optionally drawing it as the background.
- `aurora_scene_model_add` — place an imported `.glb` or `.gltf` mesh in a scene.
- `aurora_model_create` — create an editable native cube or plane in Project Assets.
- `aurora_model_get` — inspect draft revision and paginated polygon/vertex IDs.
- `aurora_model_operations_apply` — atomically draw knife paths, loop-cut, edge-slide, extrude-region, inset-region, delete selected topology, merge, dissolve, fill boundaries/holes, remove loose vertices, translate, scale, or recolor a native model using the same kernel as the Modeling workspace. Results include per-operation created/deleted IDs, selection candidates, and diagnostics.
- `aurora_model_publish` — publish an immutable native revision; `aurora_scene_model_add` also places these native models.

See [the modeling implementation notes](../docs/explained/3d-modeling-implementation.md) for the human workflow,
operation examples, current limits, and conflict handling. Restart the MCP process to discover new tools.

Construction operations use the same atomic batch endpoint:

- `subdivide`: `mode` (`face` or `edge`), selected `ids`, and `cuts` (1–15, default
  1). Fully selected triangles/quads become regular grids; partial edge selections
  add points shared by all incident faces. Unselected neighbors retain their IDs.
- `unsubdivide`: selected `faceIds` and `iterations` (1–4, default 1). Coarsens
  complete regular 2×2 quad blocks while preserving geometry. It works after
  persistence without an undo history. Irregular or incomplete grids are rejected.
- `connect-path`: distinct `vertexIds` in path order (2–128). Splits faces along
  straight paths over continuous coplanar surfaces, reusing shared edge intersection
  vertices. Returns the completed path in `changes[].selection.edge`.

- `bevel`: `mode` (`edge` or `vertex`), selected `ids`, `width` in meters,
  `segments` (1–16, default 1), `profile` (0.1–0.9, default 0.5), and
  `clampOverlap` (default true). Requires closed convex components with planar
  outward faces. Vertex mode currently supports one segment.
- `bridge`: `edgeIds` from two complete open loops with equal vertex counts,
  `cuts` (0–32, default 0), and signed `twist` in vertex steps (default 0).
  Correspondence is automatically aligned before applying twist; cuts interpolate
  linearly. Created faces are returned as selection candidates.

For a protocol-level smoke test that launches the server and calls its authoring tool through an MCP
client:

```powershell
pnpm mcp:create-showcase "My Aurora Premiere"
pnpm mcp:create-drone "DRONE-07 Pillar Run"
pnpm mcp:inspect-project <project-id>
```

Set `AURORA_VAULT` for an isolated vault. By default both the application server and MCP server use
`%USERPROFILE%\Aurora`.

The edge construction operations share UI preview, validation, and persistence:
- `rotate-edge`: `edgeIds` of independent interior diagonals between coplanar
  triangles. Rejects boundaries, shared faces, and existing/outside diagonals.
- `split`: selected `faceIds`; duplicates only vertices shared with unselected
  faces, retaining positions and all face IDs. Already disconnected regions reject.
- `rip`: selected `faceIds` plus a nonzero `offset: [x,y,z]` in meters; detaches
  and translates the entire region. This is face-region rip, not vertex-seam rip.
- `poke`: selected planar `faceIds`, `offset` in meters along each face normal
  (default 0, -1000 to 1000). Creates one center and a triangle fan per face.

### Selection queries

`aurora_model_selection_query` takes `projectId`, `assetId`, `expectedRevision`, and
`selection: { mode, action, ids }`. Modes are `vertex`, `edge`, and `face`; actions
are `linked`, `path`, `grow`, `shrink`, and `invert`. It returns selection IDs and
revision without modifying the project or the UI selection. Stale revisions and
unknown IDs reject. Path requires two distinct endpoints and minimizes connection
count, not geometric distance. Vertices connect along authored edges, edges through
shared endpoints, and faces across shared edges. Grow adds one ring; shrink removes
selection borders, open mesh boundaries, and isolated elements. Invert permits an
empty starting selection. Linked and path include hidden geometry.

Selection queries also support `action: "similar"` with `property` and optional
`tolerance` (0–180, default 0). Vertex properties: `degree`, `face-count`; edge:
`length`, `angle`, `face-count`; face: `area`, `normal`, `corners`. Tolerance is
absolute meters, square meters, degrees, or counts. Matches expand from any input
reference and retain reference order. Face area uses fan triangulation; normals
retain orientation. Angle references require two incident faces.

`action: "trait"` takes `trait: "boundary" | "non-manifold" | "loose" | "poles"`.
The last two require vertex mode. Pass `ids: []` to query the entire mesh without
references. Non-manifold includes boundaries, isolated vertices and disconnected
vertex fans; face traits select faces touching matching vertices. Interior poles
have positive edge count other than four, excluding boundary vertices. Trait
results replace selection; neither query mutates the draft or UI.

`action: "checker"` filters current IDs by shortest adjacency rings within the
selected subgraph. Parameters: `keep`, `skip` (integers 1–100, default 1), `offset`
(integer 0–199, default 0). Each component starts at its first selected ID. Odd
cycles and branches may not alternate perfectly; results retain input order.

Named sets use `aurora_model_operations_apply`:
- `selection-set-save`: `name` (trimmed, 1–64 characters), `mode`, ordered nonempty
  `ids`, and optional `replace: true` to update an existing name. Maximum 64 sets.
- `selection-set-delete`: `name`. Unknown names reject, and batches remain atomic.

`aurora_model_get` includes `selectionSets` summaries (`name`, `mode`, `count`). Pass
`selectionSet: "Name"` to read its IDs using the existing `offset`/`limit` pagination.
Set writes increment draft revision and support project undo in the UI. Topology
edits prune deleted IDs and retain empty sets; new elements are never auto-enrolled.

Shape operations share the UI's atomic preview kernel:
- `shrink-fatten`: `vertexIds`, signed `distance` in meters (-1000 to 1000). Moves
  along normalized area-weighted normals from all incident faces; no shell-thickness
  correction. Loose vertices and cancelling normals reject.
- `push-pull`: at least two `vertexIds`, signed `distance`. Fixed radial movement
  from the selection centroid; pivot vertices and pivot crossings reject.
- `flatten`: at least three `vertexIds`, `plane: "average" | "x" | "y" | "z"`, and
  `strength` (0.001–1, default 1). Plane passes through the selection centroid.
  Average uses fully selected faces or incident faces as fallback, not a best-fit
  solver. X/Y/Z specify the plane normal.

All preserve topology IDs. Zero/no-op operations, local reversals, collapse, and
invalid polygon output reject. Global self-intersections are not detected.
