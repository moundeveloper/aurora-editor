# Aurora MCP server

Aurora exposes its local project vault over an MCP STDIO server. The editor and MCP server use the
same project repository, so an MCP-authored project appears in Aurora's project browser and remains
fully editable.

## Animated PHASE HUD preset

`aurora_project_create_phase_hud` creates a new 1080 × 1500, 30 fps, 12-second
project. Optional `name` is the only setting; existing projects are never replaced.
The same factory powers **Project Browser → Create animated HUD · 12s portrait**,
which uses the Name field. Use `node mcp/src/create-phase-hud.ts [name]` when MCP
tools are not attached.

The preset contains 15 editable image cards: dark circuit artwork, cyan telemetry
panels, orange markers, keyframed scan cursors and status pulses, an acquisition
sweep, and a drifting camera with animated focus. All animation loops at 12 seconds.
SVG typography is embedded artwork inside each card, not individual text layers.
There is no animated film grain or chromatic-aberration pass; those would require
additional effects with matching UI controls. Fine artwork is batched into textures
to keep scene cost small. Camera previews use the actual runtime.

`node mcp/src/render-project.ts <id> full 720 1000 6` renders the frame at six seconds.
`tests/browser/phase-hud-smoke.mjs` exercises UI preset creation and scrubbing in an
isolated browser with all HTTP writes intercepted. `mcp/src/render-phase-hud-loop.ts`
renders a low-frame-rate contact preview through MCP; the saved project runs at 30 fps.

## Scene grading and ambient occlusion

`aurora_scene_look_set` accepts `projectId`, `sceneId`, and a partial `settings` object.
The equivalent UI is **3D → Inspector → Color grading / Renderer**. Both use shared
validation; UI changes support undo/redo. Omitted values are preserved.

```json
{"ambientOcclusion":true,"quality":"full","colorGrade":{"enabled":true,"temperature":10,"tint":0,"contrast":1.05,"saturation":1.05}}
```

Temperature/tint range from -100 to 100; contrast/saturation from 0 to 2 (neutral 1).
Grading is optional and disabled for older scenes. It runs after the view transform in
the existing output pass, with exact neutral/bypass behavior and unchanged alpha.
The same renderer supplies the viewport, camera preview, scene composition, and export.
This provides basic global grading; LUT import, curves, and selective grading are not
implemented by this control.

Other settings: `exposureStops` (-10–10), `viewTransform` (`aces`, `agx`, `neutral`,
`standard`), `ambientOcclusionIntensity` (0–3), `ambientOcclusionRadius` (0.01–5),
and `quality` (`draft`, `preview`, `full`). AO is live GTAO, not baked; Draft bypasses it.
For unattached MCP sessions, save a settings JSON file and run:

```powershell
node mcp/src/set-scene-look.ts <project-id> <scene-id> <settings.json>
```

`tests/browser/scene-look-smoke.mjs` verifies the inspector grading enable/saturation/reset
and AO toggle in an isolated context with HTTP writes intercepted.

## Run

```powershell
pnpm mcp
```

Register it with Codex from the repository root:

```powershell
codex mcp add aurora-editor -- node mcp/src/index.ts
```

The server currently provides:

- `aurora_scene_render_preview` — render a saved camera with Aurora's actual WebGL runtime and post-processing; return a PNG, artifact path, geometry counts, GPU-inclusive timing, and redundant instance-upload counts. Works without a running editor or app server.
- `aurora_project_create_crimson_citadel` — create the editable White Gardens scene, with native cathedral towers, arched bridges, crimson ivy, cloud banks, and 40,000 botanical instances. Optionally regenerate an explicit project ID.
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

## Reliable camera preview and profiling

Install dependencies with `pnpm install`. The renderer launches isolated **headless Chromium** with a
fresh browser context and temporary local Vite server; it uses the same `ThreeSceneRuntimeRegistry`
and `AuroraSceneRenderPipeline` as the editor. No desktop automation connection is required. Browser
lookup checks `AURORA_CHROMIUM_PATH`, Playwright's installed Chromium, and installed Chrome/Edge on
Windows. If none is installed, set `AURORA_CHROMIUM_PATH` to a Chromium executable. It never connects
to an existing browser profile or tab.

Call `aurora_scene_render_preview` with:

```json
{
  "projectId": "31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f",
  "sceneId": "scene-crimson-citadel",
  "time": 0,
  "quality": "preview",
  "width": 960,
  "height": 540,
  "benchmarkFrames": 6
}
```

`sceneId` and `cameraId` are optional; omission selects the first scene and its camera cut at `time`.
`quality` is an optional render-only override; omission honors the saved scene settings. Resolution
is bounded to 1920 × 1080. The output contains the PNG as MCP image content and a path under
`<vault>/renders`, plus a matching JSON report. Allow up to 180 seconds on a cold machine; warm runs
typically finish in a few seconds. Files are retained for inspection; no project save is performed.

When the MCP server is not attached to the agent session, this CLI invokes exactly the same tool:

```powershell
pnpm mcp:render-preview <project-id> preview 960 540
```

The statistics include first scene setup time, median/P95 steady-state scene sync and complete frame
time (including GPU completion), total pass draw calls/triangles, scatter instance count, and instance
buffer upload count. Zero uploads are expected for repeated renders of static geometry. Timings are
specific to the reported GPU/resolution and do not include editor UI work. This renders a saved 3D
camera, not unsaved viewport state or the complete 2D/compositing graph; motion-blur accumulation is
not performed by this still-preview tool.

For a read-only **actual editor** performance/screenshot check against the running dev app:

```powershell
node tests/browser/large-scene-smoke.mjs <project-id> final
```

This uses a separate Chrome context, intercepts HTTP writes, and checks scrubbing, selection, an object
edit, and undo. `AURORA_APP_URL` overrides `http://localhost:5173`. It saves screenshots/timings to
`artifacts/crimson-citadel`. The persistent [agent workflow](../AGENTS.md) points future sessions here.

Implementation references: [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
documents explicit instance-buffer and bounds updates; [Playwright browser support](https://playwright.dev/docs/browsers)
documents installed Chromium/Chrome/Edge support. Static redraws reuse instance data; animation or
geometry changes invalidate it.

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
