# Aurora engine update log

This file tracks implemented changes, verification, and remaining work. New
user-facing capabilities must have equivalent UI and MCP access (AGENTS.md).

## Batch 1 — rendering overhead (completed)

- Undeformed image planes use single-pass double-sided transparency. Rigged or
  influenced planes retain two-pass rendering.
- AO and depth-of-field passes allocate on enable and dispose on disable, preserving
  pass order, resizing, and camera updates.
- Removed duplicate object-transform evaluation per scene synchronization.
- Shadow bounds are skipped when scene shadows are disabled or no light casts them.
- Browser checks wait for the requested project to finish opening.

Verification: type-check and 165 scene/rendering tests passed. HUD at 720 × 1000
dropped from 47 to 32 draw calls, with zero differing RGB pixels in a before/after
frame comparison. Citadel retains 40,000 instances and zero static instance uploads.
See [detailed evidence](artifacts/phase-hud/engine-improvements.md). Timing results
are not controlled before/after speedup measurements.

## Batch 2 — scene bounds and animation evaluation (completed 2026-09-23)

- Cache shadow bounds using evaluated transforms, geometry attributes and versions,
  and instance-buffer versions/counts. Added/removed meshes invalidate the cache.
- Skinned/morphing meshes conservatively bypass bounds reuse.
- Cache sorted keyframe order. Key values and easing remain live; retiming,
  insertion, deletion, replacement, and reordering invalidate order as needed.
- Unmodified meshes bypass influence-signature construction; disabling the last
  influence restores the base mesh. Scenes without groups skip group-array setup.
- These optimizations are internal and apply equally to UI, exports, and MCP renders.

Implementation:
- `src/engine/scene3d/sceneBoundsCache.ts`
- `src/engine/scene3d/ThreeSceneRuntime.ts`
- `src/engine/animation/evaluateProperty.ts`

Validation:
- `pnpm type-check` passed.
- 186 tests across 40 animation/scene/rendering test files passed, including cache
  invalidation on parent transforms, geometry edits, object insertion/removal,
  instance changes, keyframe retiming/replacement, and array mutations.
- Both saved scenes rendered through the actual MCP renderer and were inspected.
  The HUD time-zero frame was pixel-identical to its Batch 1 render. The Citadel
  comparison was not pixel-identical (mean absolute RGB difference 0.55/0.27/0.36
  on a 0–255 scale); no visible structural regression was identified.
- HUD: 32 draw calls, 6.4 ms median / 11 ms P95 at 720 × 1000.
- Citadel: 185 draw calls, 40,000 instances, zero redundant instance uploads,
  12.2 ms median / 16.7 ms P95 at 960 × 540.
- Actual editor smoke tests passed with no page errors. Citadel retained 53 mesh
  objects; timeline/selection/edit/undo were exercised. HUD scrubbing exercised
  five times across the loop. HTTP writes were intercepted in fresh browser contexts.
- Citadel editor samples: timeline 43.5–74.5 ms; edit 600.7 ms; undo 194.1 ms.
  These results do not establish an end-to-end speedup: timings were higher than
  some previous runs. The demonstrated change is reuse of cached work, covered by
  invalidation tests; a controlled sustained benchmark remains outstanding.

Evidence: [Citadel editor results](artifacts/crimson-citadel/editor-cache-batch2.json),
[HUD editor results](artifacts/phase-hud/ui-check.json), and
[camera metrics](artifacts/engine-batch2/).

## Follow-through from Batch 2

The five areas previously listed here are addressed in Batches 4–6 below. The
implemented scope and architectural limits are explicit; this is not a claim that
every engine subsystem has been converted to incremental evaluation.

## Batch 3 — immutable model revisions in history (completed 2026-09-23)

- Undo checkpoints now pool published native-model revisions rather than cloning
  their vertex arrays on every edit. Pool entries are independent, deeply frozen
  copies; editable drafts and all other mutable state still receive independent copies.
- History equality uses pool identity for published revisions rather than repeatedly
  serializing their geometry. Undo/redo reuse the same frozen publications while
  restoring mutable drafts and scene data separately.
- Saved project serialization is unchanged and still writes complete model data.
- Pool keys are weak references and scoped to an editor store. Published revisions
  must remain immutable, as required by the existing modeling contract.

Validation:
- Type-check and 241 tests across 29 history/modeling/project test files passed.
- New tests check shared identity, deep freezing, draft isolation, publication after
  restore, history equality and complete serialized output.
- A read-only Chromium benchmark on the loaded Citadel alternated six legacy JSON
  clones with six pooled clones after warming the pool: median 295.2 ms versus
  111.4 ms (about 62% lower checkpoint-cloning time in this run).
- Six checkpoints held 318 publication references backed by only 53 unique frozen
  revision objects. Mutable drafts remain copied. This is an object-sharing result,
  not a measured browser heap reduction.
- First-time cloning/freezing is excluded from the warm comparison. Whole-editor
  speedups are not implied; persistence still serializes complete project data.

Implementation: `src/engine/project/historyState.ts` and history capture/equality/
restore paths in `src/stores/editor.ts`.
Evidence: [focused benchmark](artifacts/engine-batch3/history-sharing.json) and
[editor smoke](artifacts/crimson-citadel/editor-history-batch3-final.json).
Reproduce with `node tests/browser/history-sharing-profile.mjs` against the dev server.
This does not yet share mutable modeling drafts or implement delta history.

## Batch 4 — resource reuse and incremental updates (completed 2026-09-23)

- Render surfaces share reference-counted texture loads and decoded sources.
  Pending loads are safely released; the final consumer disposes the texture.
  Color and data textures have separate cache entries.
- Workspace and camera preview rendering use one animation-frame scheduler.
  Hidden documents defer queued work until visible, and unmounted surfaces cancel it.
- Asset/rig lookup maps are reused while detecting insertion, deletion, replacement
  and in-place ID edits. Group/scatter world-matrix passes run only when required;
  camera projection matrices update only when their inputs change.
- Existing evaluated-transform, geometry, bounds and animation guards remain the
  dependency boundaries. Boolean operands, rigs and animated paths retain their
  conservative evaluation to preserve correct results.
- Changes are internal and shared by editor, export and MCP rendering; no separate
  MCP-only controls were introduced.

## Batch 5 — history and compressed model storage (completed 2026-09-23)

- History capture now shares unchanged frozen branches throughout the snapshot,
  including native-model drafts. In-place edits copy changed branches; restore makes
  editable data mutable again. Published revisions remain pooled and immutable.
- Native models save as lossless gzip JSON blobs addressed by SHA-256 under
  `projects/.geometry`. Identical models deduplicate; manifests publish after blobs.
  Concurrent Windows publication checks the winning blob if replacement is denied.
- Legacy inline files load normally. UI and MCP both use ProjectRepository;
  their responses contain full model data and retain logical ETags/conflict handling.
- The project picker reads metadata without decompressing geometry. Missing or corrupt
  referenced geometry fails loading/saving instead of pretending the project is absent.
- Compact MCP project responses avoid indentation overhead; the bundled inspector
  allows 128 MB messages instead of the SDK's 10 MB default.

Measured on the existing Citadel using a temporary vault, never saving over it:

| Measurement | Result |
| --- | ---: |
| Original compact logical JSON | 14,456,808 bytes |
| New manifest | 179,409 bytes |
| 50 unique compressed model blobs | 2,080,943 bytes |
| Manifest plus blobs | 2,260,352 bytes (84.4% smaller) |
| Save / reload / metadata list | 586.5 / 385.5 / 2.7 ms |

Logical round-trip and ETag equality passed. These are one-run storage measurements,
not a controlled load-time speedup claim. Six interleaved warm browser trials of
unchanged checkpoint capture measured medians of 76.1 ms for legacy JSON cloning and
46.8 ms for structural sharing (38.5% lower in this run). Initial freezing is excluded.
The six snapshots reuse 53 published revision objects across 318 references.

## Batch 6 — transparent DOF and UI/MCP profiling (completed 2026-09-23)

- Depth-of-field depth rendering honors each material's image alpha, alpha map,
  opacity, side and displacement. Transparent holes no longer become solid planes.
- The blur gathers with contributing surface depth/radius to avoid repeating sharp
  glyphs into distant transparent pixels. Material and renderer state restore even
  on failure; unused depth materials and targets are disposed.
- The profiler supports start time, 0–30 second animation sampling, 1–600 frames,
  scene/camera selection, camera cuts, quality override and dimensions. Instance
  upload accounting follows meshes replaced during sampling.
- **3D → camera preview header → Profile** exposes all these options, the resulting
  image, sample range, timing/count metrics, artifact location and PNG download.
  Shared schema and renderer keep HTTP/UI and MCP behavior aligned.
- UI preview work runs in an isolated process. This fixes development-server
  restarts caused by importing Vite into Node's watched HTTP process.

Final validation:

- `pnpm type-check` passed; **475 tests across 80 files passed**, covering animation,
  scene/rendering, modeling, project/history/store, server and MCP behavior. The
  final Windows publication adjustment also passed both storage regression tests.
- Actual saved-scene MCP PNGs were inspected for Citadel and HUD. HUD was checked
  at time zero and the loop endpoint; the profiler UI rendered an intermediate time.
- UI profiling smoke passed with no console/page errors and verified a 12-frame,
  2-second sample at 360 × 500. The result screenshot was inspected.
- Both editor smokes exercised selection, edit, undo and 240 timeline updates in
  isolated browser contexts with project writes intercepted. No page errors.

| Final camera sample, full quality | Citadel | HUD |
| --- | ---: | ---: |
| Resolution | 960 × 540 | 720 × 1000 |
| Sample range / frames | 0–8 s / 240 | 0–12 s / 240 |
| Sync median / P95 | 1.5 / 3.0 ms | 0.3 / 0.6 ms |
| GPU-complete frame median / P95 | 3.3 / 6.0 ms | 1.1 / 2.5 ms |
| Draw calls | 185 | 32 |
| Instances / repeated uploads | 40,000 / 0 | 0 / 0 |

The actual Citadel editor retained 53 objects, with edit/undo calls at 208.2/129.5 ms.
Its 240-update check measured median/P95 33.3/51.8 ms; HUD measured 33.3/33.9 ms.
Each editor sample intentionally waits **two animation frames**, so these values
are interaction-settling measurements, not rendering FPS. Camera timings include
GPU completion and exclude editor reactivity. Results vary with system load and
are not controlled before/after whole-engine speedup claims.

Evidence: [final artifacts](artifacts/engine-final/),
[Citadel editor](artifacts/crimson-citadel/editor-engine-final.json),
[HUD editor](artifacts/crimson-citadel/editor-hud-engine-final.json).
Reproduction and storage setup are documented in [mcp/README.md](mcp/README.md).

## Boundaries and possible future extensions

- Resource sharing covers decoded texture sources, not a single shared WebGL
  context or all model geometry. Cross-context GPU allocations remain separate;
  consolidating render surfaces would require a renderer architecture change.
- Dependency guards are targeted. A full dirty dependency graph for Boolean/rig
  chains would require explicit reverse dependencies and mutation revisions.
- History still traverses mutable branches to detect in-place edits; it is not an
  operation-based delta journal. Storage uses compressed JSON, not typed-array
  streaming or zero-copy geometry loading.
- **Back up `.geometry` together with project manifests.** Legacy files convert on
  their next normal save; this work did not rewrite the user's saved scenes. Orphan
  blobs remain retained; safe garbage collection would need a manifest-reference scan.
- DOF uses one depth per pixel. Layered semitransparent glass needs a multi-layer
  depth/compositing approach for physically accurate blur; alpha cutouts are supported.
- Profiling is saved-camera sampling with GPU completion, not isolated GPU timer
  queries, unsaved viewport capture, 2D composition or motion-blur accumulation.
- Third-party MCP clients requesting full large projects must raise their receive
  limit above 10 MB. Paged/resource-based model access could remove that requirement.

The scoped implementation and validation pass is complete; the extensions above
are architectural limits, not unverified claims of completed functionality.
