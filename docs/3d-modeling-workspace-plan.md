# 3D Modeling workspace and shared MCP authoring

Status: proposed implementation plan, 2026-09-18. No modeling functionality is implemented by this document.

## 1. Product decision

Add **3D Modeling** alongside **3D Scene**, sharing the viewport foundation, rendering, materials, assets, and command engine. Modeling creates reusable geometry; Scene places, lights, animates, and renders it. Both humans and MCP invoke the same validated operations.

A separate workspace is a workflow choice, not a technical requirement for recreating the reference. Existing primitives could already support a rough blockout. The new workspace provides the missing ability to edit surfaces and save native, reusable models. Allow “Edit Model” from a scene instance and return to the same scene/camera/selection after editing. Later, expose the same editor in an isolated scene context without duplicating tools.

Aim first for a Blender-inspired hard-surface modeler suited to environments, props, and motion graphics. Full Blender parity is a much larger program. Sculpting, retopology, advanced UV painting, character skinning, simulation authoring, and arbitrary geometry nodes are subsequent tracks.

## 2. Verified repository foundation

| Area | Existing implementation | Consequence |
| --- | --- | --- |
| Workspace | `src/components/ThreeDWorkspace.vue`: orbit, orthographic views, transform gestures, shading modes, picking, paths and rig controls | Extract reusable viewport infrastructure incrementally; preserve current scene interactions |
| Scene model | `src/models/editor.ts`: mesh/group/null objects; box/sphere/plane/model primitives; transforms, materials, influences | Add native geometry references without changing the meaning of imported models |
| Rendering | `src/engine/scene3d/ThreeSceneRuntime.ts`, `src/engine/rendering/` | Extend geometry resolution; keep one appearance pipeline across modeling, scene, composition, and export |
| Modifiers | `influences.ts`, `bevelGeometry.ts`, `booleanGeometry.ts`, `shellGeometry.ts` | Reuse supported behavior through adapters; do not equate current capabilities with general mesh-editing operations |
| Bevel | Convex, low-poly chamfer with planar-face limits | General selected-edge bevel needs a new implementation and explicit validation |
| Boolean | Existing BVH CSG wrapper, vertex ceiling, discarded material groups | Must preserve material provenance, report unsupported input, and validate output before it becomes native geometry |
| Imported models | glTF subtree with original hierarchy/materials; Aurora material/influence edits do not apply | “Convert to Editable” must be an explicit conversion, preserving the imported source |
| Assets | `AssetPanel.vue`, `MediaAsset`, content-addressed vault and asset routes | Add a native model manifest/revisions/dependencies; a media blob alone is insufficient |
| Persistence | `projectLibrary.ts`: server-backed snapshots plus IndexedDB mirror; `ProjectRepository.ts`: file replacement | Existing snapshot writes do not provide revision-based concurrency control; documentation about IndexedDB alone is incomplete |
| Undo | `src/stores/editor.ts`: project snapshots and gesture grouping | Mesh history needs compact deltas/checkpoints and coordinated command history |
| MCP | `mcp/src/server.ts`: project inspection/showcases, influences, lens, lights, environment, model placement | Add general scene authoring, native modeling, assets, and visual inspection; not just another showcase generator |

No authored fog/volumetric controls were found in the inspected scene engine. A color-space helper checking `scene.fog` does not establish an atmosphere feature.

## 3. Human workflow

### Create a model

1. Open 3D Modeling → New Model, or choose an existing model from Project Assets.
2. Add a primitive or start from an editable converted import.
3. Work in Object mode to arrange parts; switch to Edit mode for vertices, edges, and faces.
4. Extrude, inset, cut, bevel, merge, assign materials, and add modifiers.
5. Set dimensions, origin, units, and optional connection points.
6. Save as Project Asset; generate a thumbnail and publish an immutable revision.
7. Place into the current 3D Scene, retaining a link to that asset revision.

The model can contain multiple named parts and a local hierarchy. It is not forced into a single joined mesh. Drafts autosave; publishing a version is distinct from editing a draft. Pending work is recoverable when switching workspaces.

### Workspace layout

- Top: document name, draft/published status, Object/Edit mode, vertex/edge/face selection, snapping, transform orientation, pivot, shading, Save Asset and Place in Scene.
- Left: compact tool shelf, primitives, modeling operations, kit parts.
- Center: shared 3D viewport with selection outlines, editable cage, axis views, grid, measurement, and optional reference image overlay.
- Right: model hierarchy, dimensions, contextual operation parameters, modifier stack, material slots, diagnostics.
- Bottom: project asset shelf and operation/history area. A timeline is not the default focus for mesh modeling.

Use familiar configurable shortcuts: Tab for mode, 1/2/3 for selection type, G/R/S and axis/numeric constraints, E extrude, I inset, Ctrl+B bevel, Ctrl+R loop cut, Shift+D duplicate, Delete menu, and frame selection. Scope shortcuts to viewport focus and respect text inputs and existing keymap bindings. Every action also needs a visible menu/control.

Support selection replace/add/remove, box selection, occluded selection toggle, connected components, and named selections. Start with single-object Edit mode; later add multi-object editing. Display why an operation cannot run instead of silently returning unchanged geometry.

### Reuse and revisions

- **Edit Source** opens the shared asset draft, showing affected instances.
- **Publish Revision** creates immutable content. Existing scenes remain pinned until an explicit update.
- **Update Instances** previews which selected/all instances will move to the new revision; this is undoable.
- **Make Unique** creates an independent native asset and repoints one instance.
- Per-instance transforms, visibility, and material overrides stay separate from source geometry.
- Project assets are the initial scope; promoting to a global library is a later feature with explicit dependency copying.

## 4. Geometry and asset architecture

### Editable topology

Store an authoritative polygon mesh representation with stable vertex, edge, face, and face-corner IDs. Use a half-edge or equivalent adjacency structure, evaluated through a dedicated modeling kernel. Support triangles, quads, and simple n-gons with deterministic triangulation; reject unsupported self-intersecting faces in early releases.

Face-corner attributes are needed for UV seams and split normals; per-vertex UVs alone are insufficient. Store face material slots, edge sharpness/seams, named selections, and operation provenance. Positions use model-local coordinates. Follow existing Y-up scene conventions and define model dimensions in meters; migrate older content without silently rescaling it.

Derived `THREE.BufferGeometry` is a render cache, not editable source. Its duplicated seam vertices and triangle indices do not provide stable modeling identities. Maintain a triangle-to-source-face mapping for picking and an edge overlay that does not show triangulation diagonals as authored edges.

Each topology operation returns created/deleted IDs, provenance/remapping where meaningful, selection results, diagnostics, and undo information. A topology-changing modifier may invalidate downstream element references: report this and require reselection, rather than pretending indices remain stable.

### Proposed records

| Record | Main responsibility |
| --- | --- |
| `ModelDocument` | Draft ID, schema version, revision, units, origin, object hierarchy, mesh references, material slots, modifier stacks, named selections |
| `MeshSource` | Editable topology and attributes in versioned blobs; adjacency rebuilt or cached deterministically |
| `NativeModelAsset` | Stable logical asset ID, name/tags, immutable published revisions, preview, dependency manifest |
| `ModelAssetRevision` | Source content hashes, source schema/kernel versions, material/texture references, bounds, optional evaluated preview/GLB |
| `ModelInstance` | Scene object identity, model asset/revision reference, placement, supported overrides |
| `ModelCommand` | Request ID, actor/session, expected revision, operation and typed parameters |

Keep large topology buffers out of project-wide JSON snapshots and MCP text responses. Store immutable source blobs in the existing content-addressed vault, with manifests connecting them. Shared hashes must not accidentally merge distinct logical assets or revision histories.

Publish dependencies before atomically committing their manifest/reference. Track references from scenes, drafts, revisions, and retained history before garbage collection. A failed thumbnail or optional GLB export must not destroy a valid source save. Portable project export includes the full dependency closure.

### Modifier integration

Preserve the existing “Influences” document schema and expose a coherent Modifiers UI in Modeling. Reuse adapters where semantics agree. Model-source modifiers apply before instance-level scene animation/deformation. Document evaluation order, transform space, units, and whether each modifier preserves topology IDs.

Base mesh editing remains separate from evaluated output. “Apply Modifier” creates a new editable base with an undo checkpoint and a selection-remapping report. Cache evaluation by source hash, stack parameters, dependencies, and kernel version. Reject cycles in Boolean dependencies.

Move expensive evaluation into workers with cancellation, progress, and last-valid-preview rendering. Do not rebuild unrelated meshes or duplicate geometry on every pointer move.

### Import/export

Preserve current GLB/glTF placement. “Convert to Editable” initially handles static triangle meshes, hierarchy transforms, material slots, UVs, and normals. Explain triangulated topology; do not promise recovery of original quads or modifier history. Detect skinning, morphs, unsupported materials, and missing external resources. Preserve the source and report conversion limits before creating a derivative. Never silently drop animation or skeletal data.

Use native source for lossless Aurora editing; use GLB as an interchange/export artifact. Export must bake unsupported Aurora features and report losses. A GLB roundtrip is not a native editable-source roundtrip.

## 5. Shared operations and live editing

Use this architecture:

```text
Modeling UI / Scene UI                 MCP tools
          |                              |
          +--- typed authoring commands --+
                          |
          authoritative command service
        revision checks / transactions / history
                          |
                pure modeling kernel
                          |
        native sources + vault + derived caches
                          |
           shared renderer / asset instances
```

Host authoritative online command execution in the local application server. MCP calls that service rather than independently overwriting project files. If it is unavailable, return a clear status or launch an explicitly configured shared service; do not introduce a second independent writer.

Use expected document/project revisions and atomic compare-and-commit under a shared writer. A read-check followed by an unlocked file write is insufficient. Return conflicts with the latest revision and changed entities. Retry IDs deduplicate committed operations, including after reconnect.

Push changes over SSE or WebSocket. The browser uses local transient previews during gestures, then commits one command. If an external edit conflicts during the gesture, cancel/rebase the preview with visible feedback. Offline work remains a local branch and reconnects through explicit reconciliation, never an unconditional whole-project overwrite.

Transactions allow ordered dependent operations, local result references, validation, and all-or-nothing commit. Failure at step 8 must leave no partial model or published asset. Bound batch size, geometry growth, worker memory, and runtime. Use seeded procedural operations for repeatability.

Record actor and transaction in history. Initially use a linear authoritative history: undo applies to the current head transaction, with actor visible. Selective undo of an older human or AI operation is deferred unless dependency-safe inversion is implemented. Undo cannot restore an old project snapshot over newer edits from another actor.

## 6. MCP interface

Proposed tools, not currently available:

| Tool family | Operations |
| --- | --- |
| `aurora_capabilities_get` | Kernel/tool versions, supported operations, feature limits, renderer availability |
| `aurora_model_create/get/list` | Create/open documents; summaries, bounds, part lists and paginated topology inspection |
| `aurora_model_select` | Resolve explicit element IDs, named groups, part IDs, normal/spatial predicates; return selection token and revision |
| `aurora_model_operation_apply` | Typed discriminated operation union: primitive, transform, extrude, inset, merge, delete, bevel, cut, assign material, etc. |
| `aurora_model_modifier_upsert/remove` | Validated stack authoring with typed per-modifier parameters |
| `aurora_model_validate` | Degenerates, boundary edges, non-manifold topology, UV/material problems, bounds and complexity |
| `aurora_asset_publish/instantiate/make_unique/update_instances` | Full native asset lifecycle |
| `aurora_scene_object_create/update/delete` | Generic primitive/group/instance construction, parenting and transforms |
| `aurora_scene_camera_set` | Pose, projection, lens and explicit look-at target with defined coordinates |
| `aurora_scene_material_set/atmosphere_set` | Appearance and supported atmosphere authoring |
| `aurora_authoring_batch` | Atomic ordered model/scene transactions with result references |
| `aurora_viewport_capture` | Camera, angle, render mode, dimensions and exact rendered revision |
| `aurora_job_get/cancel` | Long geometry evaluation and render jobs |
| `aurora_history_get/undo` | Shared history and revision-guarded head undo |

Tools accept IDs rather than ambiguous display names. Surface selections are tied to a topology revision and fail when stale. Add semantic part labels such as `pillar.cap` and named face groups for efficient AI editing. Return result IDs, counts, changed bounds, revisions, diagnostics, and preview references. Large geometry uses resource/blob references, not repeated vertex arrays in tool output.

Support model and scene creation without a browser. Visual feedback uses a connected renderer initially; report unavailable capture honestly. A later headless browser renderer must reuse the same pipeline and expose hardware/fidelity limits. Never claim a capture reflects a change until it has rendered the committed revision.

Keep image interpretation in the AI workflow initially: attach the image as a project reference, inspect it, author structured commands, capture the result, compare, and iterate. A future image-to-mesh provider can be an optional adapter producing native/imported assets; it is not a prerequisite or a guarantee of accurate geometry.

## 7. Reconstructing the supplied architecture

One image supplies visible composition, not hidden geometry, absolute scale, or unique camera parameters. Target a convincing match from the reference camera first, with plausible geometry for nearby viewpoints. State scale and occluded-region assumptions.

1. **Reference and composition:** retain the supplied image as a reference asset, match its aspect ratio, mark bridge convergence and verticals, establish a meter scale from an assumed walkway/stair width, and solve camera pose/FOV approximately. Add overlay opacity and side-by-side comparison.
2. **Graybox:** broad foreground platform, diagonal main bridge, deep voids, background crosswalks, repeated tall supports, raised center-right stair landing. Establish silhouettes, negative spaces, and depth before fine panels.
3. **Reusable kit:** pillar shaft, pillar cap/base, bridge deck, edge trim, support beam, stair flight/landing, wall panel, light strip, and a few rubble pieces. Keep foreground hero variants more detailed than distant pieces.
4. **Native modeling:** use inset/extrude for panels, bevel for edge highlights, mirror for symmetry, arrays for repeatable deck detail, validated Booleans for major recesses. Store logical parts and material slots.
5. **Assembly:** place linked instances; add grid and socket snapping, bounds-aware spacing, seeded controlled variation, and grouped sections. Use instancing for compatible repeated geometry/materials and convert only selected copies to unique assets.
6. **Surfaces:** concrete/stone and dark metal, roughness variation, panel seams, grime and damage via textures/decals where appropriate. Ensure usable UVs or explicit projected mapping; displacement is a separate cost decision.
7. **Lighting and atmosphere:** strong high illumination toward the upper right/center, restrained fill, emissive strips, deep shadow shapes, depth haze and visible shafts. Add authored fog and a separately validated volumetric/scattering path; bloom alone does not create correct shadowed shafts.
8. **Review:** render at reference framing; compare silhouette, bridge angle, pillar spacing, stair position, value distribution, and depth separation. Iterate camera and large forms before increasing geometry detail. Inspect alternate angles for broken construction.
9. **Deliver:** saved scene, reusable project kit, camera, materials, dependency-complete assets, editable source and thumbnails. The result is navigable 3D, not a projected background image.

The scene can reach a useful geometric blockout before the full polygon toolset ships. Reference-quality atmosphere is a separate rendering milestone and must not be hidden inside “modeling complete.”

## 8. Implementation sequence and acceptance gates

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0: contracts and spikes | Native schema, units/IDs, topology prototype, worker boundary, revision service design, benchmark fixture | Extrude a quad correctly, preserve IDs/UV seams, undo and roundtrip source; prove simultaneous writers cannot lose edits |
| 1: first vertical slice | Modeling workspace, shared viewport pieces, one editable primitive, face picking/extrude, draft save, native publish/place/reopen, MCP equivalents | Human and MCP create equivalent editable assets; close/reopen and place two instances; undo a whole operation |
| 2: practical mesh editor | Vertex/edge/face editing, inset, cuts, merge/dissolve/delete/fill, selected-edge bevel, normals, material slots, basic UV projection, snapping | Build a pillar, bridge section, and stair module entirely inside Aurora; diagnostics cover unsupported topology |
| 3: reusable kit workflow | Linked versions, make unique, update preview, hierarchy assets, array/mirror/solidify integration, conversion/export, thumbnails | One revision updates only chosen instances; unique instances remain independent; dependencies survive project transfer |
| 4: complete AI workflow | Generic scene tools, selection queries, atomic batches, live events/history, revision-tagged capture and jobs | AI authors kit + scene through public MCP tools, inspects renders, and human continues editing without special scripts |
| 5: reference-scene appearance | Camera overlay/comparison, materials/decals, atmosphere and shafts, instancing/LOD budgets | Saved reconstruction matches agreed framing/readability criteria and remains interactive on specified target hardware |
| Later | Knife tools, bridge edge loops, proportional editing, richer UV editor/unwrap, advanced subdivision, curves-to-mesh, sculpting/retopology, optional Blender bridge | Separate scoped acceptance suites; no implied Blender parity |

MCP support is built alongside each operation from Phase 1; Phase 4 completes the cross-feature workflow. Core revision safety is required before enabling simultaneous browser/MCP mutations. Phase 5 research can start after grayboxing exposes the actual visual requirements.

Planning scale: this is a multi-milestone product effort, not an extra tab plus a few API wrappers. A useful native hard-surface release is a months-scale effort for a small experienced team; precision estimates should follow Phase 0. Topology, robust bevel/Boolean behavior, persistence/history, and atmosphere are the largest uncertainties. Full Blender equivalence is unbounded here and explicitly outside this release.

## 9. Validation and performance

- Kernel fixtures: boundary and closed meshes, disconnected selections, nonplanar faces, holes, degenerates, negative transforms, UV seams, face material propagation, and operation undo.
- Persistence: native roundtrip, schema migration, broken dependencies, failed publish/recovery, garbage collection reachability, portable asset bundles, unsupported future schema handling.
- Collaboration: browser/MCP simultaneous commits, stale selection tokens, duplicate retries, batch rollback, reconnect branches, actor-visible undo, interrupted gestures.
- Interaction: keyboard and mouse parity, viewport focus, Escape rollback, one undo per drag, selection visibility, camera preservation on workspace return.
- Rendering: deterministic source triangulation, correct normals/material slots, identical source revisions across modeling/scene/composition/export, resource disposal and canceled worker results.
- End-to-end: create a pillar through UI and MCP, publish, instantiate twice, make one unique, change source, update only the linked copy, restart, and verify.
- Performance targets to benchmark rather than promise: responsive transforms on a 100k-triangle active model; at least 30 fps for a representative repeated-kit scene on agreed hardware; cancellation and progress for long operations. Record draw calls, triangle/instance counts, peak memory, p95 interaction latency, and cold/warm save/load times.

Retain current scene/asset/influence tests. Add behavior-focused topology, persistence, and MCP integration tests; visual review is required for selection tools and reference appearance. Do not accept “no exception” as evidence that bevels, normals, or silhouettes are correct.

## 10. Suggested code boundaries

- `shared/modeling/`: versioned schemas, typed commands/results, asset references, diagnostics.
- `src/engine/modeling/`: topology, selection, operations, triangulation/provenance, modifier adapters, worker entry points; portable kernel separated from browser orchestration.
- `server/src/authoring/`: authoritative execution, revisions, transactions, journals, jobs and change events.
- `server/src/models/`: native manifests, drafts, dependency-aware publishing and lifecycle.
- `src/components/modeling/`: workspace shell, tool shelf, topology overlays, operation settings, source/instance UI.
- `src/stores/modeling.ts`: focused editing session and transient previews, with shared command history coordination.
- `src/engine/viewport/`: incremental extraction of reusable navigation, gestures, picking and shading from the scene workspace.
- `mcp/src/modelingTools.ts`, `assetTools.ts`, `authoringTools.ts`: thin validated adapters.
- Existing models/contracts, project migrations, asset panel, top bar, scene runtime and persistence services: narrowly scoped integration changes with compatibility tests.

Do not expand the already large scene component/store into the complete modeling kernel. Do not fork the renderer. Do not make raw project JSON replacement the long-term AI authoring API.

## Technical references

- Blender mesh structure: https://docs.blender.org/manual/en/5.2/modeling/meshes/structure.html — useful interaction/data-model reference, not a claim of implementation parity.
- Three.js BufferGeometry: https://threejs.org/docs/pages/BufferGeometry.html — evaluated geometry representation.
- Three.js GLTFExporter: https://threejs.org/docs/pages/GLTFExporter.html — GLB interchange support, not native editable topology persistence.
- Existing CSG dependency: https://github.com/gkjohnson/three-bvh-csg — upstream describes experimental behavior and manifold input requirements; prototype and validate before relying on it for arbitrary user models.
